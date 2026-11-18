/**
 * `.readqr` — baca isi teks/link dari gambar QR Code yang dikirim atau di-reply.
 */

module.exports = {
  name: 'readqr',
  aliases: ['scanqr', 'bacaqr'],
  category: 'media',
  description: 'Baca isi QR Code dari gambar',
  descriptionKey: 'commands.readqr.description',
  usage: 'readqr (kirim/reply gambar QR)',
  examples: ['readqr (reply gambar QR)', 'readqr (kirim gambar QR dengan caption .readqr)'],
  permission: 'user',
  scope: 'all',
  cooldown: 5,

  async execute(ctx) {
    const media = ctx.services.media;
    if (!media || !media.findMedia) return ctx.t('media.unavailable');
    if (!media.readQrAvailable) return ctx.t('media.readqrUnavailable');

    const found = media.findMedia(ctx.msg);
    if (!found || found.kind !== 'image') {
      return ctx.t('media.readqrUsage', { prefix: ctx.prefix });
    }

    const maxMb = Math.round(media.maxBytes / (1024 * 1024));
    if (found.size && found.size > media.maxBytes) {
      return ctx.t('media.tooLarge', { max: maxMb });
    }

    let buffer;
    try {
      buffer = await media.download(ctx.sock, found);
    } catch (error) {
      ctx.logger.warn(
        { error: error.message, chat: ctx.chatId },
        'Gagal mengunduh media readqr',
      );
      return ctx.t('media.downloadFailed');
    }

    if (!buffer || buffer.length === 0) return ctx.t('media.downloadFailed');
    if (buffer.length > media.maxBytes) return ctx.t('media.tooLarge', { max: maxMb });

    let result;
    try {
      result = await media.readQr(buffer);
    } catch (error) {
      ctx.logger.warn(
        { error: error.message, code: error.code, chat: ctx.chatId },
        'Gagal membaca QR Code',
      );
      if (error.code === 'QR_NOT_FOUND') return ctx.t('media.readqrNotFound');
      return ctx.t('media.readqrFailed');
    }

    if (!result) return ctx.t('media.readqrNotFound');

    await ctx.send(
      { text: ctx.t('media.readqrResult', { result }) },
      { quoted: false },
    );
    return null;
  },
};
