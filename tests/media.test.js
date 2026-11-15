const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GROUP,
  MEMBER,
  createFakeSharp,
  createTestBot,
  lastText,
  makeMessage,
} = require('./helpers/bot');
const {
  DEFAULT_MAX_MB,
  MEDIA_HOST,
  STICKER_DIMENSION,
  createMediaService,
  mediaKind,
  mediaSize,
} = require('../src/services/media');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const imageContent = (size = 1_000) => ({
  imageMessage: { fileLength: size, mimetype: 'image/jpeg', caption: '.sticker' },
});

const stickerContent = (size = 1_000) => ({
  stickerMessage: { fileLength: size, mimetype: 'image/webp' },
});

test('media: jenis dan ukuran media terbaca', () => {
  assert.equal(mediaKind({ imageMessage: {} }), 'image');
  assert.equal(mediaKind({ videoMessage: {} }), 'video');
  assert.equal(mediaKind({ stickerMessage: {} }), 'sticker');
  assert.equal(mediaKind({ conversation: 'teks' }), null);
  assert.equal(mediaKind(null), null);

  assert.equal(mediaSize({ fileLength: 123 }), 123);
  assert.equal(mediaSize({ fileLength: { toNumber: () => 456 } }), 456);
  assert.equal(mediaSize({ fileLength: '789' }), 789);
  assert.equal(mediaSize({}), 0);
});

test('media: findMedia menemukan media langsung dan quoted', () => {
  const service = createMediaService({
    config: { mediaMaxMb: DEFAULT_MAX_MB },
    logger: silentLogger,
    sharpLib: createFakeSharp(),
    downloader: async () => Buffer.from('x'),
  });

  const direct = service.findMedia({
    key: { remoteJid: GROUP },
    message: imageContent(2_000),
  });
  assert.equal(direct.kind, 'image');
  assert.equal(direct.size, 2_000);
  assert.equal(direct.quoted, false);

  const quoted = service.findMedia({
    key: { remoteJid: GROUP },
    message: {
      extendedTextMessage: {
        text: '.toimg',
        contextInfo: {
          participant: MEMBER,
          stanzaId: 'quoted-1',
          quotedMessage: stickerContent(3_000),
        },
      },
    },
  });
  assert.equal(quoted.kind, 'sticker');
  assert.equal(quoted.size, 3_000);
  assert.equal(quoted.quoted, true);
  assert.equal(quoted.message.key.remoteJid, GROUP);

  assert.equal(service.findMedia({ key: {}, message: { conversation: 'halo' } }), null);
});

test('media: konversi sticker memakai ukuran 512 dan format webp', async () => {
  const sharp = createFakeSharp();
  const service = createMediaService({
    config: { mediaMaxMb: 16 },
    logger: silentLogger,
    sharpLib: sharp,
    downloader: async () => Buffer.from('x'),
  });

  const output = await service.toSticker(Buffer.from('input'));
  assert.equal(output.toString(), 'converted-media');
  assert.equal(sharp.calls.length, 1);
  assert.equal(sharp.calls[0].options.animated, false);
  assert.equal(STICKER_DIMENSION, 512);
});

test('media: download memakai host media default, bukan host usang dari url', async () => {
  const calls = [];

  const service = createMediaService({
    config: { mediaMaxMb: 16 },
    logger: silentLogger,
    sharpLib: createFakeSharp(),
    downloader: async (message, type, options, context) => {
      calls.push({ message, type, options, context });
      return Buffer.from('media-bytes');
    },
  });

  // Sticker dari WhatsApp Web/Desktop: url memakai host usang a.whatsapp.net,
  // tetapi directPath valid (bug Baileys rc13, PR #2778).
  const found = service.findMedia({
    key: { remoteJid: GROUP },
    message: {
      extendedTextMessage: {
        text: '.toimg',
        contextInfo: {
          participant: MEMBER,
          stanzaId: 'sticker-usang',
          quotedMessage: {
            stickerMessage: {
              url: 'https://a.whatsapp.net/v/t62.15575-24/abc',
              directPath: '/v/t62.15575-24/abc',
              mediaKey: 'a2V5',
              fileLength: 1_000,
            },
          },
        },
      },
    },
  });

  assert.ok(found);
  assert.equal(found.kind, 'sticker');

  const buffer = await service.download({ user: { id: '628999999999@s.whatsapp.net' } }, found);

  assert.equal(buffer.toString(), 'media-bytes');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'buffer');
  assert.equal(calls[0].options.host, MEDIA_HOST);
  assert.equal(MEDIA_HOST, 'mmg.whatsapp.net');
  assert.equal(calls[0].context, undefined);
});

test('media: download meneruskan reuploadRequest saat socket mendukung', async () => {
  const calls = [];
  const updateMediaMessage = async () => {};

  const service = createMediaService({
    config: { mediaMaxMb: 16 },
    logger: silentLogger,
    sharpLib: createFakeSharp(),
    downloader: async (message, type, options, context) => {
      calls.push({ options, context });
      return Buffer.from('ok');
    },
  });

  const found = service.findMedia({
    key: { remoteJid: GROUP },
    message: { stickerMessage: { fileLength: 10 } },
  });

  await service.download({ updateMediaMessage }, found);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.reuploadRequest, updateMediaMessage);
});

test('media: command sticker mengirim sticker dari gambar', async (t) => {
  const bot = createTestBot({
    mediaDownloader: async () => Buffer.from('image-bytes'),
  });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, content: imageContent() }),
  );

  const payload = bot.sent.at(-1).payload;
  assert.ok(Buffer.isBuffer(payload.sticker));
  assert.equal(payload.sticker.toString(), 'converted-media');
});

test('media: sticker menolak media kebesaran dan video', async (t) => {
  const bot = createTestBot({
    mediaDownloader: async () => Buffer.from('image-bytes'),
  });
  t.after(() => bot.close());

  const tooLarge = 17 * 1024 * 1024;
  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, content: imageContent(tooLarge) }),
  );
  assert.match(lastText(bot), /melebihi batas 16 MB/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({
      chatId: GROUP,
      sender: MEMBER,
      content: { videoMessage: { fileLength: 1_000, caption: '.sticker' } },
    }),
  );
  assert.match(lastText(bot), /Video belum didukung/);

  assert.equal(bot.sent.filter((entry) => entry.payload?.sticker).length, 0);
});

test('media: command sticker meminta media saat tidak ada lampiran', async (t) => {
  const bot = createTestBot({
    mediaDownloader: async () => Buffer.from('image-bytes'),
  });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.sticker' }),
  );

  assert.match(lastText(bot), /reply gambar/);
});

test('media: toimg mengubah sticker yang di-reply menjadi gambar', async (t) => {
  const bot = createTestBot({
    mediaDownloader: async () => Buffer.from('sticker-bytes'),
  });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({
      chatId: GROUP,
      sender: MEMBER,
      text: '.toimg',
      quoted: { sender: MEMBER, content: stickerContent() },
    }),
  );

  const payload = bot.sent.at(-1).payload;
  assert.ok(Buffer.isBuffer(payload.image));
  assert.match(payload.caption, /Hasil konversi/);
});

test('media: toimg hanya menerima sticker', async (t) => {
  const bot = createTestBot({
    mediaDownloader: async () => Buffer.from('image-bytes'),
  });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({
      chatId: GROUP,
      sender: MEMBER,
      text: '.toimg',
      quoted: { sender: MEMBER, content: imageContent() },
    }),
  );

  assert.match(lastText(bot), /hanya untuk sticker/);
});

test('media: tanpa sharp command media memberi pesan jelas', async (t) => {
  const bot = createTestBot({ sharp: null });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, content: imageContent() }),
  );

  assert.match(lastText(bot), /sharp/);
  assert.equal(bot.media.available, false);
});

test('media: kegagalan unduh dan konversi tidak melempar error', async (t) => {
  const failingDownload = createTestBot({
    mediaDownloader: async () => {
      throw new Error('jaringan mati');
    },
  });
  t.after(() => failingDownload.close());

  await failingDownload.handler.handleMessage(
    failingDownload.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, content: imageContent() }),
  );
  assert.match(lastText(failingDownload), /Gagal mengunduh/);

  const failingConvert = createTestBot({
    sharp: () => {
      throw new Error('sharp rusak');
    },
    mediaDownloader: async () => Buffer.from('image-bytes'),
  });
  t.after(() => failingConvert.close());

  await failingConvert.handler.handleMessage(
    failingConvert.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, content: imageContent() }),
  );
  assert.match(lastText(failingConvert), /Gagal mengonversi/);
});
