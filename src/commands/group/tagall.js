/**
 * `.tagall [teks]` — mention seluruh anggota grup.
 */

const { jidToNumber } = require('../../utils/jid');

const MAX_MENTIONS = 512;

module.exports = {
  name: 'tagall',
  aliases: ['everyone'],
  category: 'group',
  description: 'Mention semua anggota grup',
  descriptionKey: 'commands.tagall.description',
  usage: 'tagall [teks]',
  examples: ['tagall Rapat dimulai jam 8', 'tagall'],
  permission: 'admin',
  scope: 'group',
  cooldown: 10,

  async execute(ctx) {
    const metadata = await ctx.getGroupMetadata();
    const participants = (metadata?.participants || [])
      .map((participant) => participant?.id)
      .filter(Boolean)
      .slice(0, MAX_MENTIONS);

    if (participants.length === 0) return ctx.t('group.noParticipants');

    const header = ctx.rawArgs.trim() || ctx.t('group.tagallDefault');
    const mentionsText = participants.map((jid) => `@${jidToNumber(jid)}`).join(' ');
    const text = `${header}\n\n${mentionsText}`;

    await ctx.send({ text, mentions: participants }, { quoted: false });
    return null;
  },
};
