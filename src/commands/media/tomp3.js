/**
 * `.tomp3` — konversi video/audio yang dikirim atau di-reply menjadi MP3.
 */

const { AUDIO_MEDIA_KEYS } = require('../../services/media');

module.exports = {
  name: 'tomp3',
  aliases: ['toaudio'],
  category: 'media',
  description: 'Ubah video/audio menjadi file MP3',
  descriptionKey: 'commands.tomp3.description',
  usage: 'tomp3 (kirim/reply video atau audio)',
  examples: ['tomp3 (reply video)', 'tomp3 (kirim audio dengan caption .tomp3)'],
  permission: 'user',
  scope: 'all',
  cooldown: 10,
  // Konversi FFmpeg bisa lebih lama dari timeout command global (default 30 detik).
  timeoutMs: 300_000,

  async execute(ctx) {
    const media = ctx.services.media;
    if (!media || !media.findMedia) return ctx.t('media.unavailable');

    const found = media.findMedia(ctx.msg, AUDIO_MEDIA_KEYS);
    if (!found) return ctx.t('media.tomp3Usage', { prefix: ctx.prefix });

    const maxMb = Math.round(media.maxBytes / (1024 * 1024));
    if (found.size && found.size > media.maxBytes) {
      return ctx.t('media.tooLarge', { max: maxMb });
    }

    await ctx.react('⏳');

    let buffer;
    try {
      buffer = await media.download(ctx.sock, found);
    } catch (error) {
      ctx.logger.warn(
        { error: error.message, chat: ctx.chatId },
        'Gagal mengunduh media tomp3',
      );
      return ctx.t('media.downloadFailed');
    }

    if (!buffer || buffer.length === 0) return ctx.t('media.downloadFailed');
    if (buffer.length > media.maxBytes) return ctx.t('media.tooLarge', { max: maxMb });

    let audio;
    try {
      audio = await media.toMp3(buffer);
    } catch (error) {
      ctx.logger.warn(
        { error: error.message, code: error.code, chat: ctx.chatId },
        'Gagal mengonversi audio',
      );
      if (error.code === 'DURATION_TOO_LONG') {
        return ctx.t('media.durationTooLong', {
          max: media.maxAudioSeconds || 600,
        });
      }
      if (error.code === 'FFMPEG_MISSING') return ctx.t('media.ffmpegMissing');
      return ctx.t('media.tomp3Failed');
    }

    if (!audio || audio.length === 0) return ctx.t('media.tomp3Failed');
    
    await ctx.react('✅');
    await ctx.send(
      { audio, mimetype: 'audio/mpeg', fileName: 'audio.mp3' },
      { quoted: false },
    );
    return null;
  },
};
