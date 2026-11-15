/**
 * Logika bersama command welcome/goodbye.
 */

const MAX_TEMPLATE_LENGTH = 1_000;

/**
 * @param {object} ctx
 * @param {object} options
 * @param {string} options.setting Key saklar, mis. `welcome`.
 * @param {string} options.textSetting Key teks kustom.
 * @param {string} options.feature Nama fitur untuk pesan.
 * @param {string} options.command Nama command.
 * @param {string} options.defaultKey Key i18n template default.
 * @returns {Promise<string>}
 */
async function executeGroupMessageSetting(ctx, {
  setting,
  textSetting,
  feature,
  command,
  defaultKey,
}) {
  const action = String(ctx.args[0] || '').toLowerCase();
  const enabled = Boolean(ctx.db.getGroupSetting(ctx.chatId, setting, false));
  const custom = String(ctx.db.getGroupSetting(ctx.chatId, textSetting, '') || '');
  const defaultText = ctx.t(defaultKey);
  const currentText = custom || defaultText;

  if (!action) {
    return [
      ctx.t('group.message.title', { feature }),
      ctx.t('group.message.status', {
        status: ctx.t(enabled ? 'common.enabled' : 'common.disabled'),
      }),
      ctx.t('group.message.text', { text: currentText }),
      custom ? '' : ctx.t('group.message.usingDefault'),
      '',
      ctx.t('group.message.placeholders'),
      ctx.t('group.message.usage', { prefix: ctx.prefix, command }),
    ].filter((line) => line !== '').join('\n');
  }

  if (action === 'on' || action === 'off') {
    const next = action === 'on';
    if (enabled === next) {
      return ctx.t('group.message.status', {
        status: ctx.t(next ? 'common.enabled' : 'common.disabled'),
      });
    }

    ctx.db.setGroupSetting(ctx.chatId, setting, next);
    ctx.db.audit({
      actor: ctx.senderId,
      action: `${setting}.toggle`,
      target: ctx.chatId,
      meta: { enabled: next },
    });

    return ctx.t(next ? 'group.message.enabled' : 'group.message.disabled', { feature });
  }

  if (action === 'reset') {
    ctx.db.deleteGroupSetting(ctx.chatId, textSetting);
    ctx.db.audit({
      actor: ctx.senderId,
      action: `${setting}.text.reset`,
      target: ctx.chatId,
    });
    return ctx.t('group.message.reset', { feature });
  }

  if (action === 'set') {
    const text = ctx.rawArgs.slice(3).trim();
    if (!text) return ctx.t('group.message.empty');
    if (text.length > MAX_TEMPLATE_LENGTH) {
      return ctx.t('group.message.tooLong', { max: MAX_TEMPLATE_LENGTH });
    }

    ctx.db.setGroupSetting(ctx.chatId, textSetting, text);
    ctx.db.audit({
      actor: ctx.senderId,
      action: `${setting}.text.set`,
      target: ctx.chatId,
      meta: { length: text.length },
    });

    return ctx.t('group.message.saved', { feature });
  }

  return ctx.t('group.message.usage', { prefix: ctx.prefix, command });
}

module.exports = {
  MAX_TEMPLATE_LENGTH,
  executeGroupMessageSetting,
};
