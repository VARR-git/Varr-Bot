/**
 * `.mute` — tutup grup agar hanya admin yang bisa mengirim pesan.
 */

const { checkBotAdmin } = require('../../utils/groupModeration');

module.exports = {
  name: 'mute',
  aliases: ['close'],
  category: 'group',
  description: 'Tutup grup (hanya admin yang bisa mengirim pesan)',
  descriptionKey: 'commands.mute.description',
  usage: 'mute',
  examples: ['mute'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const metadata = await ctx.getGroupMetadata();
    const botError = checkBotAdmin(ctx, metadata);
    if (botError) return ctx.t(botError);

    if (metadata?.announce) return ctx.t('group.alreadyMuted');

    await ctx.sock.groupSettingUpdate(ctx.chatId, 'announcement');
    ctx.db.audit({
      actor: ctx.senderId,
      action: 'group.mute',
      target: ctx.chatId,
    });
    ctx.services.getGroupMetadata?.invalidate?.(ctx.chatId);

    return ctx.t('group.muted');
  },
};
