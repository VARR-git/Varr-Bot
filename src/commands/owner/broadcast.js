const { command, toggle } = require('../../core/automationCommands');
const { automationFor } = require('../../core/automation');
const { normalizeJid } = require('../../utils/jid');

module.exports = command('broadcast', 'owner', 'broadcast <pesan> | on/off', async (ctx) => {
  const automation = automationFor(ctx.sock);
  const text = ctx.rawArgs.trim();
  if (/^(on|off)$/i.test(text)) {
    return toggle(ctx, 'broadcast', (enabled) => automation.toggle('broadcast', enabled));
  }
  if (!text || text.length > 4_000) return ctx.t('automation.broadcastUsage');
  const targets = [...new Set((process.env.BROADCAST_TARGETS || '').split(',')
    .map((jid) => normalizeJid(jid.trim()))
    .filter((jid) => /^\d+(?:-\d+)?@g\.us$|^\d+@s\.whatsapp\.net$/.test(jid)))];
  if (!targets.length) return ctx.t('automation.broadcastTargets');
  // Release the chat queue so `.bc off` can cancel a running batch in the same chat.
  automation.broadcast(targets, (jid) => ctx.sock.sendMessage(jid, { text }))
    .then((result) => ctx.reply(typeof result === 'number'
      ? ctx.t('automation.broadcastDone', { count: result })
      : ctx.t(`automation.broadcast_${result}`)))
    .catch(async (error) => {
      ctx.logger.warn?.({ err: error }, 'Broadcast dihentikan karena gagal');
      await ctx.reply(ctx.t('automation.broadcastFailed')).catch(() => {});
    });
}, 'owner');
