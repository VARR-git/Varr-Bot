/**
 * `.guardstatus` — ringkasan konfigurasi guard grup.
 */

const { isBotAdmin } = require('../../utils/group');
const { normalizeAction } = require('../../services/guard');
const { getWarnLimit } = require('../../services/warnings');

module.exports = {
  name: 'guardstatus',
  aliases: ['statusguard'],
  category: 'guard',
  description: 'Lihat status guard grup',
  descriptionKey: 'commands.guardstatus.description',
  usage: 'guardstatus',
  examples: ['guardstatus'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const metadata = await ctx.getGroupMetadata();
    const antilink = Boolean(ctx.db.getGroupSetting(ctx.chatId, 'antilink', false));
    const antispam = Boolean(ctx.db.getGroupSetting(ctx.chatId, 'antispam', false));
    const antilinkAction = normalizeAction(
      ctx.db.getGroupSetting(ctx.chatId, 'antilink_action', 'delete'),
    );
    const antispamAction = normalizeAction(
      ctx.db.getGroupSetting(ctx.chatId, 'antispam_action', 'delete'),
    );
    const limit = getWarnLimit(ctx.db, ctx.chatId);

    const status = (enabled) => ctx.t(enabled ? 'common.enabled' : 'common.disabled');

    return [
      ctx.t('guard.status.title'),
      '',
      `${ctx.t('guard.status.antilink')}: ${status(antilink)} (${antilinkAction})`,
      `${ctx.t('guard.status.antispam')}: ${status(antispam)} (${antispamAction})`,
      `${ctx.t('guard.status.warnLimit')}: ${limit}`,
      `${ctx.t('guard.status.botAdmin')}: ${ctx.t(isBotAdmin(metadata, ctx.sock) ? 'common.yes' : 'common.no')}`,
      '',
      ctx.t('guard.status.hint', { prefix: ctx.prefix }),
    ].join('\n');
  },
};
