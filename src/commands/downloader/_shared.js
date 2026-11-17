/**
 * Helper bersama command downloader (`ytmp3`, `ytmp4`, `tiktok`).
 *
 * File ini sengaja diawali `_` agar tidak dimuat sebagai command oleh
 * `loadCommands` (lihat `core/registry.js`).
 */

const { AppError } = require('../../core/errors');
const { formatBytes } = require('../../utils/format');
const { formatClock } = require('../../services/downloader');
const { truncate } = require('../../utils/text');

const URL_PATTERN = /^https?:\/\//i;

/**
 * Pesan pengguna untuk error downloader.
 *
 * @param {object} ctx
 * @param {Error} error
 * @param {string} platformLabel
 * @returns {string}
 */
function describeError(ctx, error, platformLabel) {
  const meta = error instanceof AppError ? error.meta || {} : {};

  switch (error?.code) {
    case 'DOWNLOAD_INVALID_URL':
      return ctx.t('downloader.invalidUrl', { prefix: ctx.prefix, command: ctx.command.name });
    case 'DOWNLOAD_UNSUPPORTED_HOST':
      return ctx.t('downloader.unsupportedHost', { platform: platformLabel });
    case 'DOWNLOAD_TOO_LARGE':
      return ctx.t('downloader.tooLarge', {
        max: meta.max ?? ctx.config.download?.maxMb ?? 16,
      });
    case 'DOWNLOAD_TOO_LONG':
      return ctx.t('downloader.tooLong', {
        duration: meta.duration ?? ctx.t('downloader.durationUnknown'),
        max: meta.max ?? ctx.t('downloader.durationUnknown'),
      });
    case 'DOWNLOAD_BUSY':
      return ctx.t('downloader.busy');
    case 'DOWNLOAD_FFMPEG_MISSING':
      return ctx.t('downloader.ffmpegMissing', { prefix: ctx.prefix });
    case 'DOWNLOAD_NOT_READY':
      return ctx.t('downloader.unavailable', { prefix: ctx.prefix });
    case 'DOWNLOAD_BOT_CHECK':
      return ctx.t('downloader.botCheck');
    case 'DOWNLOAD_AGE_RESTRICTED':
      return ctx.t('downloader.ageRestricted');
    case 'DOWNLOAD_UNAVAILABLE':
      return ctx.t('downloader.unavailableMedia');
    case 'DOWNLOAD_FORMAT':
      return ctx.t('downloader.formatUnavailable');
    case 'DOWNLOAD_TIMEOUT':
      return ctx.t('downloader.timeout');
    case 'DOWNLOAD_UNSUPPORTED_MEDIA':
      return ctx.t('downloader.unsupportedMedia');
    default:
      return ctx.t('downloader.failed');
  }
}

/**
 * Jalankan command downloader.
 *
 * @param {object} ctx
 * @param {{platform: 'youtube'|'tiktok', kind: 'audio'|'video', platformLabel: string}} options
 * @returns {Promise<string|null>}
 */
async function executeDownload(ctx, { platform, kind, platformLabel }) {
  const downloader = ctx.services?.downloader;

  if (!downloader) {
    return ctx.t('downloader.unavailable', { prefix: ctx.prefix });
  }

  const rawUrl = (ctx.args || []).find((arg) => URL_PATTERN.test(arg)) || '';

  if (!rawUrl) {
    return ctx.t('downloader.invalidUrl', { prefix: ctx.prefix, command: ctx.command.name });
  }

  const status = await downloader.available();
  if (!status.available) {
    return ctx.t('downloader.unavailable', { prefix: ctx.prefix });
  }

  await ctx.react('⏳');

  let result;
  try {
    result = await downloader.fetch({ rawUrl, kind, platform });
  } catch (error) {
    ctx.logger?.warn?.(
      {
        code: error?.code || 'DOWNLOAD_FAILED',
        platform,
        kind,
        // Jangan log URL penuh: itu isi pesan pengguna.
        host: error?.meta?.host || undefined,
      },
      'Download media gagal',
    );
    await ctx.react('❌');
    return describeError(ctx, error, platformLabel);
  }

  const caption = kind === 'audio'
    ? ctx.t('downloader.audioCaption', {
      title: truncate(result.title, 90),
      duration: formatClock(result.durationSec),
      size: formatBytes(result.sizeBytes),
    })
    : platform === 'tiktok'
      ? ctx.t('downloader.tiktokCaption', {
        title: truncate(result.title, 90),
        author: truncate(result.author || ctx.t('downloader.authorUnknown'), 40),
      })
      : ctx.t('downloader.videoCaption', {
        title: truncate(result.title, 90),
        duration: formatClock(result.durationSec),
        size: formatBytes(result.sizeBytes),
      });

  await ctx.react('✅');

  if (kind === 'audio') {
    await ctx.send({
      audio: result.buffer,
      mimetype: result.mimetype,
      fileName: result.fileName,
      ptt: false,
    }, { quoted: false });
    await ctx.reply(caption);
    return null;
  }

  await ctx.send({
    video: result.buffer,
    mimetype: result.mimetype,
    fileName: result.fileName,
    caption,
  }, { quoted: false });

  return null;
}

module.exports = {
  URL_PATTERN,
  describeError,
  executeDownload,
};
