/**
 * `.qr <teks/url>` — ubah teks atau URL menjadi gambar QR Code.
 */

function argText(ctx) {
  if (Array.isArray(ctx.args)) return ctx.args.join(' ').trim();
  if (typeof ctx.args === 'string') return ctx.args.trim();
  if (typeof ctx.text === 'string') {
    return ctx.text.replace(/^\S+\s*/, '').trim();
  }
  return '';
}

module.exports = {
  name: 'qr',
  aliases: ['qrcode', 'buatqr'],
  category: 'media',
  description: 'Ubah teks atau URL menjadi QR Code',
  descriptionKey: 'commands.qr.description',
  usage: 'qr <teks/url>',
  examples: ['qr https://example.com', 'qr Halo dunia'],
  permission: 'user',
  scope: 'all',
  cooldown: 5,

  async execute(ctx) {
    const media = ctx.services.media;
    if (!media || !media.toQr) return ctx.t('media.unavailable');
    if (!media.qrAvailable) return ctx.t('media.qrUnavailable');

    const text = argText(ctx);
    if (!text) return ctx.t('media.qrUsage', { prefix: ctx.prefix });
    if (text.length > 2000) return ctx.t('media.qrTooLong');

    let image;
    try {
      image = await media.toQr(text);
    } catch (error) {
      ctx.logger.warn(
        { error: error.message, code: error.code, chat: ctx.chatId },
        'Gagal membuat QR Code',
      );
      return ctx.t('media.qrFailed');
    }

    await ctx.send(
      { image, caption: ctx.t('media.qrCaption') },
      { quoted: false },
    );
    return null;
  },
};
