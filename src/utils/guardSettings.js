/**
 * Logika bersama command antilink/antispam.
 */

const { VALID_ACTIONS, normalizeAction } = require('../services/guard');

/**
 * @param {object} ctx
 * @param {object} options
 * @param {string} options.setting
 * @param {string} options.actionSetting
 * @param {string} options.feature
 * @param {string} options.command
 * @returns {Promise<string>}
 */
async function executeGuardToggle(ctx, {
  setting,
  actionSetting,
  feature,
  command,
}) {
  const arg = String(ctx.args[0] || '').toLowerCase();
  const enabled = Boolean(ctx.db.getGroupSetting(ctx.chatId, setting, false));
  const action = normalizeAction(ctx.db.getGroupSetting(ctx.chatId, actionSetting, 'delete'));

  if (!arg) {
    return [
      ctx.t('guard.status.title'),
      ctx.t('guard.featureStatus', {
        feature,
        status: ctx.t(enabled ? 'common.enabled' : 'common.disabled'),
      }),
      ctx.t('guard.action', { action }),
      '',
      ctx.t('guard.actionsList'),
      ctx.t('guard.usage', { prefix: ctx.prefix, command }),
    ].join('\n');
  }

  if (arg === 'on' || arg === 'off') {
    const next = arg === 'on';
    ctx.db.setGroupSetting(ctx.chatId, setting, next);
    ctx.db.audit({
      actor: ctx.senderId,
      action: `${setting}.toggle`,
      target: ctx.chatId,
      meta: { enabled: next, action },
    });

    return ctx.t(next ? 'guard.featureEnabled' : 'guard.featureDisabled', { feature });
  }

  if (VALID_ACTIONS.has(arg)) {
    ctx.db.setGroupSetting(ctx.chatId, setting, true);
    ctx.db.setGroupSetting(ctx.chatId, actionSetting, arg);
    ctx.db.audit({
      actor: ctx.senderId,
      action: `${setting}.action`,
      target: ctx.chatId,
      meta: { action: arg },
    });

    return ctx.t('guard.actionChanged', { feature, action: arg });
  }

  return [
    ctx.t('guard.actionsList'),
    ctx.t('guard.usage', { prefix: ctx.prefix, command }),
  ].join('\n');
}

module.exports = {
  executeGuardToggle,
};
