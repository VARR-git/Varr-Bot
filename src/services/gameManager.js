/**
 * Manajemen sesi mini game per chat.
 *
 * State disimpan di Map berdasarkan chatId sehingga satu grup tidak pernah
 * memengaruhi grup lain. Setiap input menjadwal ulang timeout; tanpa input
 * selama `defaultTimeoutMs` sesi dihapus otomatis.
 */

const { sanitizeName } = require('../utils/text');

const DEFAULT_TIMEOUT_MS = 75_000;

const REWARDS = {
  ttt: { win: 100, xp: 50, draw: 25 },
  hangman: { win: 80, xp: 40 },
  trivia: { win: 60, xp: 30 },
};

const SURRENDER_RE = /^(nyerah|surrender)$/i;

/**
 * @param {object} [options]
 * @param {number} [options.defaultTimeoutMs]
 * @param {object} [options.logger]
 */
function createGameManager({ defaultTimeoutMs = DEFAULT_TIMEOUT_MS, logger } = {}) {
  /** @type {Map<string, object>} */
  const sessions = new Map();

  function clearTimer(session) {
    if (session?.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
  }

  function finish(chatId) {
    const session = sessions.get(chatId);
    if (!session) return false;
    clearTimer(session);
    sessions.delete(chatId);
    return true;
  }

  function isActive(chatId) {
    return sessions.has(chatId);
  }

  function get(chatId) {
    return sessions.get(chatId) || null;
  }

  function arm(chatId, session) {
    clearTimer(session);
    const timeout = Number(session.timeoutMs) || defaultTimeoutMs;
    session.timer = setTimeout(async () => {
      if (sessions.get(chatId) !== session) return;
      sessions.delete(chatId);
      session.timer = null;
      try {
        await session.onTimeout?.();
      } catch (error) {
        logger?.warn?.({ err: error, chat: chatId }, 'Game timeout handler gagal');
      }
    }, timeout);
    session.timer.unref?.();
  }

  function start(chatId, session) {
    finish(chatId);
    sessions.set(chatId, session);
    arm(chatId, session);
    return session;
  }

  function accepts(chatId, text) {
    const session = sessions.get(chatId);
    if (!session) return false;
    const value = String(text || '').trim();
    if (!value) return false;
    if (SURRENDER_RE.test(value)) return true;
    return typeof session.accepts === 'function' ? session.accepts(value) : true;
  }

  function award(session, jid, { coins = 0, xp = 0 } = {}) {
    const db = session?.db;
    if (!db || !jid || jid === 'bot') return;
    try {
      if (coins) db.addBalance?.(jid, coins);
      if (xp) db.addXp?.(jid, xp);
    } catch (error) {
      logger?.warn?.({ err: error }, 'Gagal memberi hadiah game');
    }
  }

  async function surrender({ chatId, senderId, senderName, reply }) {
    const session = sessions.get(chatId);
    if (!session) return false;
    const t = session.t || ((key) => key);
    finish(chatId);
    const player = senderName || String(senderId || '').split('@')[0];
    await reply?.(t('games.surrender.done', { player }));
    return true;
  }

  async function handleInput({ chatId, senderId, senderName, text, reply }) {
    const session = sessions.get(chatId);
    if (!session || !accepts(chatId, text)) return false;

    const name = senderName || session.db?.getUser?.(senderId)?.name;
    senderName = name ? sanitizeName(name) : undefined;

    const input = String(text).trim();
    if (SURRENDER_RE.test(input)) {
      return surrender({ chatId, senderId, senderName, reply });
    }

    const api = {
      finish: () => finish(chatId),
      reward: (jid, amount) => award(session, jid, amount),
    };

    const handled = await session.onInput(input, { senderId, senderName, reply }, api);

    if (sessions.get(chatId) === session) arm(chatId, session);
    return handled !== false;
  }

  function dispose() {
    for (const chatId of [...sessions.keys()]) finish(chatId);
  }

  return {
    start,
    finish,
    isActive,
    get,
    accepts,
    handleInput,
    surrender,
    dispose,
    defaultTimeoutMs,
  };
}

let sharedManager;

/** Dipakai bila bootstrap belum menyuntikkan `services.gameManager`. */
function getDefaultGameManager() {
  if (!sharedManager) sharedManager = createGameManager();
  return sharedManager;
}

module.exports = {
  createGameManager,
  getDefaultGameManager,
  REWARDS,
  DEFAULT_TIMEOUT_MS,
};
