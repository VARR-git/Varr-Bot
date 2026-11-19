const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const {
  PLATFORMS,
  createLimiter,
  scrapeFacebook,
  scrapePinterest,
  scrapeSpotify,
  validateMediaUrl,
} = require('../src/services/downloader');

const VALID = [
  ['instagram', 'https://www.instagram.com/reel/AbCdEf123/'],
  ['facebook', 'https://www.facebook.com/watch/?v=1234567890'],
  ['facebook', 'https://fb.watch/AbCdEf123/'],
  ['x', 'https://x.com/user/status/1234567890'],
  ['x', 'https://twitter.com/user/status/1234567890'],
  ['threads', 'https://www.threads.net/@user/post/AbCdEf123'],
  ['pinterest', 'https://www.pinterest.com/pin/1234567890/'],
  ['pinterest', 'https://pin.it/AbCdEf123'],
  ['spotify', 'https://open.spotify.com/track/AbCdEf123'],
  ['soundcloud', 'https://soundcloud.com/user/track-name'],
];

const SSRF = [
  'http://127.0.0.1/reel/abc',
  'http://169.254.169.254/latest/meta-data/',
  'http://localhost/status/1',
  'http://[::1]/pin/1',
  'http://user:pass@x.com/status/1',
  'http://x.com:8080/status/1',
  'ftp://x.com/status/1',
  'http://evil.example/x.com/status/1',
];

test('platform baru punya allowlist host sendiri', () => {
  for (const platform of ['instagram', 'facebook', 'x', 'threads', 'pinterest', 'spotify', 'soundcloud']) {
    assert.ok(PLATFORMS[platform], `platform ${platform} belum terdaftar`);
    assert.ok(PLATFORMS[platform].hosts.length > 0);
  }
});

test('URL valid tiap platform baru diterima', () => {
  for (const [platform, url] of VALID) {
    const result = validateMediaUrl(url, platform);
    assert.equal(result.platform, platform, url);
  }
});

test('URL mencurigakan/SSRF ditolak untuk setiap platform', () => {
  for (const platform of ['instagram', 'facebook', 'x', 'threads', 'pinterest', 'spotify', 'soundcloud']) {
    for (const url of SSRF) {
      assert.throws(
        () => validateMediaUrl(url, platform),
        (error) => String(error.code).startsWith('DOWNLOAD_'),
        `${platform}: ${url}`,
      );
    }
  }
});

test('host platform lain ditolak', () => {
  assert.throws(
    () => validateMediaUrl('https://www.tiktok.com/@user/video/1', 'instagram'),
    /DOWNLOAD_UNSUPPORTED_HOST|Host .* bukan Instagram/,
  );
});

test('antrean concurrency membatasi task paralel', async () => {
  const limiter = createLimiter({ concurrency: 2, maxQueue: 5 });
  const started = [];
  const resolvers = [];
  let active = 0;
  let maxActive = 0;

  const tasks = [0, 1, 2].map((index) => limiter.run(async () => {
    started.push(index);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => { resolvers[index] = resolve; });
    active -= 1;
    return index;
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1]);
  assert.equal(limiter.active, 2);
  assert.equal(limiter.pending, 1);

  resolvers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);

  resolvers[1]();
  resolvers[2]();

  assert.deepEqual(await Promise.all(tasks), [0, 1, 2]);
  assert.equal(maxActive, 2);
});

test('antrean penuh ditolak dengan DOWNLOAD_BUSY', async () => {
  const limiter = createLimiter({ concurrency: 1, maxQueue: 1 });
  let release;
  const first = limiter.run(() => new Promise((resolve) => { release = resolve; }));
  const second = limiter.run(async () => 'kedua');

  await assert.rejects(
    limiter.run(async () => 'ketiga'),
    (error) => error.code === 'DOWNLOAD_BUSY',
  );

  release();
  await first;
  assert.equal(await second, 'kedua');
});

function spotifyResponse(body, cookie = 'sess=abc; Path=/') {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => null,
      getSetCookie: () => [cookie],
    },
    json: async () => body,
  };
}

test('Spotify mengambil metadata dan link MP3 dari spotidown', async () => {
  const meta = Buffer.from(JSON.stringify({
    name: 'About You',
    artist: 'The 1975',
    album: 'Being Funny',
    duration: '4:12',
    date: '2022',
  })).toString('base64');

  const first = `<input type="hidden" name="data" value="${meta}">`
    + '<input type="hidden" name="base" value="https://open.spotify.com/track/abc">'
    + '<input type="hidden" name="token" value="tok123">';
  const second = '<a href="https://cdn.example.com/song.mp3"><span><span>Download Mp3</span></span></a>';

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: String(init.body) });
    return spotifyResponse({ data: calls.length === 1 ? first : second });
  };

  const track = await scrapeSpotify('https://open.spotify.com/track/abc', { fetchImpl });

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/action$/);
  assert.match(calls[1].url, /\/action\/track$/);
  assert.match(calls[1].body, /token=tok123/);
  assert.deepEqual(track, {
    title: 'About You',
    artist: 'The 1975',
    album: 'Being Funny',
    durationSec: 252,
    releaseYear: '2022',
    coverUrl: null,
    mp3Url: 'https://cdn.example.com/song.mp3',
  });
});

test('Spotify gagal bila sumber tidak mengembalikan token', async () => {
  const fetchImpl = async () => spotifyResponse({ data: '<html></html>' });

  await assert.rejects(
    scrapeSpotify('https://open.spotify.com/track/abc', { fetchImpl }),
    (error) => error.code === 'DOWNLOAD_UNAVAILABLE',
  );
});

function pinterestResponse(body) {
  return {
    ok: true,
    status: 200,
    url: 'https://www.pinterest.com/pin/1234567890/',
    text: async () => body,
  };
}

test('Pinterest mengambil URL video dan gambar dari snippet', async () => {
  const leaf = JSON.stringify({
    name: 'Pin cantik',
    image: 'https://i.pinimg.com/736x/aa/bb/cc.jpg',
  });
  const video = JSON.stringify({
    name: 'Pin video',
    contentUrl: 'https://v1.pinimg.com/videos/aa/bb/cc.mp4',
    duration: 'PT12S',
  });
  const html = `<script data-test-id="leaf-snippet" type="application/json">${leaf}</script>`
    + `<script data-test-id="video-snippet" type="application/json">${video}</script>`;

  const pin = await scrapePinterest('https://www.pinterest.com/pin/1234567890/', {
    fetchImpl: async () => pinterestResponse(html),
  });

  assert.deepEqual(pin, {
    title: 'Pin cantik',
    image: 'https://i.pinimg.com/736x/aa/bb/cc.jpg',
    video: 'https://v1.pinimg.com/videos/aa/bb/cc.mp4',
    durationSec: 12,
  });
});

test('Pinterest gagal bila snippet media tidak ada', async () => {
  await assert.rejects(
    scrapePinterest('https://www.pinterest.com/pin/1234567890/', {
      fetchImpl: async () => pinterestResponse('<html></html>'),
    }),
    (error) => error.code === 'DOWNLOAD_UNAVAILABLE',
  );
});

test('Facebook mengambil token lalu link video dari fbdownloader', async () => {
  const page = '<script>k_exp="exp123";k_token="tok123"</script>';
  const result = {
    data: '<td class="video-quality">HD</td><a href="https://video.example.com/hd.mp4">Download</a>'
      + '<td class="video-quality">SD</td><td data-videourl="https://video.example.com/sd.mp4"></td>',
  };

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? String(init.body) : '' });
    return calls.length === 1
      ? { ok: true, status: 200, text: async () => page }
      : { ok: true, status: 200, json: async () => result };
  };

  const media = await scrapeFacebook('https://www.facebook.com/watch/?v=1234567890', { fetchImpl });

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/id$/);
  assert.match(calls[1].url, /\/api\/ajaxSearch$/);
  assert.match(calls[1].body, /k_token=tok123/);
  assert.deepEqual(media, { quality: 'HD', url: 'https://video.example.com/hd.mp4' });
});

test('Facebook gagal bila token tidak ditemukan', async () => {
  await assert.rejects(
    scrapeFacebook('https://www.facebook.com/watch/?v=1234567890', {
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html></html>' }),
    }),
    (error) => error.code === 'DOWNLOAD_UNAVAILABLE',
  );
});

const originalLoad = Module._load;
const calls = [];

Module._load = function load(request, parent, isMain) {
  if (request === './_shared' && parent?.filename?.includes('downloader')) {
    return {
      executeDownload: async (ctx, options) => {
        calls.push(options);
        return options;
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

const COMMANDS = [
  ['ig', 'instagram', 'video', ['instagram', 'igdl']],
  ['fb', 'facebook', 'video', ['facebook', 'fbdl']],
  ['x', 'x', 'video', ['twitter', 'twdl']],
  ['threads', 'threads', 'video', []],
  ['pinterest', 'pinterest', 'video', ['pin', 'pindl']],
  ['spotify', 'spotify', 'audio', ['spdl']],
  ['soundcloud', 'soundcloud', 'audio', ['scdl']],
];

const loaded = COMMANDS.map(([file]) => {
  const command = require(path.join('..', 'src', 'commands', 'downloader', `${file}.js`));
  return command;
});

Module._load = originalLoad;

test('command baru mengeksekusi tanpa error', async () => {
  for (let i = 0; i < COMMANDS.length; i += 1) {
    const [name, platform, kind, aliases] = COMMANDS[i];
    const command = loaded[i];
    const before = calls.length;

    assert.equal(command.name, name);
    assert.equal(command.category, 'downloader');
    for (const alias of aliases) assert.ok(command.aliases.includes(alias), `${name}.${alias}`);

    await assert.doesNotReject(() => command.execute({}));
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).platform, platform);
    assert.equal(calls.at(-1).kind, kind);
  }
});
