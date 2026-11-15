/**
 * Resolusi target command `.ban` dan `.unban`.
 *
 * Target bisa berupa:
 * - kata kunci `group`/`grup` → grup tempat command dikirim;
 * - mention, reply, atau nomor telepon → pengguna.
 */

const { isBotTarget, isOwnerTarget, resolveGroupTarget } = require('./groupTarget');

const GROUP_KEYWORDS = new Set(['group', 'grup', 'g']);

/**
 * @param {object} ctx
 * @returns {Promise<{type: 'group'}|{type: 'protected'}|{type: 'user', target: object, metadata: object|null}|null>}
 */
async function resolveBanTarget(ctx) {
  const keyword = String(ctx.args?.[0] || '').toLowerCase();

  if (GROUP_KEYWORDS.has(keyword)) {
    if (!ctx.isGroup) return { type: 'group' };
    return { type: 'group' };
  }

  const target = resolveGroupTarget(ctx);
  if (!target) return null;

  if (isBotTarget(ctx, target) || isOwnerTarget(ctx, target)) {
    return { type: 'protected' };
  }

  let metadata = null;
  if (ctx.isGroup) {
    try {
      metadata = await ctx.getGroupMetadata();
    } catch {
      metadata = null;
    }
  }

  return { type: 'user', target, metadata };
}

/**
 * @param {object} ctx
 * @param {string} text
 * @param {object} target
 * @returns {Promise<object|null>}
 */
async function replyWithUserMention(ctx, text, target) {
  if (!ctx.isGroup || !target?.jid) return ctx.reply(text);
  return ctx.send({ text, mentions: [target.jid] }, { quoted: false });
}

module.exports = {
  GROUP_KEYWORDS,
  resolveBanTarget,
  replyWithUserMention,
};
