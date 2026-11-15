/**
 * Middleware normalize: menyiapkan identitas pengirim, role, dan data dasar.
 */

const { collectSenderIds, isPhoneJid, jidToNumber, normalizeJid } = require('../../utils/jid');
const { isParticipantAdmin } = require('../../utils/group');
const { sanitizeName } = require('../../utils/text');

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.db
 * @param {(sock: object, groupId: string) => Promise<object>} options.getGroupMetadata
 */
function createNormalizeMiddleware({ config, db, getGroupMetadata }) {
  return async function normalize(ctx, next) {
    if (!Array.isArray(ctx.senderIds) || ctx.senderIds.length === 0) {
      ctx.senderIds = collectSenderIds(ctx.msg, ctx.chatId);
    }

    ctx.senderId = ctx.senderId || ctx.senderIds[0] || normalizeJid(ctx.chatId);
    ctx.isGroup = Boolean(ctx.isGroup);

    const senderNumbers = new Set(
      ctx.senderIds.filter(isPhoneJid).map(jidToNumber).filter(Boolean),
    );
    ctx.isOwner = config.ownerNumbers.some((number) => senderNumbers.has(number));

    if (ctx.isGroup && !ctx.groupMetadata) {
      try {
        ctx.groupMetadata = await getGroupMetadata(ctx.sock, ctx.chatId);
      } catch (error) {
        ctx.logger?.debug?.(
          { error: error.message, group: ctx.chatId },
          'Gagal mengambil metadata grup',
        );
      }
    }

    const storedUser = db.getUser(ctx.senderId);
    ctx.senderName = sanitizeName(ctx.msg?.pushName || storedUser?.name || 'Kak');

    db.ensureUser(ctx.senderId, { name: ctx.msg?.pushName || storedUser?.name || null });
    if (ctx.isGroup) {
      db.ensureGroup(ctx.chatId, { name: ctx.groupMetadata?.subject || null });
    }

    ctx.role = 'user';

    if (ctx.isOwner) {
      ctx.role = 'owner';
    } else {
      if (db.isPremium(ctx.senderId)) ctx.role = 'premium';
      if (ctx.groupMetadata && isParticipantAdmin(ctx.groupMetadata, ctx.senderIds)) {
        ctx.role = 'admin';
      }
    }

    await next();
  };
}

module.exports = {
  createNormalizeMiddleware,
};
