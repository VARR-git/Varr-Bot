/**
 * `.resetai` — hapus riwayat percakapan AI untuk user/chat ini.
 */

const { resolveScope } = require('./_shared');

module.exports = {
  name: 'resetai',
  aliases: ['clearai', 'resetgpt'],
  category: 'ai',
  description: 'Hapus riwayat percakapan AI di chat ini',
  descriptionKey: 'commands.resetai.description',
  usage: 'resetai',
  examples: ['resetai'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,

  async execute(ctx) {
    const memory = ctx.services?.aiMemory;
    if (!memory) return ctx.t('ai.unavailable');

    const scope = resolveScope(ctx);
    const removed = memory.reset(scope);

    return removed
      ? ctx.t('resetai.done')
      : ctx.t('resetai.empty');
  },
};
