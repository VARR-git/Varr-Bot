/**
 * `.unmute` — buka grup agar semua anggota bisa mengirim pesan.
 */

const { checkBotAdmin } = require('../../utils/groupModeration');

module.exports = {
  name: 'unmute',
  aliases: ['open'],
  category: 'group',
  description: 'Buka grup agar semua anggota bisa mengirim pesan',
  descriptionKey: 'commands.unmute.description',
  usage: 'unmute',
  examples: ['unmute'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const metadata = await ctx.getGroupMetadata();
    const botError = checkBotAdmin(ctx, metadata);
    if (botError) return ctx.t(botError);

    if (metadata?.announce === false) return ctx.t('group.alreadyUnmuted');

    await ctx.sock.groupSettingUpdate(ctx.chatId, 'not_announcement');
    ctx.db.audit({
      actor: ctx.senderId,
      action: 'group.unmute',
      target: ctx.chatId,
    });
    ctx.services.getGroupMetadata?.invalidate?.(ctx.chatId);

    return ctx.t('group.unmuted');
  },
};
