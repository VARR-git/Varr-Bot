/**
 * `.stats` — statistik penggunaan bot (tanpa menyimpan isi pesan).
 */

const { formatBytes, formatDuration, formatNumber } = require('../../utils/format');

const RESERVED_STATS = new Set(['command:total', 'command:error', 'command:unknown']);
const TOP_LIMIT = 5;

module.exports = {
  name: 'stats',
  aliases: ['statistik'],
  category: 'owner',
  description: 'Tampilkan statistik penggunaan bot',
  descriptionKey: 'commands.stats.description',
  usage: 'stats',
  examples: ['stats'],
  permission: 'owner',
  scope: 'all',
  cooldown: 5,
  maintenanceSafe: true,

  async execute(ctx) {
    const health = ctx.db.health();
    const top = ctx.db
      .topStats({ prefix: 'command:', limit: 20 })
      .filter((row) => !RESERVED_STATS.has(row.key))
      .slice(0, TOP_LIMIT)
      .map((row) => ctx.t('stats.topItem', {
        name: `${ctx.prefix}${row.key.slice('command:'.length)}`,
        count: formatNumber(row.value),
      }));

    return [
      ctx.t('stats.title', { bot: ctx.config.botName }),
      '',
      `${ctx.t('stats.commands')}: ${formatNumber(ctx.db.getStat('command:total'))}`,
      `${ctx.t('stats.errors')}: ${formatNumber(ctx.db.getStat('command:error'))}`,
      `${ctx.t('stats.unknown')}: ${formatNumber(ctx.db.getStat('command:unknown'))}`,
      `${ctx.t('stats.guard')}: ${formatNumber(ctx.db.getStat('guard:handled'))}`,
      `${ctx.t('stats.users')}: ${formatNumber(ctx.db.countUsers())}`,
      `${ctx.t('stats.groups')}: ${formatNumber(ctx.db.countGroups())}`,
      `${ctx.t('stats.warnings')}: ${formatNumber(ctx.db.countAllWarnings())}`,
      `${ctx.t('stats.database')}: ${ctx.t('stats.databaseValue', {
        size: formatBytes(health.sizeBytes),
        version: health.schemaVersion,
      })}`,
      `${ctx.t('stats.uptime')}: ${formatDuration(ctx.state.uptime())}`,
      `${ctx.t('stats.memory')}: ${formatBytes(process.memoryUsage().rss)}`,
      `${ctx.t('stats.mode')}: ${ctx.state.mode}${ctx.state.maintenance ? ' · maintenance' : ''}`,
      '',
      top.length > 0 ? ctx.t('stats.topCommands') : ctx.t('stats.empty'),
      ...top,
    ].join('\n');
  },
};
