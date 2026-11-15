/**
 * `.goodbye` — atur pesan perpisahan anggota yang keluar.
 */

const { executeGroupMessageSetting } = require('../../utils/groupMessages');

module.exports = {
  name: 'goodbye',
  aliases: ['selamatjalan'],
  category: 'group',
  description: 'Atur pesan goodbye untuk anggota yang keluar',
  descriptionKey: 'commands.goodbye.description',
  usage: 'goodbye [on|off|set <teks>|reset]',
  examples: [
    'goodbye',
    'goodbye on',
    'goodbye set {name} telah meninggalkan *{group}*.',
  ],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    return executeGroupMessageSetting(ctx, {
      setting: 'goodbye',
      textSetting: 'goodbye_text',
      feature: 'Goodbye',
      command: 'goodbye',
      defaultKey: 'groupEvents.goodbyeDefault',
    });
  },
};
