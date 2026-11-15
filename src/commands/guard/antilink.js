/**
 * `.antilink [on|off|delete|warn|kick]` — guard tautan di grup.
 */

const { executeGuardToggle } = require('../../utils/guardSettings');

module.exports = {
  name: 'antilink',
  aliases: ['nolink'],
  category: 'guard',
  description: 'Aktifkan guard tautan di grup',
  descriptionKey: 'commands.antilink.description',
  usage: 'antilink [on|off|delete|warn|kick]',
  examples: ['antilink on', 'antilink warn', 'antilink off'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    return executeGuardToggle(ctx, {
      setting: 'antilink',
      actionSetting: 'antilink_action',
      feature: 'Antilink',
      command: 'antilink',
    });
  },
};
