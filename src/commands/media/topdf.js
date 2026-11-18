/**
 * `.topdf` — ubah gambar yang dikirim/di-reply atau teks argumen menjadi PDF.
 */

function unwrap(message) {
  if (!message) return null;
  if (message.ephemeralMessage?.message) return unwrap(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrap(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrap(message.viewOnceMessageV2.message);
  return message;
}

function quotedText(msg) {
  const content = unwrap(msg?.message);
  const quoted = content?.extendedTextMessage?.contextInfo?.quotedMessage
    || content?.imageMessage?.contextInfo?.quotedMessage
    || content?.videoMessage?.contextInfo?.quotedMessage;
  const unwrapped = unwrap(quoted);
  return unwrapped?.conversation
    || unwrapped?.extendedTextMessage?.text
    || unwrapped?.imageMessage?.caption
    || '';
}

function argText(ctx) {
  if (Array.isArray(ctx.args)) return ctx.args.join(' ').trim();
  if (typeof ctx.args === 'string') return ctx.args.trim();
  if (typeof ctx.text === 'string') {
    return ctx.text.replace(/^\S+\s*/, '').trim();
  }
  return '';
}

module.exports = {
  name: 'topdf',
  aliases: ['pdf'],
  category: 'media',
  description: 'Ubah gambar atau teks menjadi file PDF',
  descriptionKey: 'commands.topdf.description',
  usage: 'topdf (kirim/reply gambar) atau topdf <teks>',
  examples: ['topdf (reply gambar)', 'topdf Catatan penting hari ini'],
  permission: 'user',
  scope: 'all',
  cooldown: 8,

  async execute(ctx) {
    const media = ctx.services.media;
    if (!media || !media.toPdf) return ctx.t('media.unavailable');
    if (!media.pdfAvailable) return ctx.t('media.pdfUnavailable');

    const maxMb = Math.round(media.maxBytes / (1024 * 1024));
    const found = media.findMedia?.(ctx.msg);
    const isImage = found && found.kind === 'image';

    if (found && found.size && found.size > media.maxBytes) {
      return ctx.t('media.tooLarge', { max: maxMb });
    }

    let text = '';
    let image;

    if (isImage) {
      try {
        image = await media.download(ctx.sock, found);
      } catch (error) {
        ctx.logger.warn(
          { error: error.message, chat: ctx.chatId },
          'Gagal mengunduh media topdf',
        );
        return ctx.t('media.downloadFailed');
      }
      if (!image || image.length === 0) return ctx.t('media.downloadFailed');
      if (image.length > media.maxBytes) return ctx.t('media.tooLarge', { max: maxMb });
    } else {
      text = argText(ctx) || quotedText(ctx.msg).trim();
      if (!text) return ctx.t('media.topdfUsage', { prefix: ctx.prefix });
      if (text.length > 20000) return ctx.t('media.pdfTooLong');
    }

    let pdf;
    try {
      pdf = await media.toPdf(image ? { image } : { text });
    } catch (error) {
      ctx.logger.warn(
        { error: error.message, code: error.code, chat: ctx.chatId },
        'Gagal membuat PDF',
      );
      return ctx.t('media.topdfFailed');
    }

    if (!pdf || pdf.length === 0) return ctx.t('media.topdfFailed');

    await ctx.send(
      {
        document: pdf,
        mimetype: 'application/pdf',
        fileName: 'document.pdf',
        caption: ctx.t('media.topdfCaption'),
      },
      { quoted: false },
    );
    return null;
  },
};
