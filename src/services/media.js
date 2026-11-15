/**
 * Layanan media dasar: menemukan media pada pesan/quoted message, mengunduh,
 * dan mengonversi gambar menjadi sticker WebP atau sticker menjadi gambar.
 *
 * Konversi memakai `sharp` (sudah tersedia sebagai dependency). Video sticker
 * belum didukung karena membutuhkan FFmpeg.
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getContextInfo } = require('../utils/group');
const { unwrapMessage } = require('../utils/text');

const STICKER_DIMENSION = 512;
const DEFAULT_MAX_MB = 16;
const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'stickerMessage'];

/**
 * @param {object} content
 * @returns {'image'|'video'|'sticker'|null}
 */
function mediaKind(content) {
  if (!content) return null;
  for (const key of MEDIA_KEYS) {
    if (content[key]) return key.replace('Message', '');
  }
  return null;
}

/**
 * @param {object} media
 * @returns {number}
 */
function mediaSize(media) {
  const value = media?.fileLength;
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toNumber === 'function') return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.logger
 * @param {object} [options.sharpLib]
 * @param {Function} [options.downloader]
 */
function createMediaService({
  config,
  logger,
  sharpLib,
  downloader = downloadMediaMessage,
}) {
  let sharp = sharpLib;

  if (sharp === undefined) {
    try {
      // eslint-disable-next-line global-require
      sharp = require('sharp');
    } catch (error) {
      logger?.warn?.({ err: error }, 'sharp tidak tersedia; fitur sticker dinonaktifkan');
      sharp = null;
    }
  }

  const maxBytes = Math.max(1, Number(config?.mediaMaxMb) || DEFAULT_MAX_MB) * 1024 * 1024;

  /**
   * @param {object} msg
   * @returns {{kind: string, media: object, message: object, size: number, quoted: boolean}|null}
   */
  function findMedia(msg) {
    const content = unwrapMessage(msg?.message);
    if (!content) return null;

    const directKind = mediaKind(content);
    if (directKind) {
      const media = content[`${directKind}Message`];
      return {
        kind: directKind,
        media,
        message: msg,
        size: mediaSize(media),
        quoted: false,
      };
    }

    const context = getContextInfo(content);
    const quoted = context?.quotedMessage ? unwrapMessage(context.quotedMessage) : null;
    const quotedKind = mediaKind(quoted);
    if (!quotedKind) return null;

    const media = quoted[`${quotedKind}Message`];
    return {
      kind: quotedKind,
      media,
      message: {
        key: {
          remoteJid: msg?.key?.remoteJid,
          id: context?.stanzaId || `quoted-${Date.now()}`,
          fromMe: false,
          participant: context?.participant,
        },
        message: context.quotedMessage,
      },
      size: mediaSize(media),
      quoted: true,
    };
  }

  /**
   * @param {object} sock
   * @param {object} found
   * @returns {Promise<Buffer>}
   */
  async function download(sock, found) {
    const context = typeof sock?.updateMediaMessage === 'function'
      ? { logger, reuploadRequest: sock.updateMediaMessage }
      : undefined;
    return downloader(found.message, 'buffer', {}, context);
  }

  /**
   * @param {Buffer} buffer
   * @returns {Promise<Buffer>}
   */
  async function toSticker(buffer) {
    if (!sharp) throw new Error('sharp tidak tersedia');
    return sharp(buffer, { animated: false })
      .rotate()
      .resize(STICKER_DIMENSION, STICKER_DIMENSION, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: 80 })
      .toBuffer();
  }

  /**
   * @param {Buffer} buffer
   * @param {'png'|'jpeg'} [format]
   * @returns {Promise<Buffer>}
   */
  async function toImage(buffer, format = 'png') {
    if (!sharp) throw new Error('sharp tidak tersedia');
    const pipeline = sharp(buffer, { animated: false }).rotate();
    return format === 'jpeg'
      ? pipeline.jpeg({ quality: 90 }).toBuffer()
      : pipeline.png().toBuffer();
  }

  return {
    available: Boolean(sharp),
    maxBytes,
    findMedia,
    download,
    toSticker,
    toImage,
  };
}

module.exports = {
  STICKER_DIMENSION,
  DEFAULT_MAX_MB,
  mediaKind,
  mediaSize,
  createMediaService,
};
