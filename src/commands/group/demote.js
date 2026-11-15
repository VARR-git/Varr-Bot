/**
 * `.demote <mention|reply|nomor>` — cabut status admin anggota.
 */

const {
  checkBotAdmin,
  checkTarget,
  replyWithMention,
  targetMention,
} = require('../../utils/groupModeration');
const { isAdminTarget, resolveGroupTarget } = require('../../utils/groupTarget');

module.exports = {
  name: 'demote',
  aliases: ['turunkan'],
  category: 'group',
  description: 'Cabut status admin anggota grup',
  descriptionKey: 'commands.demote.description',
  usage: 'demote <@user|reply|nomor>',
  examples: ['demote @6281234567890', 'demote (reply pesan)'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const target = resolveGroupTarget(ctx);
    if (!target) {
      return ctx.t('group.targetMissing', { prefix: ctx.prefix, command: 'demote' });
    }

    const metadata = await ctx.getGroupMetadata();
    const botError = checkBotAdmin(ctx, metadata);
    if (botError) return ctx.t(botError);

    const targetError = checkTarget(ctx, metadata, target, { adminAllowed: true });
    if (targetError) return ctx.t(targetError);

    if (!isAdminTarget(metadata, target)) {
      return ctx.t('group.targetNotAdmin', { user: targetMention(target) });
    }

    await ctx.sock.groupParticipantsUpdate(ctx.chatId, [target.jid], 'demote');
    ctx.db.audit({
      actor: ctx.senderId,
      action: 'group.demote',
      target: target.jid,
      meta: { chatId: ctx.chatId },
    });
    ctx.services.getGroupMetadata?.invalidate?.(ctx.chatId);

    await replyWithMention(
      ctx,
      ctx.t('group.demoted', { user: targetMention(target) }),
      target,
    );
    return null;
  },
};
