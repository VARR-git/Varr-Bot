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
  assert.equal(config.rateLimit.max, 20);
  assert.equal(config.rateLimit.windowMs, 60_000);
  assert.ok(path.isAbsolute(config.dataDir));
  assert.ok(path.isAbsolute(config.authDir));
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

test('config: production flag', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production' }).isProduction, true);
  assert.equal(loadConfig({ NODE_ENV: 'development' }).isProduction, false);
});
