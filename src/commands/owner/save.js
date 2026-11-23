const { command, toggle, statusQuote } = require('../../core/automationCommands');
const { automationFor } = require('../../core/automation');
const { isPhoneJid } = require('../../utils/jid');

module.exports = command('save', 'owner', 'save on/off | reply status', async (ctx) => {
  if (ctx.isGroup || !isPhoneJid(ctx.chatId)) return ctx.t('errors.privateOnly');
  const automation = automationFor(ctx.sock);
  if (ctx.rawArgs.trim()) return toggle(ctx, 'save', (enabled) => automation.toggle('save', enabled));
  const entry = automation.enabled('save') && statusQuote(ctx);
  if (!entry) return ctx.t('automation.saveUsage');
  const type = ['image', 'video', 'audio'].find((name) => entry.content[`${name}Message`]);
  if (!type) return ctx.t('automation.saveUsage');
  const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
  const media = entry.content[`${type}Message`];
  const maxBytes = 16 * 1024 * 1024;
  if (Number(media.fileLength) > maxBytes) return ctx.t('automation.saveLimit');
  const stream = await downloadContentFromMessage(media, type);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) return ctx.t('automation.saveLimit');
    chunks.push(chunk);
  }
  if (!automation.enabled('save')) return ctx.t('automation.saveUsage');
  await ctx.send({ [type]: Buffer.concat(chunks), mimetype: media.mimetype }, { quoted: false });
}, 'owner');
