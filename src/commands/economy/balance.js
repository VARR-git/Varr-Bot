/**
 * `.balance` — lihat koin, XP, dan level sendiri atau user yang disebut.
 */

const { formatNumber } = require('../../utils/economy');
const { resolveTarget, displayName } = require('./_shared');

module.exports = {
  name: 'balance',
  aliases: ['bal', 'saldo'],
  category: 'economy',
  description: 'Cek koin, XP, dan level',
  descriptionKey: 'commands.balance.description',
  usage: 'balance [@user]',
  examples: ['balance', 'bal @6281234567890'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,

  async execute(ctx) {
    const target = resolveTarget(ctx);
    const user = ctx.db.ensureUser(target);

    return [
      ctx.t('economy.balance.title', { user: displayName(user, target) }),
      ctx.t('economy.balance.line', {
        balance: formatNumber(user.balance),
        xp: formatNumber(user.xp),
        level: user.level,
      }),
    ].join('\n');
  },
};
