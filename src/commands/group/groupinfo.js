/**
 * `.groupinfo` — ringkasan metadata grup.
 */

const { isBotAdmin } = require('../../utils/group');
const { formatDateTime } = require('../../utils/format');
const { jidToNumber } = require('../../utils/jid');
const { truncate } = require('../../utils/text');

module.exports = {
  name: 'groupinfo',
  aliases: ['infogrup', 'grupinfo'],
  category: 'group',
  description: 'Tampilkan informasi grup',
  descriptionKey: 'commands.groupinfo.description',
  usage: 'groupinfo',
  examples: ['groupinfo'],
  permission: 'admin',
  scope: 'group',
  cooldown: 5,

  async execute(ctx) {
    const metadata = await ctx.getGroupMetadata();
    if (!metadata) return ctx.t('group.metadataFailed');

    const participants = metadata.participants || [];
    const admins = participants.filter((participant) => (
      participant.admin === 'admin'
      || participant.admin === 'superadmin'
      || participant.isAdmin
      || participant.isSuperAdmin
    ));
    const owner = metadata.owner || metadata.ownerPn;
    const created = metadata.creation ? formatDateTime(metadata.creation, { dateOnly: true }) : '-';

    const lines = [
      ctx.t('group.info.title', { group: metadata.subject || ctx.t('common.group') }),
      '',
      `${ctx.t('group.info.id')}: ${metadata.id || ctx.chatId}`,
      `${ctx.t('group.info.created')}: ${created}`,
      `${ctx.t('group.info.owner')}: ${owner ? `+${jidToNumber(owner)}` : '-'}`,
      `${ctx.t('group.info.members')}: ${metadata.size ?? participants.length}`,
      `${ctx.t('group.info.admins')}: ${admins.length}`,
      `${ctx.t('group.info.messageMode')}: ${metadata.announce
        ? ctx.t('group.info.adminOnly')
        : ctx.t('group.info.allMembers')}`,
      `${ctx.t('group.info.editMode')}: ${metadata.restrict
        ? ctx.t('group.info.adminOnly')
        : ctx.t('group.info.allMembers')}`,
      `${ctx.t('group.info.addMode')}: ${metadata.memberAddMode
        ? ctx.t('group.info.allMembers')
        : ctx.t('group.info.adminOnly')}`,
      `${ctx.t('group.info.botAdmin')}: ${ctx.t(isBotAdmin(metadata, ctx.sock) ? 'common.yes' : 'common.no')}`,
      '',
      `${ctx.t('group.info.description')}:`,
      truncate(metadata.desc || '-', 300),
    ];

    return lines.join('\n');
  },
};
