/**
 * `.sticker` — ubah gambar (atau sticker yang di-reply) menjadi sticker WebP.
 */

module.exports = {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  category: 'media',
  description: 'Ubah gambar menjadi sticker',
  descriptionKey: 'commands.sticker.description',
  usage: 'sticker (kirim/reply gambar)',
  examples: ['sticker (reply gambar)', 'sticker (kirim gambar dengan caption .sticker)'],
  permission: 'user',
  scope: 'all',
  cooldown: 5,

  async execute(ctx) {
    const media = ctx.services.media;
    if (!media || !media.available) return ctx.t('media.unavailable');

    const found = media.findMedia(ctx.msg);
    if (!found) return ctx.t('media.stickerUsage', { prefix: ctx.prefix });

    if (found.kind === 'video') return ctx.t('media.videoUnsupported');

    const maxMb = Math.round(media.maxBytes / (1024 * 1024));
    if (found.size && found.size > media.maxBytes) {
      return ctx.t('media.tooLarge', { max: maxMb });
    }

    let buffer;
    try {
      buffer = await media.download(ctx.sock, found);
    } catch (error) {
      ctx.logger.warn({ err: error, chat: ctx.chatId }, 'Gagal mengunduh media sticker');
      return ctx.t('media.downloadFailed');
    }

    if (!buffer || buffer.length === 0) return ctx.t('media.downloadFailed');
    if (buffer.length > media.maxBytes) return ctx.t('media.tooLarge', { max: maxMb });

    let sticker;
    try {
      sticker = await media.toSticker(buffer);
    } catch (error) {
      ctx.logger.warn({ err: error, chat: ctx.chatId }, 'Gagal mengonversi sticker');
      return ctx.t('media.convertFailed');
    }

    await ctx.send({ sticker }, { quoted: false });
    return null;
  },
};
