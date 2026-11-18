/**
 * `.toimg` — ubah sticker yang di-reply menjadi gambar PNG.
 */

module.exports = {
  name: 'toimg',
  aliases: ['toimage', 'sticker2img'],
  category: 'media',
  description: 'Ubah sticker menjadi gambar PNG',
  descriptionKey: 'commands.toimg.description',
  usage: 'toimg (reply sticker)',
  examples: ['toimg (reply sticker)'],
  permission: 'user',
  scope: 'all',
  cooldown: 5,

  async execute(ctx) {
    const media = ctx.services.media;
    if (!media || !media.available) return ctx.t('media.unavailable');

    const found = media.findMedia(ctx.msg);
    if (!found) return ctx.t('media.toimgUsage', { prefix: ctx.prefix });
    if (found.kind !== 'sticker') return ctx.t('media.toimgOnlySticker');
    
    const maxMb = Math.round(media.maxBytes / (1024 * 1024));
    if (found.size && found.size > media.maxBytes) {
      return ctx.t('media.tooLarge', { max: maxMb });
    }

    await ctx.react('⏳');

    let buffer;
    try {
      buffer = await media.download(ctx.sock, found);
    } catch (error) {
      // Hanya pesan error: objek error Baileys bisa memuat URL CDN.
      ctx.logger.warn(
        { error: error.message, chat: ctx.chatId },
        'Gagal mengunduh sticker',
      );
      return ctx.t('media.downloadFailed');
    }

    if (!buffer || buffer.length === 0) return ctx.t('media.downloadFailed');
    if (buffer.length > media.maxBytes) return ctx.t('media.tooLarge', { max: maxMb });

    let image;
    try {
      image = await media.toImage(buffer, 'png');
    } catch (error) {
      ctx.logger.warn(
        { error: error.message, chat: ctx.chatId },
        'Gagal mengonversi sticker ke gambar',
      );
      return ctx.t('media.convertFailed');
    }
    
    await ctx.react('✅');
    await ctx.send({ image, caption: ctx.t('media.toimgCaption') }, { quoted: false });
    return null;
  },
};
