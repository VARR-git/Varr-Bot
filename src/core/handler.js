/**
 * Handler pesan WhatsApp → pipeline command.
 *
 * Hanya memproses `messages.upsert` bertipe `notify`, mengabaikan pesan sendiri,
 * status, broadcast, newsletter, reaksi, dan pesan sistem.
 */

const { createTranslator } = require('./i18n');
const { compose } = require('./middleware');
const { createChatQueue } = require('./queue');
const { AppError, withTimeout } = require('./errors');
const {
  collectSenderIds,
  isGroupJid,
  isPhoneJid,
  isStatusJid,
  jidToNumber,
  maskJid,
  normalizeJid,
} = require('../utils/jid');
const {
  extractText,
  parseCommand,
  unwrapMessage,
} = require('../utils/text');

const SKIP_SUFFIXES = ['@broadcast', '@newsletter'];
const SEEN_LIMIT = 1_000;
const UNKNOWN_REPLY_WINDOW_MS = 15_000;
const MAX_MESSAGE_LENGTH = 60_000;

/**
 * @param {string} jid
 * @returns {boolean}
 */
function shouldSkipJid(jid) {
  return isStatusJid(jid) || SKIP_SUFFIXES.some((suffix) => jid.endsWith(suffix));
}

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.logger
 * @param {object} options.registry
 * @param {object} options.db
 * @param {object} options.state
 * @param {object} options.services
 * @param {object} [options.services.messageCache] Cache `getMessage` Baileys.
 * @param {object} [options.services.guard] Guard grup (antilink/antispam).
 * @param {Array<Function>} options.middlewares
 */
function createMessageHandler({
  config,
  logger,
  registry,
  db,
  state,
  services = {},
  middlewares,
}) {
  const pipeline = compose(middlewares);
  const translator = createTranslator(config.defaultLang);

  const seenIds = new Set();
  const seenQueue = [];
  const unknownReplies = new Map();
  const chatQueue = createChatQueue({
    maxPending: config.queueMaxPending ?? 50,
    logger,
  });

  /**
   * @param {string|undefined} id
   * @returns {boolean} true jika pesan sudah pernah diproses
   */
  function markSeen(id) {
    if (!id) return false;
    if (seenIds.has(id)) return true;

    seenIds.add(id);
    seenQueue.push(id);
    if (seenQueue.length > SEEN_LIMIT) {
      const oldest = seenQueue.shift();
      seenIds.delete(oldest);
    }

    return false;
  }

  /**
   * @param {object} sock
   * @param {object} msg
   */
  function buildContext(sock, msg) {
    const chatId = normalizeJid(msg.key.remoteJid);
    const isGroup = isGroupJid(chatId);
    const senderIds = collectSenderIds(msg, chatId);
    const senderId = senderIds[0] || chatId;
    const senderNumbers = new Set(
      senderIds.filter(isPhoneJid).map(jidToNumber).filter(Boolean),
    );
    const isOwner = config.ownerNumbers.some((number) => senderNumbers.has(number));

    const ctx = {
      sock,
      msg,
      chatId,
      isGroup,
      senderIds,
      senderId,
      senderName: msg.pushName || '',
      isOwner,
      role: isOwner ? 'owner' : 'user',
      startedAt: Date.now(),
      text: '',
      prefix: config.prefix,
      parsed: null,
      command: null,
      args: [],
      rawArgs: '',
      config,
      logger,
      db,
      state,
      registry,
      services,
      t: translator,
    };

    /**
     * @param {object|string} payload
     * @param {{quoted?: boolean}} [options]
     */
    ctx.send = async (payload, options = {}) => {
      const body = typeof payload === 'string'
        ? { text: payload.length > MAX_MESSAGE_LENGTH ? `${payload.slice(0, MAX_MESSAGE_LENGTH - 100)}\n…` : payload }
        : payload;

      const result = await sock.sendMessage(
        chatId,
        body,
        options.quoted === false ? undefined : { quoted: msg },
      );

      // Simpan proto pesan (bukan AnyMessageContent) agar retry bisa memakainya.
      if (result?.key && result.message) {
        services.messageCache?.set(result.key, result.message);
      }

      return result;
    };

    /**
     * @param {string} text
     * @param {{quoted?: boolean}} [options]
     */
    ctx.reply = async (text, options = {}) => {
      const value = String(text ?? '').trim();
      if (!value) return null;
      return ctx.send(value, options);
    };

    /**
     * @param {string} emoji
     */
    ctx.react = async (emoji) => {
      try {
        return await sock.sendMessage(chatId, {
          react: { text: String(emoji), key: msg.key },
        });
      } catch (error) {
        logger.debug?.({ error: error.message, chat: maskJid(chatId) }, 'Gagal mengirim reaksi');
        return null;
      }
    };

    ctx.getGroupMetadata = () => {
      if (!services.getGroupMetadata) {
        return Promise.reject(new AppError('GROUP_SERVICE_MISSING', 'Group metadata service tidak tersedia.'));
      }
      return services.getGroupMetadata(sock, chatId);
    };

    return ctx;
  }

  /**
   * @param {object} ctx
   */
  async function handleUnknownCommand(ctx) {
    const mode = state.mode || 'public';
    // Di mode self/private jangan membocorkan keberadaan bot ke non-owner.
    if (!ctx.isOwner && (mode === 'self' || mode === 'private')) {
      return;
    }

    const key = `${ctx.chatId}:${ctx.senderId}`;
    const timestamp = Date.now();
    const previous = unknownReplies.get(key) || 0;
    if (timestamp - previous < UNKNOWN_REPLY_WINDOW_MS) return;
    unknownReplies.set(key, timestamp);

    if (unknownReplies.size > 2_000) {
      for (const [entry, value] of unknownReplies) {
        if (timestamp - value > UNKNOWN_REPLY_WINDOW_MS) unknownReplies.delete(entry);
      }
    }

    try {
      await ctx.reply(ctx.t('errors.unknownCommand', {
        command: ctx.parsed.commandName,
        prefix: ctx.parsed.prefix,
      }));
      db.incrementStat('command:unknown');
    } catch (error) {
      logger.debug?.(
        { error: error.message, chat: maskJid(ctx.chatId) },
        'Gagal membalas command tidak dikenal',
      );
    }
  }

  /**
   * @param {object} ctx
   * @param {Error} error
   */
  async function handleError(ctx, error) {
    const isKnown = error instanceof AppError;

    logger.error({
      err: error,
      command: ctx.command?.name,
      chat: maskJid(ctx.chatId),
      sender: maskJid(ctx.senderId),
      messageId: ctx.msg?.key?.id,
    }, 'Command gagal diproses');

    try {
      db.incrementStat('command:error');
    } catch {
      // Statistik tidak boleh mengubah hasil command.
    }

    try {
      await ctx.reply(isKnown && error.userMessage ? error.userMessage : ctx.t('errors.generic'));
    } catch (replyError) {
      logger.error(
        { err: replyError, chat: maskJid(ctx.chatId) },
        'Gagal mengirim pesan error ke pengguna',
      );
    }
  }

  /**
   * @param {object} ctx
   */
  async function executeCommand(ctx) {
    const result = await withTimeout(
      Promise.resolve(ctx.command.execute(ctx)),
      config.commandTimeoutMs,
      `command ${ctx.command.name}`,
    );

    if (typeof result === 'string' && result.trim()) {
      await ctx.reply(result.trim());
    }
  }

  /**
   * Inti pemrosesan satu command. Dipanggil lewat queue per chat.
   *
   * @param {object} sock
   * @param {object} msg
   * @param {object} parsed
   * @param {string} text
   */
  async function processCommand(sock, msg, parsed, text) {
    const ctx = buildContext(sock, msg);
    ctx.text = text;
    ctx.prefix = parsed.prefix;
    ctx.parsed = parsed;
    ctx.args = parsed.args;
    ctx.rawArgs = parsed.rawArgs;
    ctx.command = registry.get(parsed.commandName);

    if (!ctx.command) {
      await handleUnknownCommand(ctx);
      return;
    }

    let executed = false;

    try {
      await pipeline(ctx, async (current) => {
        executed = true;
        await executeCommand(current);
      });

      if (executed) {
        try {
          db.incrementStat('command:total');
          db.incrementStat(`command:${ctx.command.name}`);
          db.incrementUserCommands(ctx.senderId);
          if (ctx.isGroup) db.incrementGroupCommands(ctx.chatId);
        } catch (error) {
          logger.warn(
            { err: error, command: ctx.command.name },
            'Gagal mencatat statistik command',
          );
        }
      }
    } catch (error) {
      await handleError(ctx, error);
    }
  }

  /**
   * @param {object} sock
   * @param {object} msg
   */
  async function handleMessage(sock, msg) {
    const chatId = msg?.key?.remoteJid;
    if (!chatId || msg.key.fromMe || !msg.message) return;
    if (shouldSkipJid(chatId)) return;
    if (markSeen(msg.key.id)) return;

    const content = unwrapMessage(msg.message);
    if (!content) return;
    if (content.reactionMessage || content.protocolMessage || content.pollUpdateMessage) return;

    const text = extractText(content);
    if (!text) return;

    // Guard grup berjalan sebelum parsing command agar pesan biasa juga dijaga.
    if (services.guard) {
      try {
        const handled = await services.guard.enforce(sock, msg, { chatId, text });
        if (handled) {
          try {
            db.incrementStat('guard:handled');
          } catch {
            // Statistik tidak boleh mengubah hasil guard.
          }
          return;
        }
      } catch (error) {
        logger.warn(
          { err: error, chat: maskJid(chatId) },
          'Guard grup gagal mengevaluasi pesan',
        );
      }
    }

    const parsed = parseCommand(text, config.prefixes);
    if (!parsed) return;

    // Serialisasi per chat: pesan dari chat yang sama berurutan, chat lain paralel.
    await chatQueue.run(
      normalizeJid(chatId),
      () => processCommand(sock, msg, parsed, text),
    );
  }

  /**
   * @param {object} sock
   * @param {{type?: string, messages?: object[]}} event
   */
  async function handleUpsert(sock, event) {
    if (event?.type !== 'notify' || !Array.isArray(event.messages)) return;

    await Promise.allSettled(event.messages.map(async (msg) => {
      try {
        await handleMessage(sock, msg);
      } catch (error) {
        logger.error(
          { err: error, chat: maskJid(msg?.key?.remoteJid || '') },
          'Pesan gagal diproses di handler',
        );
      }
    }));
  }

  function dispose() {
    seenIds.clear();
    seenQueue.length = 0;
    unknownReplies.clear();
    chatQueue.clear();
  }

  return {
    handleMessage,
    handleUpsert,
    buildContext,
    dispose,
    queue: chatQueue,
    /**
     * @param {number} [timeoutMs]
     */
    drain: (timeoutMs) => chatQueue.drain(timeoutMs),
  };
}

module.exports = {
  createMessageHandler,
  shouldSkipJid,
};
