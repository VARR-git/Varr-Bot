const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const sharp = require('sharp');

const tomp3 = require('../src/commands/media/tomp3');
const topdf = require('../src/commands/media/topdf');
const qr = require('../src/commands/media/qr');
const readqr = require('../src/commands/media/readqr');
const { createMediaService } = require('../src/services/media');

function makeCtx(media, overrides = {}) {
  const sent = [];
  return {
    services: { media },
    msg: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'msg-1' }, message: {} },
    prefix: '.',
    args: [],
    sock: {},
    chatId: 'chat@s.whatsapp.net',
    logger: { warn() {} },
    t(key, vars) {
      return vars ? `${key}:${JSON.stringify(vars)}` : key;
    },
    async send(payload, options) {
      sent.push({ payload, options });
    },
    sent,
    ...overrides,
  };
}

function baseMedia(overrides = {}) {
  return {
    available: true,
    pdfAvailable: true,
    qrAvailable: true,
    readQrAvailable: true,
    mp3Available: true,
    maxBytes: 10 * 1024 * 1024,
    maxAudioSeconds: 600,
    findMedia() {
      return null;
    },
    async download() {
      return Buffer.from('media');
    },
    async toMp3() {
      return Buffer.from('mp3');
    },
    async toPdf() {
      return Buffer.from('%PDF-1.7');
    },
    async toQr() {
      return Buffer.from('png');
    },
    async readQr() {
      return 'qr';
    },
    ...overrides,
  };
}

test('command media baru punya metadata yang konsisten', () => {
  for (const command of [tomp3, topdf, qr, readqr]) {
    assert.equal(command.category, 'media');
    assert.equal(typeof command.name, 'string');
    assert.equal(typeof command.execute, 'function');
    assert.match(command.descriptionKey, /^commands\./);
  }
  assert.equal(tomp3.name, 'tomp3');
  assert.equal(topdf.name, 'topdf');
  assert.equal(qr.name, 'qr');
  assert.equal(readqr.name, 'readqr');
  // Konversi FFmpeg tidak boleh memakai timeout command global yang pendek.
  assert.ok(tomp3.timeoutMs >= 180_000);
});

test('tomp3 mengonversi video menjadi audio MP3', async () => {
  const ctx = makeCtx(baseMedia({
    findMedia(msg, keys) {
      assert.deepEqual(keys, ['audioMessage', 'videoMessage']);
      return { kind: 'video', size: 100, message: {} };
    },
    async download() {
      return Buffer.from('video-bytes');
    },
    async toMp3(buffer) {
      assert.equal(buffer.toString(), 'video-bytes');
      return Buffer.from('mp3-bytes');
    },
  }));

  const result = await tomp3.execute(ctx);

  assert.equal(result, null);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].payload.audio.toString(), 'mp3-bytes');
  assert.equal(ctx.sent[0].payload.mimetype, 'audio/mpeg');
  assert.equal(ctx.sent[0].payload.fileName, 'audio.mp3');
});

test('tomp3 menolak media tanpa audio/video dan file kebesaran', async () => {
  const empty = makeCtx(baseMedia());
  assert.match(await tomp3.execute(empty), /^media\.tomp3Usage/);

  const big = makeCtx(baseMedia({
    findMedia() {
      return { kind: 'audio', size: 11 * 1024 * 1024, message: {} };
    },
  }));
  assert.match(await tomp3.execute(big), /^media\.tooLarge/);
});

test('tomp3 menangani batas durasi dan FFmpeg yang hilang', async () => {
  const longMedia = baseMedia({
    findMedia() {
      return { kind: 'audio', size: 100, message: {} };
    },
    async toMp3() {
      throw Object.assign(new Error('too long'), { code: 'DURATION_TOO_LONG' });
    },
  });
  const longCtx = makeCtx(longMedia);
  assert.match(await tomp3.execute(longCtx), /^media\.durationTooLong/);

  const noFfmpeg = baseMedia({
    findMedia() {
      return { kind: 'audio', size: 100, message: {} };
    },
    async toMp3() {
      throw Object.assign(new Error('missing'), { code: 'FFMPEG_MISSING' });
    },
  });
  const missingCtx = makeCtx(noFfmpeg);
  assert.equal(await tomp3.execute(missingCtx), 'media.ffmpegMissing');
});

test('topdf membuat PDF dari teks argumen', async () => {
  const ctx = makeCtx(baseMedia({
    async toPdf(input) {
      assert.deepEqual(input, { text: 'Halo dunia PDF' });
      return Buffer.from('%PDF-1.7');
    },
  }), { args: ['Halo', 'dunia', 'PDF'] });

  const result = await topdf.execute(ctx);

  assert.equal(result, null);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].payload.document.toString(), '%PDF-1.7');
  assert.equal(ctx.sent[0].payload.mimetype, 'application/pdf');
});

test('topdf membuat PDF dari gambar yang di-reply/dikirim', async () => {
  const ctx = makeCtx(baseMedia({
    findMedia() {
      return { kind: 'image', size: 50, message: {} };
    },
    async download() {
      return Buffer.from('image-bytes');
    },
    async toPdf(input) {
      assert.equal(input.image.toString(), 'image-bytes');
      assert.equal(input.text, undefined);
      return Buffer.from('%PDF-image');
    },
  }));

  const result = await topdf.execute(ctx);

  assert.equal(result, null);
  assert.equal(ctx.sent[0].payload.document.toString(), '%PDF-image');
});

test('topdf meminta teks bila tidak ada gambar maupun argumen', async () => {
  const ctx = makeCtx(baseMedia(), { args: [] });
  assert.match(await topdf.execute(ctx), /^media\.topdfUsage/);
  assert.equal(ctx.sent.length, 0);
});

test('qr membuat gambar QR dari teks/url', async () => {
  const ctx = makeCtx(baseMedia({
    async toQr(text) {
      assert.equal(text, 'https://example.com');
      return Buffer.from('png-bytes');
    },
  }), { args: ['https://example.com'] });

  const result = await qr.execute(ctx);

  assert.equal(result, null);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].payload.image.toString(), 'png-bytes');
  assert.equal(ctx.sent[0].payload.caption, 'media.qrCaption');
});

test('qr menolak teks kosong', async () => {
  const ctx = makeCtx(baseMedia(), { args: [] });
  assert.match(await qr.execute(ctx), /^media\.qrUsage/);
  assert.equal(ctx.sent.length, 0);
});

test('readqr membaca isi QR dari gambar', async () => {
  const ctx = makeCtx(baseMedia({
    findMedia() {
      return { kind: 'image', size: 50, message: {} };
    },
    async download() {
      return Buffer.from('qr-image');
    },
    async readQr(buffer) {
      assert.equal(buffer.toString(), 'qr-image');
      return 'https://example.com/qr';
    },
  }));

  const result = await readqr.execute(ctx);

  assert.equal(result, null);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].payload.text, 'media.readqrResult:{"result":"https://example.com/qr"}');
});

test('readqr menangani QR yang tidak terbaca dan media kosong', async () => {
  const notFound = makeCtx(baseMedia({
    findMedia() {
      return { kind: 'image', size: 50, message: {} };
    },
    async readQr() {
      throw Object.assign(new Error('not found'), { code: 'QR_NOT_FOUND' });
    },
  }));
  assert.equal(await readqr.execute(notFound), 'media.readqrNotFound');

  const noMedia = makeCtx(baseMedia());
  assert.match(await readqr.execute(noMedia), /^media\.readqrUsage/);
});

test('layanan media membuat dan membaca QR Code secara nyata', async () => {
  const media = createMediaService({
    config: { mediaMaxMb: 2 },
    logger: { warn() {} },
    sharpLib: sharp,
  });

  const image = await media.toQr('Halo Varr-Bot');
  assert.equal(image.subarray(1, 4).toString(), 'PNG');

  const decoded = await media.readQr(image);
  assert.equal(decoded, 'Halo Varr-Bot');
});

test('layanan media membuat PDF dari teks dan gambar', async () => {
  const media = createMediaService({
    config: { mediaMaxMb: 2 },
    logger: { warn() {} },
    sharpLib: sharp,
  });

  const textPdf = await media.toPdf({ text: 'Dokumen uji Varr-Bot' });
  assert.equal(textPdf.subarray(0, 5).toString(), '%PDF-');

  const image = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: '#3366ff',
    },
  }).png().toBuffer();
  const imagePdf = await media.toPdf({ image });
  assert.equal(imagePdf.subarray(0, 5).toString(), '%PDF-');
});

test('layanan media mengonversi ke MP3 dan menegakkan batas durasi', async () => {
  const tmpFiles = [];
  const fakeExec = async (command, args) => {
    if (command === 'ffprobe') return { stdout: '12.5\n', stderr: '' };
    const output = args[args.length - 1];
    tmpFiles.push(output);
    await fs.writeFile(output, Buffer.from('ID3-fake-mp3'));
    return { stdout: '', stderr: '' };
  };

  const media = createMediaService({
    config: { mediaMaxMb: 2, mediaMaxDurationSeconds: 60 },
    logger: { warn() {} },
    sharpLib: sharp,
    execFileFn: fakeExec,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
  });

  const mp3 = await media.toMp3(Buffer.from('input-audio'));
  assert.equal(mp3.toString(), 'ID3-fake-mp3');
  assert.equal(tmpFiles.length, 1);
  await assert.rejects(fs.access(path.dirname(tmpFiles[0])), { code: 'ENOENT' });

  const longExec = async (command) => {
    if (command === 'ffprobe') return { stdout: '120\n', stderr: '' };
    throw new Error('should not transcode');
  };
  const limited = createMediaService({
    config: { mediaMaxMb: 2, mediaMaxDurationSeconds: 60 },
    logger: { warn() {} },
    sharpLib: sharp,
    execFileFn: longExec,
  });
  await assert.rejects(limited.toMp3(Buffer.from('long-audio')), {
    code: 'DURATION_TOO_LONG',
  });
});

test('locale en memiliki semua key yang dipakai locale id', async () => {
  const id = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'src', 'locales', 'id.json'), 'utf8'));
  const en = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'src', 'locales', 'en.json'), 'utf8'));

  const keys = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => (
    child && typeof child === 'object'
      ? keys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  ));

  const enKeys = new Set(keys(en));
  const missing = keys(id).filter((key) => !enKeys.has(key));
  assert.deepEqual(missing, []);
});

test('folder temporary dibersihkan setelah konversi MP3 gagal', async () => {
  let inputDir;
  const media = createMediaService({
    config: { mediaMaxMb: 2 },
    logger: { warn() {} },
    sharpLib: sharp,
    execFileFn: async (command, args) => {
      if (command === 'ffprobe') return { stdout: '5\n', stderr: '' };
      inputDir = path.dirname(args[args.indexOf('-i') + 1]);
      throw new Error('transcode error');
    },
  });

  await assert.rejects(media.toMp3(Buffer.from('audio')));
  assert.ok(inputDir && inputDir.startsWith(os.tmpdir()));
  await assert.rejects(fs.access(inputDir), { code: 'ENOENT' });
});
