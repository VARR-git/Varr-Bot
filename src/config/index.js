/**
 * Konfigurasi Varr-Bot dari environment.
 * Semua nilai divalidasi di satu tempat agar error cepat terdeteksi.
 */

const path = require('node:path');
const dotenv = require('dotenv');
const pkg = require('../../package.json');
const { AppError } = require('../core/errors');

dotenv.config({ quiet: true });

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const VALID_MODES = ['public', 'private', 'self'];
const VALID_LOGIN_METHODS = ['qr', 'pairing'];
const VALID_LANGS = ['id', 'en'];
const VALID_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/**
 * @param {string|undefined} value
 * @param {string} fallback
 * @returns {string}
 */
function stringValue(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * @param {string|undefined} value
 * @param {number} fallback
 * @param {{min?: number, max?: number}} [options]
 * @returns {number}
 */
function numberValue(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * @param {string} value
 * @returns {string}
 */
function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * @param {string|undefined} value
 * @returns {string[]}
 */
function parsePrefixes(value) {
  const prefixes = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return prefixes.length > 0 ? [...new Set(prefixes)] : ['.'];
}

/**
 * @param {string|undefined} value
 * @returns {string[]}
 */
function parseOwnerNumbers(value) {
  const chunks = String(value || '')
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const tokens = [];
  for (const chunk of chunks) {
    // "+62 812-3456-7890" adalah satu nomor; tanpa "+" spasi dianggap pemisah.
    if (chunk.startsWith('+')) tokens.push(chunk);
    else tokens.push(...chunk.split(/\s+/));
  }

  return [...new Set(
    tokens
      .map(digitsOnly)
      .filter((item) => item.length >= 6),
  )];
}

/**
 * @param {string} value
 * @returns {string}
 */
function resolveDir(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function loadConfig(env = process.env) {
  const prefixes = parsePrefixes(env.PREFIX);
  const mode = stringValue(env.MODE, 'public').toLowerCase();
  const defaultLang = stringValue(env.DEFAULT_LANG, 'id').toLowerCase();
  const logLevel = stringValue(env.LOG_LEVEL, 'info').toLowerCase();
  const pairingNumber = digitsOnly(env.PAIRING_NUMBER);

  const configuredLoginMethod = stringValue(env.LOGIN_METHOD, '').toLowerCase();
  const loginMethod = configuredLoginMethod || (pairingNumber ? 'pairing' : 'qr');

  if (!VALID_MODES.includes(mode)) {
    throw new AppError(
      'CONFIG_INVALID_MODE',
      `MODE tidak valid: "${mode}". Pilih ${VALID_MODES.join(', ')}.`,
    );
  }

  if (!VALID_LOGIN_METHODS.includes(loginMethod)) {
    throw new AppError(
      'CONFIG_INVALID_LOGIN',
      `LOGIN_METHOD tidak valid: "${loginMethod}". Pilih ${VALID_LOGIN_METHODS.join(', ')}.`,
    );
  }

  if (loginMethod === 'pairing' && pairingNumber.length < 8) {
    throw new AppError(
      'CONFIG_INVALID_PAIRING_NUMBER',
      'LOGIN_METHOD=pairing membutuhkan PAIRING_NUMBER dengan kode negara, misalnya 6281234567890.',
    );
  }

  if (!VALID_LANGS.includes(defaultLang)) {
    throw new AppError(
      'CONFIG_INVALID_LANG',
      `DEFAULT_LANG tidak valid: "${defaultLang}". Pilih ${VALID_LANGS.join(', ')}.`,
    );
  }

  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new AppError(
      'CONFIG_INVALID_LOG_LEVEL',
      `LOG_LEVEL tidak valid: "${logLevel}". Pilih ${VALID_LOG_LEVELS.join(', ')}.`,
    );
  }

  return {
    botName: stringValue(env.BOT_NAME, 'Varr-Bot'),
    version: pkg.version,
    rootDir: ROOT_DIR,
    env: stringValue(env.NODE_ENV, 'development'),
    isProduction: stringValue(env.NODE_ENV, 'development') === 'production',
    logLevel,
    prefixes,
    prefix: prefixes[0],
    ownerNumbers: parseOwnerNumbers(env.OWNER_NUMBERS),
    mode,
    defaultLang,
    loginMethod,
    pairingNumber,
    dataDir: resolveDir(stringValue(env.DATA_DIR, 'data')),
    authDir: resolveDir(stringValue(env.AUTH_DIR, 'auth_info_baileys')),
    databaseUrl: stringValue(env.DATABASE_URL, ''),
    commandTimeoutMs: numberValue(env.COMMAND_TIMEOUT_MS, 30_000, { min: 1_000, max: 300_000 }),
    defaultCooldown: numberValue(env.COMMAND_COOLDOWN, 3, { min: 0, max: 3_600 }),
    queueMaxPending: numberValue(env.QUEUE_MAX_PENDING, 50, { min: 1, max: 1_000 }),
    mediaMaxMb: numberValue(env.MEDIA_MAX_MB, 16, { min: 1, max: 100 }),
    download: {
      binary: stringValue(env.YTDLP_PATH, 'yt-dlp'),
      maxMb: numberValue(env.DOWNLOAD_MAX_MB, 16, { min: 1, max: 100 }),
      maxDurationSec: numberValue(env.DOWNLOAD_MAX_DURATION_SEC, 900, { min: 30, max: 7_200 }),
      timeoutMs: numberValue(env.DOWNLOAD_TIMEOUT_MS, 120_000, { min: 5_000, max: 600_000 }),
      concurrency: numberValue(env.DOWNLOAD_CONCURRENCY, 2, { min: 1, max: 4 }),
      queueMax: numberValue(env.DOWNLOAD_QUEUE_MAX, 10, { min: 1, max: 100 }),
    },
    tmpDir: resolveDir(stringValue(env.TMP_DIR, path.join('data', 'tmp'))),
    backupsDir: resolveDir(stringValue(env.BACKUP_DIR, path.join('data', 'backups'))),
    backupKeep: numberValue(env.BACKUP_KEEP, 14, { min: 1, max: 100 }),
    rateLimit: {
      max: numberValue(env.RATE_LIMIT_MAX, 20, { min: 1, max: 1_000 }),
      windowMs: numberValue(env.RATE_LIMIT_WINDOW_MS, 60_000, { min: 1_000, max: 3_600_000 }),
    },
  };
}

module.exports = {
  ROOT_DIR,
  VALID_MODES,
  VALID_LOGIN_METHODS,
  VALID_LANGS,
  VALID_LOG_LEVELS,
  loadConfig,
  parsePrefixes,
  parseOwnerNumbers,
  digitsOnly,
};
