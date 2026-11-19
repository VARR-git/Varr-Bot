/**
 * Helper bersama command economy. File berawalan `_` tidak dimuat sebagai command.
 */

const { getContextInfo } = require('../../utils/group');
const { unwrapMessage } = require('../../utils/text');

/**
 * Target command: user yang di-mention, lalu user yang di-reply, lalu pengirim.
 *
 * @param {object} ctx
 * @returns {string}
 */
function resolveTarget(ctx) {
  const content = unwrapMessage(ctx.msg?.message) || {};
  const info = getContextInfo(content) || {};

  if (Array.isArray(info.mentionedJid) && info.mentionedJid[0]) {
    return info.mentionedJid[0];
  }

  return info.participant || ctx.senderId;
}

/**
 * @param {object|null} user
 * @param {string} jid
 * @returns {string}
 */
function displayName(user, jid) {
  return user?.name || String(jid || '').split('@')[0] || '?';
}

module.exports = { resolveTarget, displayName };
