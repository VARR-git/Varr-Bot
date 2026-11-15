/**
 * `.alive` — status singkat bot.
 */

const { formatDuration } = require('../../utils/format');

module.exports = {
  name: 'alive',
  category: 'general',
  description: 'Cek apakah bot aktif',
  descriptionKey: 'commands.alive.description',
  usage: 'alive',
  examples: ['alive'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,
  maintenanceSafe: true,

  async execute(ctx) {
    return [
      ctx.t('alive.title', { bot: ctx.config.botName }),
      '',
      `${ctx.t('alive.status')}  : ${ctx.t('alive.online')} 🟢`,
      `${ctx.t('alive.uptime')} : ${formatDuration(ctx.state.uptime())}`,
      `${ctx.t('alive.mode')}    : ${ctx.state.mode}`,
      `${ctx.t('alive.prefix')} : ${ctx.config.prefixes.join(' ')}`,
      `${ctx.t('alive.version')} : ${ctx.config.version}`,
      '',
      ctx.t('alive.footer', { prefix: ctx.prefix }),
    ].join('\n');
  },
};
