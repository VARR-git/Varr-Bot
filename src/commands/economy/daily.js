/**
 * `.daily` — klaim koin + XP harian (sekali per 24 jam).
 */

const {
  DAILY_COINS,
  DAILY_XP,
  DAILY_COOLDOWN_MS,
  formatNumber,
} = require('../../utils/economy');
const { formatDuration } = require('../../utils/format');

module.exports = {
  name: 'daily',
  category: 'economy',
  description: 'Klaim hadiah koin dan XP harian',
  descriptionKey: 'commands.daily.description',
  usage: 'daily',
  examples: ['daily'],
  permission: 'user',
  scope: 'all',
  cooldown: 5,

  async execute(ctx) {
    const result = ctx.db.claimDaily(ctx.senderId, {
      coins: DAILY_COINS,
      xp: DAILY_XP,
      cooldownMs: DAILY_COOLDOWN_MS,
    });

    if (!result.ok) {
      return ctx.t('economy.daily.wait', { time: formatDuration(result.remainingMs) });
    }

    const lines = [
      ctx.t('economy.daily.claimed', {
        coins: formatNumber(result.coins),
        xp: formatNumber(result.xp),
      }),
      ctx.t('economy.balance.line', {
        balance: formatNumber(result.user.balance),
        xp: formatNumber(result.user.xp),
        level: result.user.level,
      }),
    ];

    if (result.leveledUp) {
      lines.push(ctx.t('economy.levelUp', { level: result.toLevel }));
    }

    return lines.join('\n');
  },
};
