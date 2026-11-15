/**
 * Resolusi target command grup dari mention, reply, atau nomor telepon.
 *
 * Semua target dipetakan ke metadata grup agar:
 * - LID dan nomor telepon tidak tertukar.
 * - Command tidak bisa menargetkan orang di luar grup.
 * - ID yang dipakai saat memanggil API Baileys adalah ID participant yang benar.
 */

const {
  collectSenderIds,
  isPhoneJid,
  jidToNumber,
  normalizeJid,
} = require('./jid');
const {
  findParticipant,
  getContextInfo,
  isParticipantAdmin,
  participantIds,
  sameIdentity,
  toIdentity,
} = require('./group');
const { unwrapMessage } = require('./text');

const NUMBER_PATTERN = /^\+?\d{6,}$/;
const MENTION_PATTERN = /^@\d{6,}$/;

/**
 * @param {string} jid
 * @returns {string}
 */
function digitsJid(jid) {
  const digits = jidToNumber(jid);
  return digits ? `${digits}@s.whatsapp.net` : '';
}

/**
 * @param {object} target
 * @param {string[]|string} jids
 * @returns {boolean}
 */
function targetMatches(target, jids) {
  if (!target) return false;

  const values = Array.isArray(jids) ? jids : [jids];
  const targets = values.map(toIdentity).filter(Boolean);
  const ids = (target.ids || [target.jid]).map(toIdentity).filter(Boolean);

  return ids.some((id) => targets.some((value) => sameIdentity(id, value)));
}

/**
 * @param {object} options
 * @param {string} options.jid
 * @param {object|null} [options.participant]
 * @param {string} [options.source]
 * @param {object|null} [options.metadata]
 * @returns {object}
 */
function buildTarget({ jid, participant = null, source = 'manual', metadata = null }) {
  const normalized = normalizeJid(jid);
  const resolved = participant || findParticipant(metadata, [normalized]);
  const ids = new Set([normalized]);

  if (resolved) {
    for (const id of participantIds(resolved)) ids.add(normalizeJid(id));
  }

  const primary = resolved?.id ? normalizeJid(resolved.id) : normalized;

  return {
    jid: primary,
    ids: [...ids].filter(Boolean),
    participant: resolved || null,
    source,
  };
}

/**
 * Menentukan target command grup.
 *
 * Urutan prioritas: mention → pesan yang di-reply → nomor pada argumen.
 *
 * @param {object} ctx
 * @returns {{jid: string, ids: string[], participant: object|null, source: string, remainingArgs: string[]}|null}
 */
function resolveGroupTarget(ctx) {
  const content = unwrapMessage(ctx?.msg?.message) || {};
  const context = getContextInfo(content);
  const metadata = ctx?.groupMetadata || null;
  const args = Array.isArray(ctx?.args) ? ctx.args : [];

  const candidates = [];

  for (const jid of context?.mentionedJid || []) {
    candidates.push({ jid, source: 'mention', argIndex: -1 });
  }

  if (context?.participant) {
    candidates.push({ jid: context.participant, source: 'quoted', argIndex: -1 });
  }

  const numberIndex = args.findIndex((arg) => NUMBER_PATTERN.test(arg));
  if (numberIndex >= 0) {
    candidates.push({
      jid: `${args[numberIndex].replace(/\D/g, '')}@s.whatsapp.net`,
      source: 'number',
      argIndex: numberIndex,
    });
  }

  if (candidates.length === 0) return null;

  const candidate = candidates[0];
  const target = buildTarget({
    jid: candidate.jid,
    source: candidate.source,
    metadata,
  });

  const remainingArgs = args.filter((arg, index) => (
    index !== candidate.argIndex && !MENTION_PATTERN.test(arg)
  ));

  return { ...target, remainingArgs };
}

/**
 * Target dari pengirim sendiri, dipakai saat target tidak disebutkan.
 *
 * @param {object} ctx
 * @param {object|null} [metadata]
 * @returns {object}
 */
function resolveSenderTarget(ctx, metadata = ctx?.groupMetadata || null) {
  const senderIds = collectSenderIds(ctx.msg, ctx.chatId);
  const jid = senderIds[0] || ctx.senderId || ctx.chatId;
  return buildTarget({ jid, source: 'sender', metadata });
}

/**
 * @param {object} target
 * @returns {string}
 */
function targetMention(target) {
  return `@${jidToNumber(target?.jid)}`;
}

/**
 * @param {object} target
 * @returns {string}
 */
function targetNumber(target) {
  return jidToNumber(target?.jid);
}

/**
 * @param {object} target
 * @returns {string}
 */
function targetName(target) {
  const participant = target?.participant;
  return participant?.name
    || participant?.notify
    || participant?.verifiedName
    || targetNumber(target)
    || 'pengguna';
}

/**
 * Apakah target adalah bot sendiri.
 *
 * @param {object} ctx
 * @param {object} target
 * @returns {boolean}
 */
function isBotTarget(ctx, target) {
  return targetMatches(target, [ctx?.sock?.user?.id, ctx?.sock?.user?.lid].filter(Boolean));
}

/**
 * Apakah target adalah owner yang dikonfigurasi.
 * Hanya JID nomor telepon yang dihitung agar LID tidak bisa menyamar.
 *
 * @param {object} ctx
 * @param {object} target
 * @returns {boolean}
 */
function isOwnerTarget(ctx, target) {
  const numbers = new Set(ctx?.config?.ownerNumbers || []);
  if (numbers.size === 0) return false;

  return (target?.ids || [target?.jid]).some((jid) => (
    isPhoneJid(jid) && numbers.has(jidToNumber(jid))
  ));
}

/**
 * Apakah target adalah pembuat/owner grup.
 *
 * @param {object|null} metadata
 * @param {object} target
 * @returns {boolean}
 */
function isGroupOwnerTarget(metadata, target) {
  if (!metadata) return false;
  return targetMatches(target, [metadata.owner, metadata.ownerPn].filter(Boolean));
}

/**
 * @param {object|null} metadata
 * @param {object} target
 * @returns {boolean}
 */
function isAdminTarget(metadata, target) {
  return isParticipantAdmin(metadata, target?.ids || [target?.jid]);
}

module.exports = {
  NUMBER_PATTERN,
  MENTION_PATTERN,
  buildTarget,
  targetMatches,
  resolveGroupTarget,
  resolveSenderTarget,
  targetMention,
  targetNumber,
  targetName,
  isBotTarget,
  isOwnerTarget,
  isGroupOwnerTarget,
  isAdminTarget,
  digitsJid,
};
