const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadConfig,
  parsePrefixes,
  parseOwnerNumbers,
  digitsOnly,
  VALID_MODES,
} = require('../src/config');

test('config: default values aman', () => {
  const config = loadConfig({});

  assert.equal(config.botName, 'Varr-Bot');
  assert.deepEqual(config.prefixes, ['.']);
  assert.equal(config.prefix, '.');
  assert.equal(config.mode, 'public');
  assert.equal(config.defaultLang, 'id');
  assert.equal(config.loginMethod, 'qr');
  assert.equal(config.pairingNumber, '');
  assert.equal(config.commandTimeoutMs, 30_000);
  assert.equal(config.defaultCooldown, 3);
  assert.equal(config.queueMaxPending, 50);
  assert.equal(config.mediaMaxMb, 16);
  assert.equal(config.download.binary, 'yt-dlp');
  assert.equal(config.download.maxMb, 16);
  assert.equal(config.download.maxDurationSec, 900);
  assert.equal(config.download.timeoutMs, 120_000);
  assert.equal(config.download.concurrency, 2);
  assert.equal(config.download.queueMax, 10);
  assert.equal(config.backupKeep, 14);
  assert.equal(config.rateLimit.max, 20);
  assert.equal(config.rateLimit.windowMs, 60_000);
  assert.ok(path.isAbsolute(config.dataDir));
  assert.ok(path.isAbsolute(config.authDir));
  assert.ok(path.isAbsolute(config.tmpDir));
  assert.ok(path.isAbsolute(config.backupsDir));
  assert.deepEqual(VALID_MODES, ['public', 'private', 'self']);
});

test('config: parsing prefix, owner, dan pairing', () => {
  assert.deepEqual(parsePrefixes('.,!,.,/'), ['.', '!', '/']);
  assert.deepEqual(parsePrefixes(''), ['.']);
  assert.deepEqual(parseOwnerNumbers('+62 812-3456-7890, 628111; 123'), ['6281234567890', '628111']);
  assert.equal(digitsOnly('+62 (812) 3456'), '628123456');

  const config = loadConfig({ PAIRING_NUMBER: '+62 812-3456-7890' });
  assert.equal(config.loginMethod, 'pairing');
  assert.equal(config.pairingNumber, '6281234567890');
});

test('config: LOGIN_METHOD eksplisit', () => {
  const qr = loadConfig({ LOGIN_METHOD: 'QR', PAIRING_NUMBER: '6281234567890' });
  assert.equal(qr.loginMethod, 'qr');

  assert.throws(
    () => loadConfig({ LOGIN_METHOD: 'pairing' }),
    /PAIRING_NUMBER/,
  );
});

test('config: nilai tidak valid ditolak', () => {
  assert.throws(() => loadConfig({ MODE: 'friends' }), /MODE tidak valid/);
  assert.throws(() => loadConfig({ DEFAULT_LANG: 'jp' }), /DEFAULT_LANG tidak valid/);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), /LOG_LEVEL tidak valid/);
  assert.throws(() => loadConfig({ LOGIN_METHOD: 'sms' }), /LOGIN_METHOD tidak valid/);
});

test('config: angka dibatasi ke rentang aman', () => {
  const low = loadConfig({
    COMMAND_TIMEOUT_MS: '1',
    COMMAND_COOLDOWN: '-5',
    QUEUE_MAX_PENDING: '0',
    RATE_LIMIT_MAX: '0',
    RATE_LIMIT_WINDOW_MS: '1',
  });

  assert.equal(low.commandTimeoutMs, 1_000);
  assert.equal(low.defaultCooldown, 0);
  assert.equal(low.queueMaxPending, 1);
  assert.equal(low.rateLimit.max, 1);
  assert.equal(low.rateLimit.windowMs, 1_000);

  const fallback = loadConfig({ COMMAND_COOLDOWN: 'abc' });
  assert.equal(fallback.defaultCooldown, 3);
});

test('config: pengaturan media, downloader, dan backup', () => {
  const config = loadConfig({
    MEDIA_MAX_MB: '8',
    YTDLP_PATH: '/usr/local/bin/yt-dlp',
    DOWNLOAD_MAX_MB: '32',
    DOWNLOAD_MAX_DURATION_SEC: '600',
    DOWNLOAD_TIMEOUT_MS: '90000',
    DOWNLOAD_CONCURRENCY: '1',
    DOWNLOAD_QUEUE_MAX: '3',
    TMP_DIR: './runtime/tmp',
    BACKUP_DIR: './runtime/backups',
    BACKUP_KEEP: '7',
  });

  assert.equal(config.mediaMaxMb, 8);
  assert.equal(config.download.binary, '/usr/local/bin/yt-dlp');
  assert.equal(config.download.maxMb, 32);
  assert.equal(config.download.maxDurationSec, 600);
  assert.equal(config.download.timeoutMs, 90_000);
  assert.equal(config.download.concurrency, 1);
  assert.equal(config.download.queueMax, 3);
  assert.equal(config.backupKeep, 7);
  assert.ok(config.tmpDir.endsWith(path.join('runtime', 'tmp')));
  assert.ok(config.backupsDir.endsWith(path.join('runtime', 'backups')));

  const clamped = loadConfig({
    MEDIA_MAX_MB: '0',
    DOWNLOAD_MAX_MB: '999',
    DOWNLOAD_MAX_DURATION_SEC: '1',
    DOWNLOAD_CONCURRENCY: '0',
    BACKUP_KEEP: '0',
  });

  assert.equal(clamped.mediaMaxMb, 1);
  assert.equal(clamped.download.maxMb, 100);
  assert.equal(clamped.download.maxDurationSec, 30);
  assert.equal(clamped.download.concurrency, 1);
  assert.equal(clamped.backupKeep, 1);
});

test('config: production flag', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production' }).isProduction, true);
  assert.equal(loadConfig({ NODE_ENV: 'development' }).isProduction, false);
});
