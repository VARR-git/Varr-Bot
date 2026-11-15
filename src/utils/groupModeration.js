/**
 * Validasi umum command moderasi grup.
 */

const { isBotAdmin } = require('./group');
const {
  isAdminTarget,
  isBotTarget,
  isGroupOwnerTarget,
  isOwnerTarget,
  targetMatches,
  targetMention,
} = require('./groupTarget');

/**
 * @param {object} ctx
 * @param {object|null} metadata
 * @returns {string|null} key i18n error atau null
 */
function checkBotAdmin(ctx, metadata) {
  return isBotAdmin(metadata, ctx.sock) ? null : 'group.botNotAdmin';
}

/**
 * @param {object} options
 * @param {object} options.ctx
 * @param {object|null} options.metadata
 * @param {object|null} options.target
 * @param {boolean} [options.adminAllowed] Izinkan target admin (mis. promote).
 * @param {boolean} [options.requireParticipant]
 * @param {boolean} [options.allowSelf]
 * @returns {string|null} key i18n error atau null
 */
function checkTarget(ctx, metadata, target, {
  adminAllowed = false,
  requireParticipant = true,
  allowSelf = false,
} = {}) {
  if (!target) return 'group.targetMissing';
  if (requireParticipant && !target.participant) return 'group.targetNotMember';
  if (!allowSelf && targetMatches(target, ctx.senderIds)) return 'group.targetSelf';
  if (isBotTarget(ctx, target)) return 'group.protectedBot';
  if (isOwnerTarget(ctx, target) && !ctx.isOwner) return 'group.protectedOwner';
  if (isGroupOwnerTarget(metadata, target)) return 'group.protectedGroupOwner';
  if (!adminAllowed && isAdminTarget(metadata, target) && !ctx.isOwner) {
    return 'group.targetAdmin';
  }
  return null;
}

/**
 * @param {object} ctx
 * @param {string} text
 * @param {object} target
 * @returns {Promise<object|null>}
 */
async function replyWithMention(ctx, text, target) {
  return ctx.send({ text, mentions: [target.jid] }, { quoted: false });
}

/**
 * @param {object} ctx
 * @param {object} target
 * @param {string[]} [parts]
 * @returns {string}
 */
function withReason(ctx, target, parts = target.remainingArgs || []) {
  const reason = parts.join(' ').trim().slice(0, 200);
  if (!reason) return '';
  return `\n${ctx.t('group.reason', { reason })}`;
}

module.exports = {
  checkBotAdmin,
  checkTarget,
  replyWithMention,
  withReason,
  targetMention,
};
