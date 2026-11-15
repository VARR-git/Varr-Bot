/**
 * `.setwarnlimit <1-10>` — atur jumlah warning sebelum anggota dikeluarkan.
 */

const {
  DEFAULT_WARN_LIMIT,
  MIN_WARN_LIMIT,
  MAX_WARN_LIMIT,
  getWarnLimit,
  parseWarnLimit,
} = require('../../services/warnings');

module.exports = {
  name: 'setwarnlimit',
  aliases: ['warnlimit'],
  category: 'guard',
  description: 'Atur batas warning sebelum anggota dikeluarkan',
  descriptionKey: 'commands.setwarnlimit.description',
  usage: 'setwarnlimit [1-10]',
  examples: ['setwarnlimit 3', 'setwarnlimit'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const current = getWarnLimit(ctx.db, ctx.chatId, DEFAULT_WARN_LIMIT);
    const raw = ctx.args[0];

    if (!raw) {
      return ctx.t('guard.warnLimitCurrent', {
        limit: current,
        min: MIN_WARN_LIMIT,
        max: MAX_WARN_LIMIT,
      });
    }

    const limit = parseWarnLimit(raw);
    if (limit === null) {
      return ctx.t('guard.warnLimitInvalid', { min: MIN_WARN_LIMIT, max: MAX_WARN_LIMIT });
    }

    ctx.db.setGroupSetting(ctx.chatId, 'warn_limit', limit);
    ctx.db.audit({
      actor: ctx.senderId,
      action: 'guard.warn_limit',
      target: ctx.chatId,
      meta: { from: current, to: limit },
    });

    return ctx.t('guard.warnLimitChanged', { limit });
  },
};
