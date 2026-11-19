/**
 * `.leaderboard` — top 10 user berdasarkan koin atau level.
 */

const { formatNumber } = require('../../utils/economy');
const { displayName } = require('./_shared');

module.exports = {
  name: 'leaderboard',
  aliases: ['lb', 'top'],
  category: 'economy',
  description: 'Tampilkan top 10 user berdasarkan koin atau level',
  descriptionKey: 'commands.leaderboard.description',
  usage: 'leaderboard [balance|level]',
  examples: ['leaderboard', 'lb level'],
  permission: 'user',
  scope: 'all',
  cooldown: 5,

  async execute(ctx) {
    const by = String(ctx.args?.[0] || '').toLowerCase() === 'level' ? 'level' : 'balance';
    const rows = ctx.db.getLeaderboard({ by, limit: 10 });

    if (!rows.length) return ctx.t('economy.leaderboard.empty');

    const lines = [
      ctx.t(by === 'level'
        ? 'economy.leaderboard.titleLevel'
        : 'economy.leaderboard.titleBalance'),
    ];

    rows.forEach((row, index) => {
      lines.push(ctx.t('economy.leaderboard.item', {
        rank: index + 1,
        user: displayName(row, row.jid),
        value: by === 'level'
          ? ctx.t('economy.leaderboard.levelValue', {
            level: row.level,
            xp: formatNumber(row.xp),
          })
          : ctx.t('economy.leaderboard.balanceValue', {
            balance: formatNumber(row.balance),
          }),
      }));
    });

    return lines.join('\n');
  },
};
