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
  classifyFailure,
  createDownloaderService,
  createLimiter,
  formatClock,
  installYtDlpRelease,
  isPrivateHost,
  parseMetaOutput,
  parseResolution,
  releaseAssetName,
  resolveBinaryPath,
  runProcess,
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
      binDir: path.join(dir, 'bin'),
      autoInstall: false,
      ffmpegPath: 'ffmpeg',
      cookiesFile: '',
      maxMb: 1,
      maxDurationSec: 900,
      timeoutMs: 5_000,
      concurrency: 2,
      queueMax: 5,
      ...overrides,
    },
  };
}

function createFakeRunner({
  duration = 30,
  writeBytes = 1_000,
  version = '2026.01.01',
  videoCodec = 'h264',
  pixFmt = 'yuv420p',
  audioCodec = 'aac',
  probeDuration = duration,
  audio = true,
  sourceAudio = audio,
  leftovers = false,
} = {}) {
  const calls = [];

  async function run(file, args) {
    calls.push({ file, args });

    if (args.includes('--version')) {
      return { code: 0, stdout: `${version}\n`, stderr: '', error: null };
    }

    if (args[0] === '-version') {
      return {
        code: 0,
        stdout: 'ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers\n',
        stderr: '',
        error: null,
      };
    }

    if (args.includes('-print_format') && args.includes('-show_streams')) {
      const streams = [
        {
          codec_type: 'video',
          codec_name: videoCodec,
          pix_fmt: pixFmt,
          duration: String(probeDuration),
        },
      ];

      if (audio) {
        streams.push({
          codec_type: 'audio',
          codec_name: audioCodec,
          duration: String(probeDuration),
        });
      }

      return {
        code: 0,
        stdout: JSON.stringify({
          streams,
          format: { duration: String(probeDuration) },
        }),
        stderr: '',
        error: null,
      };
    }

    if (args.includes('-movflags')) {
      const input = args[args.indexOf('-i') + 1];
      const output = args[args.length - 1];
      fs.copyFileSync(input, output);
      return { code: 0, stdout: '', stderr: '', error: null };
    }

    if (args.includes('-frames:v')) {
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(64, 0xff));
      return { code: 0, stdout: '', stderr: '', error: null };
    }

    const template = args[args.indexOf('-o') + 1];
    if (leftovers) {
      // Tiru yt-dlp: merge dilewati karena total melebihi --max-filesize,
      // stream video/audio dibiarkan terpisah.
      fs.writeFileSync(template.replace('%(ext)s', 'f137.mp4'), Buffer.alloc(writeBytes, 1));
      fs.writeFileSync(template.replace('%(ext)s', 'f140.m4a'), Buffer.alloc(writeBytes, 1));
    } else {
      const ext = args.includes('-x') ? 'mp3' : 'mp4';
      fs.writeFileSync(template.replace('%(ext)s', ext), Buffer.alloc(writeBytes, 1));
    }

    const stdout = [
      'VARR:title:Video Uji',
      `VARR:duration:${duration}`,
      `VARR:acodec:${sourceAudio ? 'mp4a.40.2' : 'none'}`,
      'VARR:uploader:Kreator Uji',
      'VARR:islive:False',
      'VARR:type:video',
      'VARR:weburl:https://youtu.be/uji',
      '',
    ].join('\n');

    return { code: 0, stdout, stderr: '', error: null };
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
  assert.equal(fs.statSync(result.filePath).size, 2_000);
  assert.equal(result.fileName, 'Video_Uji.mp3');
  assert.equal(result.title, 'Video Uji');
  assert.equal(result.durationSec, 30);
  assert.equal('buffer' in result, false, 'hasil tidak boleh membawa buffer RAM penuh');

  const downloadCall = runner.calls.find((call) => call.args.includes('-x'));
  assert.ok(downloadCall, 'harus memanggil yt-dlp dengan mode audio');
  assert.ok(downloadCall.args.includes('--max-filesize'));

  result.cleanup();
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
  assert.ok(fs.statSync(result.filePath).size > 0);
  result.cleanup();
  assert.deepEqual(fs.readdirSync(service.tmpDir), []);
});

test('downloader: ytmp4 memilih H.264/AAC agar kompatibel WhatsApp', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner();
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  const result = await service.fetch({
    rawUrl: 'https://www.youtube.com/watch?v=abc',
    kind: 'video',
    platform: 'youtube',
  });
  result.cleanup();

  const downloadCall = runner.calls.find((call) => call.args.includes('--merge-output-format'));
  const format = downloadCall.args[downloadCall.args.indexOf('-f') + 1];

  assert.match(format, /^bv\*\[vcodec\^=avc1\]\[height<=720\]/, 'merge harus dicoba dulu');
  assert.match(format, /vcodec\^=avc1/);
  assert.match(format, /acodec\^=mp4a/);
  assert.match(format, /\[height<=720\]/, 'default resolusi harus 720p');
});

test('downloader: parseResolution menerima daftar resolusi dan menolak nilai lain', () => {
  for (const value of ['1080p', '720p', '480p', '360p', '240p', '144p']) {
    assert.equal(parseResolution(value), Number.parseInt(value, 10));
  }

  assert.equal(parseResolution('1080P'), 1080, 'harus case-insensitive');
  assert.equal(parseResolution(720), 720, 'angka hasil parse sebelumnya harus diterima');
  assert.equal(parseResolution(undefined), 720, 'default 720p');
  assert.equal(parseResolution(''), 720);

  for (const value of ['999p', '720', '4k', 'p1080']) {
    assert.throws(
      () => parseResolution(value),
      (error) => error.code === 'DOWNLOAD_INVALID_RESOLUTION'
        && error.message === 'Format resolusi tidak sesuai',
    );
  }
});

test('downloader: resolusi pilihan diteruskan sebagai batas height yt-dlp', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner();
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  const result = await service.fetch({
    rawUrl: 'https://www.youtube.com/watch?v=abc',
    kind: 'video',
    platform: 'youtube',
    resolution: '480p',
  });
  result.cleanup();

  const downloadCall = runner.calls.find((call) => call.args.includes('--merge-output-format'));
  const format = downloadCall.args[downloadCall.args.indexOf('-f') + 1];
  const sort = downloadCall.args[downloadCall.args.indexOf('-S') + 1];

  assert.match(format, /^bv\*\[vcodec\^=avc1\]\[height<=480\]/, 'merge harus dicoba dulu');
  assert.match(format, /\[height<=480\]/);
  assert.match(format, /\[ext=mp4\]/);
  assert.match(format, /vcodec\^=avc1/);
  assert.match(sort, /^res:480/);
  assert.equal(result.resolution, 480);
});

test('downloader: video H.264 di-remux faststart tanpa transcode', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner();
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  const result = await service.fetch({
    rawUrl: 'https://www.youtube.com/watch?v=abc',
    kind: 'video',
    platform: 'youtube',
  });
  result.cleanup();

  const ffmpegCall = runner.calls.find((call) => call.args.includes('-movflags'));
  assert.ok(ffmpegCall.args.includes('copy'));
  assert.equal(ffmpegCall.args.includes('libx264'), false);
  assert.ok(ffmpegCall.args.includes('+faststart'));
});

test('downloader: video AV1 ditranscode ke H.264/AAC untuk WhatsApp', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner({ videoCodec: 'av01', pixFmt: 'yuv420p10le' });
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  const result = await service.fetch({
    rawUrl: 'https://www.youtube.com/watch?v=abc',
    kind: 'video',
    platform: 'youtube',
  });

  assert.equal(result.ext, 'mp4');
  assert.equal(result.mimetype, 'video/mp4');

  const ffmpegCall = runner.calls.find((call) => call.args.includes('-movflags'));
  assert.ok(ffmpegCall.args.includes('libx264'));
  assert.ok(ffmpegCall.args.includes('yuv420p'));
  assert.equal(ffmpegCall.args.includes('copy'), false);
  assert.ok(ffmpegCall.args.includes('+faststart'));
  result.cleanup();
  assert.deepEqual(fs.readdirSync(service.tmpDir), []);
});

test('downloader: video tanpa audio ditolak bila sumber punya audio', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner({ sourceAudio: true, audio: false });
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  await assert.rejects(
    () => service.fetch({ rawUrl: 'https://youtu.be/abc', kind: 'video', platform: 'youtube' }),
    (error) => error.code === 'DOWNLOAD_FAILED' && /audio/i.test(error.message),
  );

  assert.deepEqual(fs.readdirSync(service.tmpDir), []);
});

test('downloader: hasil merge yang dilewati dilaporkan kelebihan ukuran', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: createFakeRunner({ leftovers: true }).run,
  });

  await assert.rejects(
    () => service.fetch({ rawUrl: 'https://youtu.be/abc', kind: 'video', platform: 'youtube' }),
    (error) => error.code === 'DOWNLOAD_TOO_LARGE' && error.meta?.max === 1,
  );

  assert.deepEqual(fs.readdirSync(service.tmpDir), []);
});

test('downloader: unduhan terpotong ditolak (durasi tidak sesuai)', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runner = createFakeRunner({ duration: 100, probeDuration: 50 });
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: runner.run,
  });

  await assert.rejects(
    () => service.fetch({ rawUrl: 'https://youtu.be/abc', kind: 'video', platform: 'youtube' }),
    (error) => error.code === 'DOWNLOAD_FAILED' && /terpotong/i.test(error.message),
  );

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

  // Unduhan dihentikan karena durasi melebihi batas; direktori kerja harus bersih.
  assert.deepEqual(fs.readdirSync(service.tmpDir), []);
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

test('downloader: kegagalan yt-dlp dipetakan ke error yang jelas', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: async (file, args) => {
      if (args.includes('--version')) {
        return { code: 0, stdout: '2026.01.01\n', stderr: '', error: null };
      }
      if (args[0] === '-version') {
        return { code: 0, stdout: 'ffmpeg version 9.0\n', stderr: '', error: null };
      }
      if (args.includes('-o')) {
        return { code: 1, stdout: '', stderr: 'Video unavailable', error: null };
      }
      return { code: 0, stdout: '', stderr: '', error: null };
    },
  });

  await assert.rejects(
    () => service.fetch({ rawUrl: 'https://youtu.be/abc', kind: 'audio', platform: 'youtube' }),
    (error) => error.code === 'DOWNLOAD_UNAVAILABLE',
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
        filePath: `uji.${kind === 'audio' ? 'mp3' : 'mp4'}`,
        ext: kind === 'audio' ? 'mp3' : 'mp4',
        mimetype: kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
        sizeBytes: 11,
        title: 'Judul Uji',
        author: 'Kreator Uji',
        durationSec: 42,
        fileName: `uji.${kind === 'audio' ? 'mp3' : 'mp4'}`,
        platform: 'youtube',
        cleanup() {},
      };
    },
  };

  const bot = createTestBot({ downloader: stub });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp3 https://youtu.be/abc' }),
  );

  const audio = bot.sent.find((entry) => entry.payload?.audio?.url);
  assert.ok(audio, 'audio harus terkirim');
  assert.equal(audio.payload.audio.url, 'uji.mp3', 'audio harus dikirim lewat path');
  assert.equal(audio.payload.mimetype, 'audio/mpeg');
  assert.equal(audio.payload.seconds, 42, 'durasi dikirim agar Baileys tidak menyalin file ulang');
  assert.match(lastText(bot), /Judul Uji/);
  assert.match(lastText(bot), /0:42/);
});

test('downloader: command tiktok mengirim video dengan caption', async (t) => {
  const stub = {
    available: async () => ({ available: true, version: 'test' }),
    async fetch() {
      return {
        filePath: 'uji.mp4',
        ext: 'mp4',
        mimetype: 'video/mp4',
        sizeBytes: 11,
        title: 'TikTok Uji',
        author: 'Kreator Uji',
        durationSec: 15,
        fileName: 'uji.mp4',
        thumbnail: 'QUJD',
        platform: 'tiktok',
        cleanup() {},
      };
    },
  };

  const bot = createTestBot({ downloader: stub });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.tiktok https://vt.tiktok.com/abc/' }),
  );

  const video = bot.sent.find((entry) => entry.payload?.video?.url);
  assert.ok(video, 'video harus terkirim');
  assert.equal(video.payload.video.url, 'uji.mp4', 'video harus dikirim lewat path');
  assert.equal(video.payload.jpegThumbnail, 'QUJD', 'thumbnail dikirim agar Baileys tidak menyalin video ulang');
  assert.match(video.payload.caption, /TikTok Uji/);
  assert.match(video.payload.caption, /Kreator Uji/);
});

test('downloader: file temporary tetap dibersihkan saat pengiriman gagal', async (t) => {
  let cleaned = 0;
  const stub = {
    available: async () => ({ available: true, version: 'test' }),
    async fetch() {
      return {
        filePath: 'uji.mp4',
        ext: 'mp4',
        mimetype: 'video/mp4',
        sizeBytes: 11,
        title: 'Video Uji',
        author: 'Kreator Uji',
        durationSec: 42,
        fileName: 'uji.mp4',
        platform: 'youtube',
        cleanup() {
          cleaned += 1;
        },
      };
    },
  };

  const bot = createTestBot({ downloader: stub });
  t.after(() => bot.close());

  bot.sock.sendMessage = async () => {
    throw new Error('pengiriman gagal');
  };

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp4 https://youtu.be/abc' }),
  );

  assert.equal(cleaned, 1, 'cleanup harus tetap jalan saat pengiriman gagal');
});

test('downloader: command ytmp4 dengan 720p memakai service asli', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: createFakeRunner().run,
  });

  const bot = createTestBot({ downloader: service });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp4 https://youtu.be/abc 720p' }),
  );

  const video = bot.sent.find((entry) => entry.payload?.video?.url);
  assert.ok(video, 'video harus terkirim, bukan error resolusi');
  assert.ok(video.payload.jpegThumbnail?.length > 0, 'thumbnail harus ikut terkirim');
  assert.equal(lastText(bot), '', 'tidak boleh ada pesan error');
  assert.deepEqual(fs.readdirSync(service.tmpDir), [], 'file temporary harus dibersihkan');
});

test('downloader: command ytmp4 menolak resolusi di luar daftar', async (t) => {
  let fetchCalls = 0;
  const stub = {
    available: async () => ({ available: true, version: 'test' }),
    async fetch() {
      fetchCalls += 1;
      return {};
    },
  };

  const bot = createTestBot({ downloader: stub });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp4 https://youtu.be/abc 999p' }),
  );

  assert.equal(lastText(bot), 'Format resolusi tidak sesuai');
  assert.equal(fetchCalls, 0, 'unduhan tidak boleh dimulai saat resolusi tidak valid');
});

test('downloader: command ytmp4 meneruskan resolusi valid (case-insensitive)', async (t) => {
  const received = [];
  const stub = {
    available: async () => ({ available: true, version: 'test' }),
    async fetch(options) {
      received.push(options);
      return {
        filePath: 'uji.mp4',
        ext: 'mp4',
        mimetype: 'video/mp4',
        sizeBytes: 11,
        title: 'Video Uji',
        author: 'Kreator Uji',
        durationSec: 42,
        fileName: 'uji.mp4',
        platform: 'youtube',
        cleanup() {},
      };
    },
  };

  const bot = createTestBot({ downloader: stub });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp4 https://youtu.be/abc 1080P' }),
  );

  assert.equal(received.length, 1);
  assert.equal(received[0].resolution, 1080);

  const video = bot.sent.find((entry) => entry.payload?.video?.url);
  assert.ok(video, 'video harus terkirim');
  assert.equal(video.payload.video.url, 'uji.mp4');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp4 https://youtu.be/def' }),
  );

  assert.equal(received.length, 2);
  assert.equal(received[1].resolution, 720, 'tanpa argumen resolusi memakai default 720p');
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

test('downloader: resolveBinaryPath memprioritaskan BIN_DIR', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'yt-dlp.exe'), '');

  assert.equal(
    resolveBinaryPath({ binary: 'yt-dlp', binDir, platform: 'win32' }),
    path.join(binDir, 'yt-dlp.exe'),
  );
  assert.equal(
    resolveBinaryPath({ binary: 'yt-dlp', binDir, platform: 'linux' }),
    'yt-dlp',
  );
  assert.equal(
    resolveBinaryPath({ binary: '/opt/yt-dlp', binDir, platform: 'linux' }),
    '/opt/yt-dlp',
  );
});

test('downloader: auto-install hanya berjalan saat diaktifkan', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let installed = false;
  let installerCalls = 0;

  const runCommand = async (file, args) => {
    if (args.includes('--version')) {
      return installed
        ? { code: 0, stdout: '2026.11.15\n', stderr: '', error: null }
        : { code: 127, stdout: '', stderr: '', error: 'spawn yt-dlp ENOENT' };
    }
    return { code: 0, stdout: '', stderr: '', error: null };
  };

  const installBinary = async ({ binDir }) => {
    installerCalls += 1;
    installed = true;
    return path.join(binDir, 'yt-dlp.exe');
  };

  const disabled = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand,
    installBinary,
  });
  assert.equal((await disabled.available()).available, false);
  assert.equal(installerCalls, 0);

  const enabled = createDownloaderService({
    config: makeConfig(dir, { autoInstall: true }),
    logger: silentLogger,
    runCommand,
    installBinary,
  });
  const status = await enabled.available();

  assert.equal(status.available, true);
  assert.equal(installerCalls, 1);

  installed = true;
  await enabled.available();
  assert.equal(installerCalls, 1, 'auto-install tidak boleh diulang terus-menerus');
});

test('downloader: availability negatif di-cache sampai force', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let healthy = false;
  let versionCalls = 0;

  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: async (file, args) => {
      if (!args.includes('--version')) return { code: 0, stdout: '', stderr: '', error: null };
      versionCalls += 1;
      return healthy
        ? { code: 0, stdout: '2026.11.15\n', stderr: '', error: null }
        : { code: 127, stdout: '', stderr: '', error: 'spawn yt-dlp ENOENT' };
    },
  });

  assert.equal((await service.available()).available, false);
  healthy = true;
  assert.equal((await service.available()).available, false, 'cache negatif harus dipakai');
  assert.equal(versionCalls, 1);
  assert.equal((await service.available({ force: true })).available, true);
});

test('downloader: audio ditolak saat FFmpeg tidak tersedia', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const calls = [];
  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: async (file, args) => {
      calls.push(args);
      if (args.includes('--version')) {
        return { code: 0, stdout: '2026.01.01\n', stderr: '', error: null };
      }
      if (args[0] === '-version') {
        return { code: 127, stdout: '', stderr: '', error: 'spawn ffmpeg ENOENT' };
      }
      return { code: 0, stdout: '', stderr: '', error: null };
    },
  });

  await assert.rejects(
    () => service.fetch({ rawUrl: 'https://youtu.be/abc', kind: 'audio', platform: 'youtube' }),
    (error) => error.code === 'DOWNLOAD_FFMPEG_MISSING',
  );
  assert.equal(calls.some((args) => args.includes('-x')), false);
});

test('downloader: slideshow/foto ditolak sebagai media tidak didukung', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: async (file, args) => {
      if (args.includes('--version')) {
        return { code: 0, stdout: '2026.01.01\n', stderr: '', error: null };
      }
      if (args[0] === '-version') {
        return { code: 0, stdout: 'ffmpeg version 9.0\n', stderr: '', error: null };
      }

      const template = args[args.indexOf('-o') + 1];
      fs.writeFileSync(template.replace('%(ext)s', 'jpg'), Buffer.alloc(100, 1));
      return { code: 0, stdout: '', stderr: '', error: null };
    },
  });

  await assert.rejects(
    () => service.fetch({
      rawUrl: 'https://www.tiktok.com/@user/photo/123',
      kind: 'video',
      platform: 'tiktok',
    }),
    (error) => error.code === 'DOWNLOAD_UNSUPPORTED_MEDIA',
  );

  assert.deepEqual(fs.readdirSync(service.tmpDir), [], 'direktori kerja harus dibersihkan');
});

test('downloader: argumen keamanan dan cookies diteruskan ke yt-dlp', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, '# Netscape HTTP Cookie File\n');

  const runner = createFakeRunner();
  const service = createDownloaderService({
    config: makeConfig(dir, {
      cookiesFile,
      ffmpegPath: path.join(dir, 'ffmpeg-custom.exe'),
    }),
    logger: silentLogger,
    runCommand: runner.run,
  });

  await service.fetch({
    rawUrl: 'https://www.youtube.com/watch?v=abc',
    kind: 'video',
    platform: 'youtube',
  });

  const downloadCall = runner.calls.find((call) => call.args.includes('-o'));
  assert.ok(downloadCall.args.includes('--ignore-config'));
  assert.ok(downloadCall.args.includes('--no-cache-dir'));
  assert.ok(downloadCall.args.includes('--cookies'));
  assert.equal(downloadCall.args[downloadCall.args.indexOf('--cookies') + 1], cookiesFile);
  assert.ok(downloadCall.args.includes('--ffmpeg-location'));
  assert.equal(
    downloadCall.args[downloadCall.args.indexOf('--ffmpeg-location') + 1],
    path.join(dir, 'ffmpeg-custom.exe'),
  );
});

test('downloader: klasifikasi error yt-dlp', () => {
  const cases = [
    [{ stderr: "Sign in to confirm you're not a bot" }, 'DOWNLOAD_BOT_CHECK'],
    [{ stderr: 'This video is age-restricted' }, 'DOWNLOAD_AGE_RESTRICTED'],
    [{ stderr: 'Private video. Sign in if you have access' }, 'DOWNLOAD_UNAVAILABLE'],
    [{ stderr: 'Requested format is not available' }, 'DOWNLOAD_FORMAT'],
    [{ error: 'timeout 5000ms' }, 'DOWNLOAD_TIMEOUT'],
    [{ stderr: 'File is larger than max-filesize' }, 'DOWNLOAD_TOO_LARGE'],
    [{ stderr: 'ffmpeg not found' }, 'DOWNLOAD_FFMPEG_MISSING'],
    [{ stderr: 'some unknown failure' }, null],
  ];

  for (const [result, code] of cases) {
    assert.equal(classifyFailure(result)?.code ?? null, code);
  }
});

test('downloader: runProcess menghentikan proses saat timeout', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 10_000)'],
    { timeoutMs: 1_000 },
  );

  assert.equal(result.code, null);
  assert.match(result.error, /timeout 1000ms/);
});

test('downloader: runProcess abort via onStdout', async () => {
  const script = [
    "process.stdout.write('mulai\\n');",
    "setTimeout(() => process.stdout.write('akhir\\n'), 5_000);",
  ].join(' ');

  const result = await runProcess(
    process.execPath,
    ['-e', script],
    {
      timeoutMs: 10_000,
      onStdout: (chunk) => chunk.includes('mulai'),
    },
  );

  assert.equal(result.code, null);
  assert.equal(result.error, 'aborted by caller');
  assert.ok(!result.stdout.includes('akhir'), 'proses harus berhenti sebelum menulis "akhir"');
});

test('downloader: parseMetaOutput membaca metadata dari stdout', () => {
  const output = [
    'VARR:title:Video Uji',
    'VARR:duration:125',
    'VARR:acodec:none',
    'VARR:uploader:Kreator',
    'VARR:islive:False',
    'VARR:type:video',
    'VARR:weburl:https://youtu.be/uji',
  ].join('\n');

  const meta = parseMetaOutput(output);

  assert.equal(meta.title, 'Video Uji');
  assert.equal(meta.durationSec, 125);
  assert.equal(meta.hasAudio, false);
  assert.equal(meta.author, 'Kreator');
  assert.equal(meta.isLive, false);
  assert.equal(meta.isPlaylist, false);
  assert.equal(meta.webpageUrl, 'https://youtu.be/uji');
});

test('downloader: parseMetaOutput melanjutkan baris judul multi-baris', () => {
  const output = [
    'VARR:title:Judul baris pertama',
    'baris kedua',
    'VARR:duration:30.5',
    'VARR:type:playlist',
  ].join('\n');

  const meta = parseMetaOutput(output);

  assert.equal(meta.title, 'Judul baris pertama\nbaris kedua');
  assert.equal(meta.durationSec, 30.5);
  assert.equal(meta.isPlaylist, true);
});

test('downloader: tmpStats dan pruneTmp menangani direktori rekursif', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const tmpDir = path.join(dir, 'tmp');
  const oldDir = path.join(tmpDir, 'varr-old');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'nested.bin'), Buffer.alloc(64, 1));
  fs.writeFileSync(path.join(tmpDir, 'varr-live.bin'), Buffer.alloc(36, 1));

  const old = new Date(Date.now() - 7 * 60 * 60 * 1_000);
  fs.utimesSync(oldDir, old, old);

  const service = createDownloaderService({
    config: makeConfig(dir),
    logger: silentLogger,
    runCommand: async () => ({ code: 0, stdout: '', stderr: '', error: null }),
  });

  assert.deepEqual(service.tmpStats(), { count: 2, sizeBytes: 100 });
  assert.equal(service.pruneTmp(), 1);
  assert.deepEqual(service.tmpStats(), { count: 1, sizeBytes: 36 });
  assert.equal(fs.existsSync(oldDir), false);
});

test('downloader: installer resmi memverifikasi checksum SHA-256', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const binDir = path.join(dir, 'bin');
  const asset = releaseAssetName('win32');
  const expected = 'a'.repeat(64);

  const download = async (url, destination) => {
    fs.writeFileSync(
      destination,
      url.endsWith('SHA2-256SUMS') ? `${expected}  ${asset}\n` : 'binary',
    );
  };

  const target = await installYtDlpRelease({
    binDir,
    platform: 'win32',
    logger: silentLogger,
    download,
    hash: async () => expected,
  });

  assert.equal(target, path.join(binDir, 'yt-dlp.exe'));
  assert.equal(fs.readFileSync(target, 'utf8'), 'binary');

  await assert.rejects(
    () => installYtDlpRelease({
      binDir,
      platform: 'win32',
      logger: silentLogger,
      download,
      hash: async () => 'b'.repeat(64),
    }),
    /Checksum/,
  );
});

test('downloader: kode error baru diterjemahkan ke pesan pengguna', async (t) => {
  const stub = {
    available: async () => ({ available: true, version: 'test' }),
    async fetch() {
      throw new AppError('DOWNLOAD_BOT_CHECK', 'bot check');
    },
  };

  const bot = createTestBot({ downloader: stub });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp3 https://youtu.be/abc' }),
  );

  assert.match(lastText(bot), /verifikasi bot/i);
});

test('downloader: pesan ffmpeg missing memakai prefix asli', async (t) => {
  const stub = {
    available: async () => ({ available: true, version: 'test' }),
    async fetch() {
      throw new AppError('DOWNLOAD_FFMPEG_MISSING', 'ffmpeg missing');
    },
  };

  const bot = createTestBot({ downloader: stub });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ytmp3 https://youtu.be/abc' }),
  );

  assert.match(lastText(bot), /\.doctor/);
  assert.doesNotMatch(lastText(bot), /\{prefix\}/);
});
