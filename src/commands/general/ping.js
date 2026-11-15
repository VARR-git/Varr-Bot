/**
 * `.ping` — latensi, uptime, memori, dan status database.
 */

const { formatBytes, formatDuration } = require('../../utils/format');

module.exports = {
  name: 'ping',
  aliases: ['p'],
  category: 'general',
  description: 'Cek latensi, uptime, dan status bot',
  descriptionKey: 'commands.ping.description',
  usage: 'ping',
  examples: ['ping'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,
  maintenanceSafe: true,

  async execute(ctx) {
    const latency = Date.now() - ctx.startedAt;
    const health = ctx.db.health();
    const memory = process.memoryUsage();

    return [
      ctx.t('ping.title'),
      `${ctx.t('ping.latency')} : ${latency} ms`,
      `${ctx.t('ping.uptime')}  : ${formatDuration(ctx.state.uptime())}`,
      `${ctx.t('ping.memory')}  : ${formatBytes(memory.rss)}`,
      `${ctx.t('ping.database')}: ${health.ok ? 'SQLite ✓' : 'SQLite ✗'}`,
      `${ctx.t('ping.commands')}: ${ctx.registry.size}`,
      `${ctx.t('ping.version')} : ${ctx.config.version}`,
      `${ctx.t('ping.node')}    : ${process.version}`,
    ].join('\n');
  },
};
