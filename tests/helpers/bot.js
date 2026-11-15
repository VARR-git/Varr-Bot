/**
 * Helper test Varr-Bot: bot lengkap dengan socket palsu.
 *
 * Bukan file test (nama tidak cocok pola `*.test.js`), jadi tidak dijalankan
 * sendiri oleh `node --test`.
 */

const { loadConfig } = require('../../src/config');
const { createDatabase } = require('../../src/core/database');
const { createRuntimeState } = require('../../src/core/state');
const { CommandRegistry, loadCommands } = require('../../src/core/registry');
const { createDefaultMiddlewares } = require('../../src/core/middleware');
const { createMessageHandler } = require('../../src/core/handler');
const { createMessageCache } = require('../../src/core/messageCache');
const { createMediaService } = require('../../src/services/media');
const { createGuardService } = require('../../src/services/guard');

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

const OWNER = '628000000001@s.whatsapp.net';
const ADMIN = '628000000002@s.whatsapp.net';
const MEMBER = '628000000003@s.whatsapp.net';
const BOT = '628999999999@s.whatsapp.net';
const GROUP = '120363000000000001@g.us';
const DM = '628000000003@s.whatsapp.net';

let messageCounter = 0;

/**
 * sharp palsu: pipeline chainable yang mengembalikan buffer tetap.
 */
function createFakeSharp() {
  const calls = [];

  const pipeline = {
    rotate() {
      return pipeline;
    },
    resize() {
      return pipeline;
    },
    webp() {
      return pipeline;
    },
    png() {
      return pipeline;
    },
    jpeg() {
      return pipeline;
    },
    async toBuffer() {
      return Buffer.from('converted-media');
    },
  };

  const sharp = (buffer, options) => {
    calls.push({ buffer, options });
    return pipeline;
  };

  sharp.calls = calls;
  sharp.versions = { sharp: 'test' };

  return sharp;
}

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function defaultMetadata(overrides = {}) {
  return {
    id: GROUP,
    subject: 'Grup Uji',
    owner: ADMIN,
    desc: 'Grup untuk test',
    creation: 1_600_000_000,
    announce: false,
    restrict: false,
    memberAddMode: false,
    participants: [
      { id: BOT, admin: 'admin' },
      { id: ADMIN, admin: 'superadmin' },
      { id: MEMBER, admin: null },
    ],
    ...overrides,
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.metadata]
 * @param {object} [options.configOverrides]
 * @param {object|null} [options.downloader]
 * @param {boolean} [options.groupMetadataError]
 * @param {() => number} [options.now]
 * @param {object} [options.sharp]
 * @param {Function} [options.mediaDownloader]
 */
function createTestBot({
  metadata = defaultMetadata(),
  configOverrides = {},
  downloader = null,
  groupMetadataError = false,
  now,
  sharp = createFakeSharp(),
  mediaDownloader,
  databaseFilename = ':memory:',
} = {}) {
  const config = {
    ...loadConfig({
      OWNER_NUMBERS: '628000000001',
      LOG_LEVEL: 'silent',
      DEFAULT_LANG: 'id',
      COMMAND_COOLDOWN: '0',
      RATE_LIMIT_MAX: '100',
      RATE_LIMIT_WINDOW_MS: '60000',
    }),
    ...configOverrides,
  };

  const db = createDatabase({ config, filename: databaseFilename });
  const state = createRuntimeState({ config, db });
  const registry = new CommandRegistry();
  loadCommands(registry);

  const groupMetadata = (sock, groupId) => {
    if (groupMetadataError) return Promise.reject(new Error('metadata gagal'));
    return Promise.resolve({ ...metadata, id: groupId || metadata.id });
  };

  const messageCache = createMessageCache();

  // Clock default maju 60 detik setiap pemanggilan supaya cooldown/rate limit
  // tidak mengganggu test command. Test yang menguji waktu mengirim `now`.
  let clock = Date.now();
  const nowFn = now || (() => {
    clock += 60_000;
    return clock;
  });

  const media = createMediaService({
    config,
    logger: silentLogger,
    sharpLib: sharp,
    ...(mediaDownloader ? { downloader: mediaDownloader } : {}),
  });

  const guard = createGuardService({
    config,
    db,
    logger: silentLogger,
    getGroupMetadata: groupMetadata,
    now: nowFn,
  });

  const services = {
    getGroupMetadata: groupMetadata,
    messageCache,
    media,
    guard,
    downloader,
  };

  const middlewares = createDefaultMiddlewares({
    config,
    db,
    state,
    getGroupMetadata: groupMetadata,
    logger: silentLogger,
    now: nowFn,
  });

  const handler = createMessageHandler({
    config,
    logger: silentLogger,
    registry,
    db,
    state,
    middlewares,
    services,
  });

  const sent = [];
  const calls = {
    groupParticipantsUpdate: [],
    groupSettingUpdate: [],
    deletes: [],
  };

  const sock = {
    user: { id: BOT, lid: '999@lid' },
    async sendMessage(chatId, payload, options) {
      if (payload?.delete) calls.deletes.push({ chatId, key: payload.delete });

      sent.push({ chatId, payload, options });

      const message = typeof payload?.text === 'string'
        ? { extendedTextMessage: { text: payload.text } }
        : payload;

      return {
        key: { id: `out-${sent.length}`, remoteJid: chatId, fromMe: true },
        message,
      };
    },
    async groupMetadata(groupId) {
      if (groupMetadataError) throw new Error('metadata gagal');
      return { ...metadata, id: groupId || metadata.id };
    },
    async groupParticipantsUpdate(chatId, jids, action) {
      calls.groupParticipantsUpdate.push({ chatId, jids, action });
      return [];
    },
    async groupSettingUpdate(chatId, setting) {
      calls.groupSettingUpdate.push({ chatId, setting });

      // Metadata palsu ikut diperbarui agar command membaca state terbaru.
      if (setting === 'announcement') metadata.announce = true;
      if (setting === 'not_announcement') metadata.announce = false;
      if (setting === 'locked') metadata.restrict = true;
      if (setting === 'unlocked') metadata.restrict = false;

      return true;
    },
  };

  return {
    config,
    db,
    state,
    registry,
    handler,
    sock,
    sent,
    calls,
    services,
    media,
    guard,
    sharp,
    metadata,
    close: () => db.close(),
  };
}

/**
 * @param {object} [options]
 * @returns {object}
 */
function makeMessage({
  chatId = DM,
  text = '.ping',
  sender,
  id,
  fromMe = false,
  content,
  mentions = [],
  quoted = null,
} = {}) {
  const isGroup = String(chatId).endsWith('@g.us');
  const senderJid = sender || (isGroup ? MEMBER : chatId);

  let message = content;

  if (!message) {
    const contextInfo = {};

    if (mentions.length > 0) contextInfo.mentionedJid = mentions;

    if (quoted) {
      contextInfo.participant = quoted.sender || MEMBER;
      contextInfo.stanzaId = quoted.id || `quoted-${++messageCounter}`;
      contextInfo.quotedMessage = quoted.content || { conversation: quoted.text || '' };
    }

    message = Object.keys(contextInfo).length > 0
      ? { extendedTextMessage: { text, contextInfo } }
      : { conversation: text };
  }

  return {
    key: {
      remoteJid: chatId,
      fromMe,
      id: id || `m-${++messageCounter}`,
      ...(isGroup ? { participant: senderJid } : {}),
    },
    pushName: 'Tester',
    message,
  };
}

/**
 * @param {object} bot
 * @returns {string}
 */
function lastText(bot) {
  for (let index = bot.sent.length - 1; index >= 0; index -= 1) {
    const payload = bot.sent[index].payload;
    if (typeof payload?.text === 'string') return payload.text;
  }
  return '';
}

/**
 * @param {object} bot
 * @returns {object|undefined}
 */
function lastPayload(bot) {
  return bot.sent.at(-1)?.payload;
}

/**
 * @param {() => boolean} check
 * @param {number} [timeoutMs]
 */
async function waitFor(check, timeoutMs = 2_000) {
  const started = Date.now();

  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

module.exports = {
  OWNER,
  ADMIN,
  MEMBER,
  BOT,
  GROUP,
  DM,
  silentLogger,
  createFakeSharp,
  defaultMetadata,
  createTestBot,
  makeMessage,
  lastText,
  lastPayload,
  waitFor,
};
