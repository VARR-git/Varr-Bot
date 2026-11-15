const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  GROUP,
  MEMBER,
  createTestBot,
  lastText,
  makeMessage,
} = require('./helpers/bot');
const { AppError } = require('../src/core/errors');
const {
  createDownloaderService,
  createLimiter,
  formatClock,
  isPrivateHost,
  safeFileName,
  validateMediaUrl,
} = require('../src/services/downloader');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'varr-dl-'));
}

function makeConfig(dir, overrides = {}) {
  return {
    dataDir: dir,
    tmpDir: path.join(dir, 'tmp'),
    download: {
      binary: 'yt-dlp',
      maxMb: 1,
      maxDurationSec: 900,
      timeoutMs: 5_000,
      concurrency: 2,
      queueMax: 5,
      ...overrides,
    },
  };
}

function createFakeRunner({ duration = 30, writeBytes = 1_000, version = '2026.01.01' } = {}) {
  const calls = [];

  async function run(file, args) {
    calls.push({ file, args });

    if (args.includes('--version')) {
      return { code: 0, stdout: `${version}\n`, stderr: '', error: null };
    }

    if (args.includes('-J')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          title: 'Video Uji',
          duration,
          uploader: 'Kreator Uji',
          webpage_url: 'https://youtu.be/uji',
        }),
        stderr: '',
        error: null,
      };
    }

    const template = args[args.indexOf('-o') + 1];
    const ext = args.includes('-x') ? 'mp3' : 'mp4';
    fs.writeFileSync(template.replace('%(ext)s', ext), Buffer.alloc(writeBytes, 1));

    return { code: 0, stdout: '', stderr: '', error: null };
  }

  return { run, calls };
}

test('downloader: validasi URL menolak host internal dan skema tidak aman', () => {
  assert.deepEqual(
    validateMediaUrl('https://www.youtube.com/watch?v=abc', 'youtube').host,
    'www.youtube.com',
  );
  assert.equal(validateMediaUrl('https://youtu.be/abc', 'youtube').platform, 'youtube');
  assert.equal(validateMediaUrl('https://vt.tiktok.com/abc/', 'tiktok').host, 'vt.tiktok.com');
  assert.equal(validateMediaUrl('http://music.youtube.com/watch?v=abc', 'youtube').host, 'music.youtube.com');

  assert.throws(() => validateMediaUrl('ftp://youtu.be/abc'), /Protokol/);
  assert.throws(() => validateMediaUrl('https://user:pass@youtu.be/abc'), /kredensial/);
  assert.throws(() => validateMediaUrl('https://youtu.be:8080/abc'), /Port/);
  assert.throws(
    () => validateMediaUrl('https://localhost/youtu.be'),
    (error) => error.code === 'DOWNLOAD_INVALID_URL',
  );
  assert.throws(
    () => validateMediaUrl('https://127.0.0.1/youtu.be'),
    (error) => error.code === 'DOWNLOAD_INVALID_URL',
  );
  assert.throws(
    () => validateMediaUrl('https://evil.com/youtu.be', 'youtube'),
    (error) => error.code === 'DOWNLOAD_UNSUPPORTED_HOST',
  );
  assert.throws(
    () => validateMediaUrl('https://www.tiktok.com/@a/video/1', 'youtube'),
    (error) => error.code === 'DOWNLOAD_UNSUPPORTED_HOST',
  );
  assert.throws(() => validateMediaUrl('bukan-url'), /tidak valid|diparse/);
  assert.throws(() => validateMediaUrl(''), /kosong/);
});

test('downloader: host privat dikenali', () => {
  assert.equal(isPrivateHost('localhost'), true);
  assert.equal(isPrivateHost('a.localhost'), true);
  assert.equal(isPrivateHost('server.local'), true);
  assert.equal(isPrivateHost('10.0.0.1'), true);
  assert.equal(isPrivateHost('192.168.1.1'), true);
  assert.equal(isPrivateHost('[::1]'), true);
  assert.equal(isPrivateHost('youtube.com'), false);
  assert.equal(isPrivateHost('vt.tiktok.com'), false);
});

test('downloader: nama file dan durasi diformat aman', () => {
  assert.equal(safeFileName('Judul: Video / Uji 🎵', 'mp3'), 'Judul_Video_Uji.mp3');
  assert.equal(safeFileName('', 'mp4'), 'media.mp4');
  assert.equal(safeFileName('../../etc/passwd', 'mp3'), 'etcpasswd.mp3');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(3_725), '1:02:05');
  assert.equal(formatClock(0), '0:00');
});

test('downloader: available melaporkan versi yt-dlp', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner({ version: '2026.11.15' });
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  const status = await service.available();
  assert.equal(status.available, true);
  assert.equal(status.version, '2026.11.15');

  const missing = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: async () => ({ code: 127, stdout: '', stderr: 'not found', error: 'spawn yt-dlp ENOENT' }),
  });

  const missingStatus = await missing.available();
  assert.equal(missingStatus.available, false);
  assert.equal(missingStatus.version, null);
});

test('downloader: fetch audio mengunduh mp3 dan membersihkan temporary', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner({ writeBytes: 2_000 });
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  const result = await service.fetch({
    rawUrl: 'https://youtu.be/abc',
    kind: 'audio',
    platform: 'youtube',
  });

  assert.equal(result.mimetype, 'audio/mpeg');
  assert.equal(result.ext, 'mp3');
  assert.equal(result.buffer.length, 2_000);
  assert.equal(result.fileName, 'Video_Uji.mp3');
  assert.equal(result.title, 'Video Uji');
  assert.equal(result.durationSec, 30);

  const downloadCall = runner.calls.find((call) => call.args.includes('-x'));
  assert.ok(downloadCall, 'harus memanggil yt-dlp dengan mode audio');
  assert.ok(downloadCall.args.includes('--max-filesize'));

  assert.deepEqual(fs.readdirSync(service.tmpDir), [], 'file temporary harus dibersihkan');
});

test('downloader: fetch video mengunduh mp4', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner({ writeBytes: 4_000 });
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  const result = await service.fetch({
    rawUrl: 'https://www.tiktok.com/@user/video/123',
    kind: 'video',
    platform: 'tiktok',
  });

  assert.equal(result.mimetype, 'video/mp4');
  assert.equal(result.ext, 'mp4');
  assert.equal(result.title, 'Video Uji');
  assert.equal(result.author, 'Kreator Uji');
  assert.deepEqual(fs.readdirSync(service.tmpDir), []);
});

test('downloader: menolak file melebihi batas ukuran', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner({ writeBytes: 2 * 1024 * 1024 });
  const service = createDownloaderService({
    config: makeConfig(dir, { maxMb: 1 }),
    logger: silentLogger,
    runCommand: runner.run,
  });

  await assert.rejects(
    () => service.fetch({ rawUrl: 'https://youtu.be/abc', kind: 'video', platform: 'youtube' }),
    (error) => error.code === 'DOWNLOAD_TOO_LARGE',
  );

  assert.deepEqual(fs.readdirSync(service.tmpDir), [], 'file kebesaran harus dihapus');
});

test('downloader: menolak durasi melebihi batas', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner({ duration: 1_000 });
  const service = createDownloaderService({
    config: makeConfig(dir, { maxDurationSec: 900 }),
    logger: silentLogger,
    runCommand: runner.run,
  });

  await assert.rejects(
    () => service.fetch({ rawUrl: 'https://youtu.be/abc', kind: 'audio', platform: 'youtube' }),
    (error) => error.code === 'DOWNLOAD_TOO_LONG',
  );

  assert.equal(runner.calls.some((call) => call.args.includes('-x')), false);
});

test('downloader: URL tidak valid tidak memanggil yt-dlp', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner();
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  await assert.rejects(
    () => service.fetch({ rawUrl: 'https://localhost/abc', kind: 'audio', platform: 'youtube' }),
    (error) => error.code === 'DOWNLOAD_INVALID_URL',
  );

  assert.equal(runner.calls.length, 0);
});

test('downloader: kegagalan probe menjadi DOWNLOAD_FAILED', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: async () => ({ code: 1, stdout: '', stderr: 'Video unavailable', error: null }),
  });

  await assert.rejects(
    () => service.fetch({ rawUrl: 'https://youtu.be/abc', kind: 'audio', platform: 'youtube' }),
    (error) => error.code === 'DOWNLOAD_FAILED',
  );
});

test('downloader: limiter membatasi paralelisme dan antrean', async () => {
  const limiter = createLimiter({ concurrency: 1, maxQueue: 1 });

  let release = null;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const first = limiter.run(async () => {
    await gate;
    return 'pertama';
  });

  const second = limiter.run(async () => 'kedua');

  await assert.rejects(
    () => limiter.run(async () => 'ketiga'),
    (error) => error.code === 'DOWNLOAD_BUSY',
  );

  release();
  assert.equal(await first, 'pertama');
  assert.equal(await second, 'kedua');
});

test('downloader: command ytmp3 mengirim audio dan caption', async (t) => {
  const stub = {
    available: async () => ({ available: true, version: 'test' }),
    async fetch({ kind }) {
      return {
        buffer: Buffer.from('media-bytes'),
        ext: kind === 'audio' ? 'mp3' : 'mp4',
        mimetype: kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
        sizeBytes: 11,
        title: 'Judul Uji',
        author: 'Kreator Uji',
        durationSec: 42,
        fileName: `uji.${kind === 'audio' ? 'mp3' : 'mp4'}`,
        platform: 'youtube',
      };
    },
  };

  const bot = createTestBot({ downloader: stub });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp3 https://youtu.be/abc' }),
  );

  const audio = bot.sent.find((entry) => Buffer.isBuffer(entry.payload?.audio));
  assert.ok(audio, 'audio harus terkirim');
  assert.equal(audio.payload.mimetype, 'audio/mpeg');
  assert.match(lastText(bot), /Judul Uji/);
  assert.match(lastText(bot), /0:42/);
});

test('downloader: command tiktok mengirim video dengan caption', async (t) => {
  const stub = {
    available: async () => ({ available: true, version: 'test' }),
    async fetch() {
      return {
        buffer: Buffer.from('video-bytes'),
        ext: 'mp4',
        mimetype: 'video/mp4',
        sizeBytes: 11,
        title: 'TikTok Uji',
        author: 'Kreator Uji',
        durationSec: 15,
        fileName: 'uji.mp4',
        platform: 'tiktok',
      };
    },
  };

  const bot = createTestBot({ downloader: stub });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.tiktok https://vt.tiktok.com/abc/' }),
  );

  const video = bot.sent.find((entry) => Buffer.isBuffer(entry.payload?.video));
  assert.ok(video, 'video harus terkirim');
  assert.match(video.payload.caption, /TikTok Uji/);
  assert.match(video.payload.caption, /Kreator Uji/);
});

test('downloader: command memberi pesan jelas saat yt-dlp tidak ada', async (t) => {
  const bot = createTestBot({ downloader: null });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp4 https://youtu.be/abc' }),
  );

  assert.match(lastText(bot), /yt-dlp/);
  assert.match(lastText(bot), /doctor/);
});

test('downloader: error durasi dan URL diterjemahkan ke pesan pengguna', async (t) => {
  const longStub = {
    available: async () => ({ available: true, version: 'test' }),
    async fetch() {
      throw new AppError('DOWNLOAD_TOO_LONG', 'terlalu panjang', undefined, {
        duration: '1:00:00',
        max: '15:00',
      });
    },
  };

  const bot = createTestBot({ downloader: longStub });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp3 https://youtu.be/abc' }),
  );
  assert.match(lastText(bot), /Durasi 1:00:00/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp3 bukan-url' }),
  );
  assert.match(lastText(bot), /URL tidak valid/);
});
