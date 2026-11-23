const { command } = require('../../core/automationCommands');

module.exports = command('poll', 'tools', 'poll <pertanyaan> | <opsi1> | <opsi2>', (ctx) => {
  const [name, ...values] = ctx.rawArgs.split('|').map((part) => part.trim());
  if (!name || name.length > 255 || values.length < 2 || values.length > 12
    || values.some((value) => !value || value.length > 100)
    || new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
    return ctx.t('automation.pollUsage');
  }
  return ctx.send({ poll: { name, values, selectableCount: 1 } }, { quoted: false });
});
