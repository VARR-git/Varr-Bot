const { command } = require('../../core/automationCommands');
const { automationFor } = require('../../core/automation');

module.exports = command('remind', 'tools', 'remind <waktu> <pesan>', (ctx) => {
  const match = /^(\d+)([smh])\s+([\s\S]+)$/i.exec(ctx.rawArgs.trim());
  const delay = match && Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[match[2].toLowerCase()];
  if (!delay || delay > 86_400_000 || match[3].length > 2_000) return ctx.t('automation.remindUsage');
  const text = ctx.t('automation.reminder', { message: match[3] });
  const added = automationFor(ctx.sock).remind(delay,
    (sock) => sock.sendMessage(ctx.chatId, { text, mentions: ctx.isGroup ? [ctx.senderId] : [] }),
    (error) => ctx.logger.warn?.({ err: error }, 'Gagal mengirim pengingat'));
  return ctx.t(added ? 'automation.remindSet' : 'automation.remindLimit');
});
