/**
 * `.kick <mention|reply|nomor> [alasan]` — keluarkan anggota dari grup.
 */

const {
  checkBotAdmin,
  checkTarget,
  replyWithMention,
  withReason,
  targetMention,
} = require('../../utils/groupModeration');
const { resolveGroupTarget } = require('../../utils/groupTarget');

module.exports = {
  name: 'kick',
  aliases: ['tendang'],
  category: 'group',
  description: 'Keluarkan anggota dari grup',
  descriptionKey: 'commands.kick.description',
  usage: 'kick <@user|reply|nomor> [alasan]',
  examples: ['kick @6281234567890', 'kick (reply pesan) spam'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const target = resolveGroupTarget(ctx);
    if (!target) {
      return ctx.t('group.targetMissing', { prefix: ctx.prefix, command: 'kick' });
    }

    const metadata = await ctx.getGroupMetadata();
    const botError = checkBotAdmin(ctx, metadata);
    if (botError) return ctx.t(botError);

    const targetError = checkTarget(ctx, metadata, target);
    if (targetError) return ctx.t(targetError);

    await ctx.sock.groupParticipantsUpdate(ctx.chatId, [target.jid], 'remove');
    ctx.db.clearWarnings(ctx.chatId, target.jid);
    ctx.db.audit({
      actor: ctx.senderId,
      action: 'group.kick',
      target: target.jid,
      meta: { chatId: ctx.chatId, reason: target.remainingArgs.join(' ') || null },
    });
    ctx.services.getGroupMetadata?.invalidate?.(ctx.chatId);

    await replyWithMention(
      ctx,
      `${ctx.t('group.kicked', { user: targetMention(target) })}${withReason(ctx, target)}`,
      target,
    );
    return null;
  },
};
