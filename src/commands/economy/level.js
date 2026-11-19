/**
 * `.level` — detail level, progress XP, dan peringkat.
 */

const {
  levelProgress,
  renderBar,
  formatNumber,
} = require('../../utils/economy');
const { resolveTarget, displayName } = require('./_shared');

module.exports = {
  name: 'level',
  aliases: ['rank'],
  category: 'economy',
  description: 'Lihat level, progress XP, dan peringkat',
  descriptionKey: 'commands.level.description',
  usage: 'level [@user]',
  examples: ['level', 'rank @6281234567890'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,

  async execute(ctx) {
    const target = resolveTarget(ctx);
    const user = ctx.db.ensureUser(target);
    const progress = levelProgress(user.xp);
    const rank = ctx.db.getRank(target, 'level');

    return [
      ctx.t('economy.level.title', { user: displayName(user, target) }),
      ctx.t('economy.level.current', { level: progress.level }),
      ctx.t('economy.level.progress', {
        bar: renderBar(progress.percent),
        percent: progress.percent,
        current: formatNumber(progress.current),
        needed: formatNumber(progress.needed),
      }),
      ctx.t('economy.level.total', { xp: formatNumber(user.xp) }),
      ctx.t('economy.level.rank', { rank: rank || '-' }),
    ].join('\n');
  },
};
