/**
 * `.promote <mention|reply|nomor>` — jadikan anggota sebagai admin grup.
 */

const {
  checkBotAdmin,
  checkTarget,
  replyWithMention,
  targetMention,
} = require('../../utils/groupModeration');
const { isAdminTarget, resolveGroupTarget } = require('../../utils/groupTarget');

module.exports = {
  name: 'promote',
  aliases: ['naikkan'],
  category: 'group',
  description: 'Jadikan anggota sebagai admin grup',
  descriptionKey: 'commands.promote.description',
  usage: 'promote <@user|reply|nomor>',
  examples: ['promote @6281234567890', 'promote (reply pesan)'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const target = resolveGroupTarget(ctx);
    if (!target) {
      return ctx.t('group.targetMissing', { prefix: ctx.prefix, command: 'promote' });
    }

    const metadata = await ctx.getGroupMetadata();
    const botError = checkBotAdmin(ctx, metadata);
    if (botError) return ctx.t(botError);

    const targetError = checkTarget(ctx, metadata, target, { adminAllowed: true });
    if (targetError) return ctx.t(targetError);

    if (isAdminTarget(metadata, target)) {
      return ctx.t('group.alreadyAdmin', { user: targetMention(target) });
    }

    await ctx.sock.groupParticipantsUpdate(ctx.chatId, [target.jid], 'promote');
    ctx.db.audit({
      actor: ctx.senderId,
      action: 'group.promote',
      target: target.jid,
      meta: { chatId: ctx.chatId },
    });
    ctx.services.getGroupMetadata?.invalidate?.(ctx.chatId);

    await replyWithMention(
      ctx,
      ctx.t('group.promoted', { user: targetMention(target) }),
      target,
    );
    return null;
  },
};
