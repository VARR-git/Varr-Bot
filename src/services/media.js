/**
 * Layanan media dasar: menemukan media pada pesan/quoted message, mengunduh,
 * dan mengonversi media (sticker, gambar, audio MP3, PDF, dan QR Code).
 *
 * Gambar diproses dengan `sharp` yang sudah tersedia. Konversi audio memakai
 * FFmpeg, sedangkan PDF dan QR memakai dependency opsional `pdf-lib`, `qrcode`,
 * dan `jsqr` agar bot tetap bisa berjalan ketika salah satunya belum terpasang.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { DEF_MEDIA_HOST, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getContextInfo } = require('../utils/group');
const { unwrapMessage } = require('../utils/text');

const execFileAsync = promisify(execFile);

const STICKER_DIMENSION = 512;
const DEFAULT_MAX_MB = 16;
const DEFAULT_MAX_AUDIO_SECONDS = 10 * 60;
const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'stickerMessage'];
const AUDIO_MEDIA_KEYS = ['audioMessage', 'videoMessage'];

/**
 * Host media resmi WhatsApp.
 *
 * Baileys rc13 menyusun ulang URL download dari `directPath` tetapi memakai
 * host dari field `url`. Sebagian pesan (sticker dari WhatsApp Web/Desktop)
 * membawa `url` dengan host usang `a.whatsapp.net`, sehingga download gagal
 * dengan `getaddrinfo ENOTFOUND a.whatsapp.net`. Dengan mengirim `host`
 * eksplisit, Baileys memakai host media default dan mengabaikan host usang.
 *
 * Ref: https://github.com/WhiskeySockets/Baileys/pull/2778
 */
const MEDIA_HOST = DEF_MEDIA_HOST || 'mmg.whatsapp.net';

/**
 * @param {object} content
 * @param {string[]} [keys]
 * @returns {'image'|'video'|'sticker'|'audio'|null}
 */
function mediaKind(content, keys = MEDIA_KEYS) {
  if (!content) return null;
  for (const key of keys) {
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
  pdfLib,
  qrLib,
  jsqrLib,
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath = process.env.FFPROBE_PATH || 'ffprobe',
  execFileFn = execFileAsync,
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

  function optionalRequire(name, label) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require(name);
    } catch (error) {
      logger?.warn?.({ err: error }, `${label} tidak tersedia; fitur terkait dinonaktifkan`);
      return null;
    }
  }

  const pdf = pdfLib === undefined ? optionalRequire('pdf-lib', 'pdf-lib') : pdfLib;
  const qr = qrLib === undefined ? optionalRequire('qrcode', 'qrcode') : qrLib;
  let jsqr = jsqrLib === undefined ? optionalRequire('jsqr', 'jsqr') : jsqrLib;
  if (jsqr && typeof jsqr !== 'function' && typeof jsqr.default === 'function') {
    jsqr = jsqr.default;
  }

  const maxBytes = Math.max(1, Number(config?.mediaMaxMb) || DEFAULT_MAX_MB) * 1024 * 1024;
  const maxAudioSeconds = Math.max(
    1,
    Number(config?.mediaMaxDurationSeconds) || DEFAULT_MAX_AUDIO_SECONDS,
  );

  /**
   * @param {object} msg
   * @param {string[]} [keys]
   * @returns {{kind: string, media: object, message: object, size: number, quoted: boolean}|null}
   */
  function findMedia(msg, keys = MEDIA_KEYS) {
    const content = unwrapMessage(msg?.message);
    if (!content) return null;

    const directKind = mediaKind(content, keys);
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
    const quotedKind = mediaKind(quoted, keys);
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

    // `host` wajib: lihat komentar MEDIA_HOST (bug host usang Baileys).
    return downloader(found.message, 'buffer', { host: MEDIA_HOST }, context);
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

  function withCode(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  async function probeDuration(file) {
    try {
      const { stdout } = await execFileFn(
        ffprobePath,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          file,
        ],
        { timeout: 15000, windowsHide: true },
      );
      const seconds = Number(String(stdout).trim());
      return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    } catch {
      // ffprobe bisa tidak terpasang; konversi tetap dicoba tanpa cek durasi.
      return null;
    }
  }

  /**
   * @param {Buffer} buffer
   * @param {{maxDurationSeconds?: number, timeoutMs?: number}} [options]
   * @returns {Promise<Buffer>}
   */
  async function toMp3(buffer, options = {}) {
    const limit = Math.max(
      1,
      Number(options.maxDurationSeconds) || maxAudioSeconds,
    );
    const processTimeoutMs = Math.max(15_000, Number(options.timeoutMs) || 240_000);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'varr-mp3-'));
    const input = path.join(dir, 'input.media');
    const output = path.join(dir, 'output.mp3');

    try {
      await fs.writeFile(input, buffer);

      const duration = await probeDuration(input);
      if (duration && duration > limit) {
        throw withCode(`Durasi audio melebihi batas ${limit} detik`, 'DURATION_TOO_LONG');
      }

      try {
        await execFileFn(
          ffmpegPath,
          [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            input,
            '-vn',
            '-acodec',
            'libmp3lame',
            '-b:a',
            '128k',
            '-ar',
            '44100',
            output,
          ],
          { timeout: processTimeoutMs, windowsHide: true },
        );
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw withCode('FFmpeg tidak ditemukan', 'FFMPEG_MISSING');
        }
        throw error;
      }

      return await fs.readFile(output);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function sanitizePdfText(value) {
    return String(value)
      .replace(/\r\n?/g, '\n')
      .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
  }

  /**
   * Membuat PDF dari teks atau satu gambar.
   * @param {{text?: string, image?: Buffer}} input
   * @returns {Promise<Buffer>}
   */
  async function toPdf({ text, image } = {}) {
    if (!pdf) throw withCode('pdf-lib tidak tersedia', 'PDF_UNAVAILABLE');
    const { PDFDocument, StandardFonts, rgb } = pdf;
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    if (image) {
      let embedded;
      if (sharp) {
        const jpeg = await sharp(image, { animated: false })
          .rotate()
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 90 })
          .toBuffer();
        embedded = await doc.embedJpg(jpeg);
      } else if (image[0] === 0x89 && image[1] === 0x50) {
        embedded = await doc.embedPng(image);
      } else {
        embedded = await doc.embedJpg(image);
      }

      const margin = 36;
      const scaled = embedded.scaleToFit(width - margin * 2, height - margin * 2);
      page.drawImage(embedded, {
        x: (width - scaled.width) / 2,
        y: (height - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height,
      });
      return Buffer.from(await doc.save());
    }

    const content = sanitizePdfText(text || '');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize = 12;
    const lineHeight = 18;
    const margin = 48;
    const maxWidth = width - margin * 2;
    const maxLines = Math.floor((height - margin * 2) / lineHeight) || 1;

    const lines = [];
    for (const rawLine of content.split('\n')) {
      if (rawLine.length === 0) {
        lines.push('');
        continue;
      }
      let current = '';
      for (const word of rawLine.split(/(\s+)/)) {
        const candidate = current + word;
        if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current.trimEnd());
          current = word.trimStart();
        }
      }
      if (current) lines.push(current.trimEnd());
    }

    let y = height - margin;
    for (const line of lines) {
      if (y < margin) break;
      if (line) {
        page.drawText(line, {
          x: margin,
          y,
          size: fontSize,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
      }
      y -= lineHeight;
    }

    return Buffer.from(await doc.save());
  }

  /**
   * @param {string} text
   * @param {{width?: number}} [options]
   * @returns {Promise<Buffer>}
   */
  async function toQr(text, options = {}) {
    if (!qr) throw withCode('qrcode tidak tersedia', 'QR_UNAVAILABLE');
    const value = String(text || '').trim();
    if (!value) throw withCode('Teks QR kosong', 'QR_EMPTY');
    return qr.toBuffer(value, {
      type: 'png',
      width: Math.min(1024, Math.max(128, Number(options.width) || 512)),
      margin: 2,
      errorCorrectionLevel: 'M',
    });
  }

  /**
   * @param {Buffer} buffer
   * @returns {Promise<string>}
   */
  async function readQr(buffer) {
    if (!jsqr) throw withCode('jsqr tidak tersedia', 'QR_UNAVAILABLE');
    if (!sharp) throw withCode('sharp tidak tersedia', 'QR_UNAVAILABLE');

    const { data, info } = await sharp(buffer, { animated: false })
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const result = jsqr(new Uint8ClampedArray(data), info.width, info.height);
    if (!result || !result.data) {
      throw withCode('QR Code tidak terbaca', 'QR_NOT_FOUND');
    }
    return result.data;
  }

  return {
    available: Boolean(sharp),
    pdfAvailable: Boolean(pdf),
    qrAvailable: Boolean(qr),
    readQrAvailable: Boolean(jsqr && sharp),
    mp3Available: Boolean(ffmpegPath),
    maxBytes,
    maxAudioSeconds,
    findMedia,
    download,
    toSticker,
    toImage,
    toMp3,
    toPdf,
    toQr,
    readQr,
  };
}

module.exports = {
  STICKER_DIMENSION,
  DEFAULT_MAX_MB,
  DEFAULT_MAX_AUDIO_SECONDS,
  MEDIA_HOST,
  MEDIA_KEYS,
  AUDIO_MEDIA_KEYS,
  mediaKind,
  mediaSize,
  createMediaService,
};
