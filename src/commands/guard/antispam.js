/**
 * `.antispam [on|off|delete|warn|kick]` — guard spam di grup.
 */

const { executeGuardToggle } = require('../../utils/guardSettings');

module.exports = {
  name: 'antispam',
  aliases: ['nospam'],
  category: 'guard',
  description: 'Aktifkan guard spam di grup',
  descriptionKey: 'commands.antispam.description',
  usage: 'antispam [on|off|delete|warn|kick]',
  examples: ['antispam on', 'antispam kick', 'antispam off'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    return executeGuardToggle(ctx, {
      setting: 'antispam',
      actionSetting: 'antispam_action',
      feature: 'Antispam',
      command: 'antispam',
    });
  },
};
