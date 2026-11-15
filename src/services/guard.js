/**
 * Guard grup: antilink dan antispam.
 *
 * Guard berjalan untuk semua pesan teks di grup, termasuk pesan yang berisi
 * command. Admin grup, owner bot, dan pesan bot sendiri tidak pernah terkena
 * guard.
 *
 * Aksi yang didukung per fitur:
 * - `delete` — hapus pesan.
 * - `warn`   — hapus pesan lalu tambah warning; batas warning memicu kick.
 * - `kick`   — hapus pesan lalu keluarkan pengirim.
 */

const { createTranslator } = require('../core/i18n');
const {
  collectSenderIds,
  isGroupJid,
  isPhoneJid,
  jidToNumber,
  normalizeJid,
} = require('../utils/jid');
const {
  findParticipant,
  isBotAdmin,
  isParticipantAdmin,
} = require('../utils/group');
const { buildTarget, targetMention } = require('../utils/groupTarget');
const { addWarningAndEscalate } = require('./warnings');

const LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s]+|\b(?:chat\.whatsapp\.com|wa\.me|t\.me)\/[^\s]+/i;
const VALID_ACTIONS = new Set(['delete', 'warn', 'kick']);
const SPAM_WINDOW_MS = 5_000;
const SPAM_MAX_MESSAGES = 6;
const REPEAT_WINDOW_MS = 10_000;
const REPEAT_MAX = 3;

/**
 * @param {unknown} value
 * @returns {'delete'|'warn'|'kick'}
 */
function normalizeAction(value) {
  const action = String(value || '').trim().toLowerCase();
  return VALID_ACTIONS.has(action) ? action : 'delete';
}

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.db
 * @param {object} options.logger
 * @param {(sock: object, groupId: string) => Promise<object>} options.getGroupMetadata
 * @param {() => number} [options.now]
 */
function createGuardService({
  config,
  db,
  logger,
  getGroupMetadata,
  now = Date.now,
}) {
  const t = createTranslator(config.defaultLang);
  /** @type {Map<string, {times: number[], text: string, repeats: number, lastAt: number}>} */
  const spamState = new Map();

  /**
   * @param {string} chatId
   * @param {string} senderId
   * @param {string} text
   * @returns {boolean}
   */
  function isSpam(chatId, senderId, text) {
    const key = `${chatId}\u0000${senderId}`;
    const timestamp = now();
    const entry = spamState.get(key) || {
      times: [],
      text: '',
      repeats: 0,
      lastAt: 0,
    };

    entry.times = entry.times.filter((time) => timestamp - time <= SPAM_WINDOW_MS);
    entry.times.push(timestamp);

    if (entry.text === text && timestamp - entry.lastAt <= REPEAT_WINDOW_MS) {
      entry.repeats += 1;
    } else {
      entry.text = text;
      entry.repeats = 1;
    }
    entry.lastAt = timestamp;

    spamState.set(key, entry);

    if (spamState.size > 1_000) {
      for (const [entryKey, value] of spamState) {
        if (timestamp - value.lastAt > REPEAT_WINDOW_MS) spamState.delete(entryKey);
      }
    }

    const spam = entry.times.length > SPAM_MAX_MESSAGES || entry.repeats > REPEAT_MAX;
    if (spam) spamState.delete(key);

    return spam;
  }

  /**
   * @param {object} sock
   * @param {string} chatId
   * @param {string} text
   * @param {string[]} mentions
   */
  async function notify(sock, chatId, text, mentions = []) {
    try {
      await sock.sendMessage(chatId, { text, mentions });
    } catch (error) {
      logger?.debug?.(
        { err: error, chat: chatId },
        'Gagal mengirim notifikasi guard',
      );
    }
  }

  /**
   * @param {object} sock
   * @param {object} msg
   * @param {object} options
   * @param {string} options.chatId
   * @param {string} options.text
   * @returns {Promise<boolean>} true bila pesan sudah ditangani guard
   */
  async function enforce(sock, msg, { chatId, text }) {
    if (!isGroupJid(chatId)) return false;

    const linkEnabled = Boolean(db.getGroupSetting(chatId, 'antilink', false));
    const spamEnabled = Boolean(db.getGroupSetting(chatId, 'antispam', false));
    if (!linkEnabled && !spamEnabled) return false;

    let metadata;
    try {
      metadata = await getGroupMetadata(sock, chatId);
    } catch (error) {
      logger?.debug?.(
        { err: error, chat: chatId },
        'Guard melewati pesan karena metadata grup gagal diambil',
      );
      return false;
    }

    const senderIds = collectSenderIds(msg, chatId);
    if (senderIds.length === 0) return false;

    // Admin grup dan owner bot selalu dikecualikan.
    if (isParticipantAdmin(metadata, senderIds)) return false;

    const senderNumbers = new Set(
      senderIds.filter(isPhoneJid).map(jidToNumber).filter(Boolean),
    );
    if (config.ownerNumbers.some((number) => senderNumbers.has(number))) return false;

    const linkViolation = linkEnabled && LINK_PATTERN.test(text);
    const spamViolation = spamEnabled && isSpam(chatId, senderIds[0], text);
    if (!linkViolation && !spamViolation) return false;

    const kind = linkViolation ? 'link' : 'spam';
    const actionKey = kind === 'link' ? 'antilink_action' : 'antispam_action';
    const action = normalizeAction(db.getGroupSetting(chatId, actionKey, 'delete'));

    // Tanpa hak admin, bot tidak bisa menghapus pesan orang lain.
    if (!isBotAdmin(metadata, sock)) {
      logger?.debug?.(
        { chat: chatId, kind },
        'Guard mendeteksi pelanggaran tetapi bot bukan admin',
      );
      return false;
    }

    try {
      await sock.sendMessage(chatId, { delete: msg.key });
    } catch (error) {
      logger?.warn?.(
        { err: error, chat: chatId, kind },
        'Guard gagal menghapus pesan',
      );
      return false;
    }

    const participant = findParticipant(metadata, senderIds);
    const target = buildTarget({
      jid: participant?.id || senderIds[0],
      participant,
      source: 'guard',
      metadata,
    });
    const mention = targetMention(target);
    const mentionList = [target.jid];

    if (action === 'delete') {
      logger?.info?.({ chat: chatId, kind, target: target.jid }, 'Guard menghapus pesan');
      return true;
    }

    if (action === 'kick') {
      try {
        await sock.groupParticipantsUpdate(chatId, [target.jid], 'remove');
        db.audit({
          actor: 'guard',
          action: `guard.kick.${kind}`,
          target: target.jid,
          meta: { chatId },
        });
        await notify(sock, chatId, t('guard.kicked', { user: mention, reason: kind }), mentionList);
      } catch (error) {
        logger?.warn?.(
          { err: error, chat: chatId, kind, target: target.jid },
          'Guard gagal mengeluarkan anggota',
        );
      }
      return true;
    }

    try {
      const result = await addWarningAndEscalate({
        db,
        logger,
        sock,
        chatId,
        target,
        reason: kind === 'link' ? t('guard.reasonLink') : t('guard.reasonSpam'),
        warnedBy: 'guard',
        metadata,
      });

      db.audit({
        actor: 'guard',
        action: `guard.warn.${kind}`,
        target: target.jid,
        meta: { chatId, count: result.count, limit: result.limit },
      });

      if (result.kicked) {
        await notify(sock, chatId, t('guard.kicked', { user: mention, reason: kind }), mentionList);
      } else if (result.needsAdmin) {
        await notify(sock, chatId, t('guard.limitNoAdmin', {
          user: mention,
          limit: result.limit,
        }), mentionList);
      } else {
        await notify(sock, chatId, t('guard.warned', {
          user: mention,
          count: result.count,
          limit: result.limit,
        }), mentionList);
      }
    } catch (error) {
      logger?.warn?.(
        { err: error, chat: chatId, kind, target: target.jid },
        'Guard gagal menambahkan warning',
      );
    }

    return true;
  }

  return {
    enforce,

    /**
     * @param {object} sock
     * @param {object} msg
     * @param {object} options
     * @returns {Promise<boolean>}
     */
    async handle(sock, msg, options) {
      return enforce(sock, msg, options);
    },

    reset() {
      spamState.clear();
    },

    resetChat(chatId) {
      const prefix = `${normalizeJid(chatId)}\u0000`;
      for (const key of spamState.keys()) {
        if (key.startsWith(prefix)) spamState.delete(key);
      }
    },
  };
}

module.exports = {
  LINK_PATTERN,
  VALID_ACTIONS,
  normalizeAction,
  createGuardService,
};
