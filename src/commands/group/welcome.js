/**
 * `.welcome` — atur pesan sambutan anggota baru.
 */

const { executeGroupMessageSetting } = require('../../utils/groupMessages');

module.exports = {
  name: 'welcome',
  aliases: ['selamatdatang'],
  category: 'group',
  description: 'Atur pesan welcome untuk anggota baru',
  descriptionKey: 'commands.welcome.description',
  usage: 'welcome [on|off|set <teks>|reset]',
  examples: [
    'welcome',
    'welcome on',
    'welcome set Halo {mention}, selamat datang di *{group}*!',
  ],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    return executeGroupMessageSetting(ctx, {
      setting: 'welcome',
      textSetting: 'welcome_text',
      feature: 'Welcome',
      command: 'welcome',
      defaultKey: 'groupEvents.welcomeDefault',
    });
  },
};
