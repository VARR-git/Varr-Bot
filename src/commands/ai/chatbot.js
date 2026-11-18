/**
 * `.chatbot on|off|status` — aktifkan/nonaktifkan balasan otomatis AI.
 *
 * Opt-in per chat/grup. Status disimpan di database agar persisten saat
 * restart. Di grup, hanya admin grup atau owner yang boleh mengubah status.
 */

const { isChatbotEnabled, setChatbotEnabled } = require('../../utils/chatbot');

module.exports = {
  name: 'chatbot',
  aliases: ['autochat', 'botchat'],
  category: 'ai',
  description: 'Aktifkan/nonaktifkan balasan otomatis AI di chat ini',
  descriptionKey: 'commands.chatbot.description',
  usage: 'chatbot [on|off|status]',
  examples: ['chatbot on', 'chatbot off', 'chatbot status'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,

  async execute(ctx) {
    // Di grup, hanya admin grup atau owner yang boleh menyalakan/mematikan.
    if (ctx.isGroup && ctx.role !== 'admin' && ctx.role !== 'owner') {
      return ctx.t('errors.permission', { role: ctx.t('roles.admin') });
    }

    const arg = String(ctx.args[0] || '').toLowerCase();

    if (!arg || arg === 'status') {
      const enabled = isChatbotEnabled(ctx.db, ctx.chatId, ctx.isGroup);
      return ctx.t('chatbot.status', {
        status: ctx.t(enabled ? 'common.enabled' : 'common.disabled'),
      });
    }

    if (arg === 'on' || arg === 'off') {
      const enabled = arg === 'on';
      setChatbotEnabled(ctx.db, ctx.chatId, ctx.isGroup, enabled);
      ctx.db.audit({
        actor: ctx.senderId,
        action: enabled ? 'chatbot.on' : 'chatbot.off',
        target: ctx.chatId,
      });
      return ctx.t(enabled ? 'chatbot.enabled' : 'chatbot.disabled');
    }

    return ctx.t('chatbot.usage', { prefix: ctx.prefix, command: ctx.command.name });
  },
};
