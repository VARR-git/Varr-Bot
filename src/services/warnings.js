/**
 * Peringatan (warning) grup dan eskalasinya.
 *
 * WhatsApp tidak menyediakan mute per anggota. Karena itu eskalasi yang
 * diimplementasikan: warning ke-N pada batas → keluarkan anggota dari grup
 * (kick). Keputusan ini dicatat di docs/DECISIONS.md (ADR-009).
 */

const { isBotAdmin } = require('../utils/group');

const DEFAULT_WARN_LIMIT = 3;
const MIN_WARN_LIMIT = 1;
const MAX_WARN_LIMIT = 10;

/**
 * @param {object} db
 * @param {string} chatId
 * @param {number} [fallback]
 * @returns {number}
 */
function getWarnLimit(db, chatId, fallback = DEFAULT_WARN_LIMIT) {
  const value = Number(db.getGroupSetting(chatId, 'warn_limit', fallback));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_WARN_LIMIT, Math.max(MIN_WARN_LIMIT, Math.trunc(value)));
}

/**
 * @param {number} value
 * @returns {number|null}
 */
function parseWarnLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_WARN_LIMIT || parsed > MAX_WARN_LIMIT) {
    return null;
  }
  return parsed;
}

/**
 * Menambah warning dan mengeluarkan anggota bila batas tercapai.
 *
 * @param {object} options
 * @param {object} options.db
 * @param {object} options.logger
 * @param {object} options.sock
 * @param {string} options.chatId
 * @param {object} options.target Hasil resolve target.
 * @param {string|null} [options.reason]
 * @param {string} options.warnedBy
 * @param {object|null} [options.metadata]
 * @returns {Promise<{warningId: number, count: number, limit: number, kicked: boolean, needsAdmin: boolean}>}
 */
async function addWarningAndEscalate({
  db,
  logger,
  sock,
  chatId,
  target,
  reason = null,
  warnedBy,
  metadata = null,
}) {
  const targetJid = target.participant?.id || target.jid;
  const limit = getWarnLimit(db, chatId);
  const warningId = db.addWarning(chatId, targetJid, { reason, warnedBy });
  const count = db.countWarnings(chatId, targetJid);

  db.audit({
    actor: warnedBy,
    action: 'warning.add',
    target: targetJid,
    meta: { chatId, reason, count, limit, warningId },
  });

  logger?.info?.(
    { chat: chatId, target: targetJid, count, limit, warnedBy },
    'Warning grup ditambahkan',
  );

  if (count < limit) {
    return { warningId, count, limit, kicked: false, needsAdmin: false };
  }

  if (!isBotAdmin(metadata, sock)) {
    return { warningId, count, limit, kicked: false, needsAdmin: true };
  }

  try {
    await sock.groupParticipantsUpdate(chatId, [targetJid], 'remove');
  } catch (error) {
    logger?.warn?.(
      { err: error, chat: chatId, target: targetJid },
      'Gagal mengeluarkan anggota setelah batas warning',
    );
    return { warningId, count, limit, kicked: false, needsAdmin: false };
  }

  db.clearWarnings(chatId, targetJid);
  db.audit({
    actor: warnedBy,
    action: 'warning.kick',
    target: targetJid,
    meta: { chatId, count, limit, reason },
  });

  return { warningId, count, limit, kicked: true, needsAdmin: false };
}

module.exports = {
  DEFAULT_WARN_LIMIT,
  MIN_WARN_LIMIT,
  MAX_WARN_LIMIT,
  getWarnLimit,
  parseWarnLimit,
  addWarningAndEscalate,
};
