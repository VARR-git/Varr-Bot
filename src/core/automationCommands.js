const { automationFor } = require('./automation');
const { isParticipantAdmin, getContextInfo } = require('../utils/group');
const { isPhoneJid } = require('../utils/jid');
const { unwrapMessage } = require('../utils/text');

function command(name, category, usage, execute, permission = 'user', scope) {
  return {
    name, category, usage, permission, scope,
    aliases: name === 'broadcast' ? ['bc'] : [],
    descriptionKey: `automation.${name}`,
    execute(ctx) {
      if (permission === 'owner' && !ctx.isOwner) return ctx.t('errors.permission', { role: 'Owner' });
      return execute(ctx);
    },
  };
}

function toggle(ctx, name, setting) {
  const value = ctx.rawArgs.trim().toLowerCase();
  if (value !== 'on' && value !== 'off') {
    return ctx.t('automation.toggleUsage', { prefix: ctx.prefix, name });
  }
  return Promise.resolve(setting(value === 'on')).then(() => ctx.t('automation.toggled', { name, value }));
}

function ownerToggle(name) {
  return command(name, 'owner', `${name} on/off`, (ctx) => (
    toggle(ctx, name, (enabled) => automationFor(ctx.sock).toggle(name, enabled))
  ), 'owner');
}

function groupGuard(name, usage = `${name} on/off`) {
  return command(name, 'group', usage, async (ctx) => {
    const automation = automationFor(ctx.sock);
    if (!ctx.isGroup) {
      if (name === 'antidelete' && ctx.isOwner && isPhoneJid(ctx.chatId)) {
        return toggle(ctx, name, (enabled) => automation.toggle(name, enabled));
      }
      return ctx.t('errors.groupOnly');
    }
    if (!ctx.isOwner && !isParticipantAdmin(await ctx.getGroupMetadata(), ctx.senderIds)) {
      return ctx.t('errors.permission', { role: ctx.t('roles.admin') });
    }
    const [action, ...args] = ctx.args;
    const operation = action?.toLowerCase();
    if (name === 'antibadword' && ['add', 'remove', 'list'].includes(operation)) {
      const key = 'antibadword_words';
      const words = ctx.db.getGroupSetting(ctx.chatId, key, []);
      if (operation === 'list') return words.join(', ') || ctx.t('common.none');
      const word = args.join(' ').normalize('NFKC').toLowerCase();
      if (!/^[\p{L}\p{N}\p{M}]{1,40}$/u.test(word)) return ctx.t('automation.wordUsage');
      const next = operation === 'add' ? [...new Set([...words, word])] : words.filter((w) => w !== word);
      if (next.length > 100) return ctx.t('automation.wordLimit');
      await ctx.db.setGroupSetting(ctx.chatId, key, next);
      return ctx.t('automation.wordSaved');
    }
    return toggle(ctx, name, async (enabled) => {
      await ctx.db.setGroupSetting(ctx.chatId, name, enabled);
      if (name === 'antidelete' && !enabled) automation.purge(false, ctx.chatId);
    });
  }, name === 'antidelete' ? 'user' : 'admin', name === 'antidelete' ? undefined : 'group');
}

function statusQuote(ctx) {
  const quote = getContextInfo(unwrapMessage(ctx.msg.message));
  if (quote?.remoteJid && quote.remoteJid !== 'status@broadcast') return;
  if (!quote?.stanzaId || !quote.participant) return;
  return automationFor(ctx.sock).recall({
    remoteJid: 'status@broadcast', id: quote.stanzaId, participant: quote.participant,
  });
}

module.exports = { command, toggle, ownerToggle, groupGuard, statusQuote };
