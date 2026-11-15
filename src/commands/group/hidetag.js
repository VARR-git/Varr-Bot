/**
 * `.hidetag [teks]` — kirim pesan yang menotifikasi semua anggota tanpa
 * menampilkan mention.
 */

const MAX_MENTIONS = 512;

module.exports = {
  name: 'hidetag',
  aliases: ['ht'],
  category: 'group',
  description: 'Kirim pesan ke semua anggota tanpa mention terlihat',
  descriptionKey: 'commands.hidetag.description',
  usage: 'hidetag [teks]',
  examples: ['hidetag Pengumuman penting', 'hidetag'],
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

    const text = ctx.rawArgs.trim() || ctx.t('group.hidetagDefault');
    await ctx.send({ text, mentions: participants }, { quoted: false });
    return null;
  },
};
