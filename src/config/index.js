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
 * Parse nilai boolean dari environment. Nilai yang tidak dikenal memakai
 * fallback agar salah ketik tidak diam-diam mengaktifkan fitur berisiko.
 *
 * @param {string|undefined} value
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
function booleanValue(value, fallback = false) {
  if (typeof value !== 'string' || !value.trim()) return fallback;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'aktif'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'nonaktif'].includes(normalized)) return false;
  return fallback;
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
 * Parse target AI `provider:model`. Model boleh mengandung `:` dan `/`,
 * jadi hanya `:` pertama yang dianggap pemisah. Tanpa `:` berarti memakai
 * provider default.
 *
 * @param {string|undefined} value
 * @param {string} fallbackProvider
 * @returns {{provider: string, model: string}|null}
 */
function parseAiTarget(value, fallbackProvider) {
  const text = stringValue(value, '');
  if (!text) return null;

  const sep = text.indexOf(':');
  const provider = (sep === -1 ? fallbackProvider : text.slice(0, sep)).trim().toLowerCase();
  const model = (sep === -1 ? text : text.slice(sep + 1)).trim();

  if (!provider || !model) return null;
  return { provider, model };
}

/**
 * Parse daftar fallback `provider:model` yang dipisahkan koma.
 *
 * @param {string|undefined} value
 * @param {string} fallbackProvider
 * @returns {Array<{provider: string, model: string}>}
 */
function parseAiFallbacks(value, fallbackProvider) {
  return String(value || '')
    .split(',')
    .map((item) => parseAiTarget(item, fallbackProvider))
    .filter(Boolean);
}

/**
 * Parse daftar API key yang dipisahkan koma (key pool). Spasi, `;`, dan
 * baris baru juga diperbolehkan sebagai pemisah. Hasil unik dan ter-trim.
 *
 * @param {string|undefined} value
 * @returns {string[]}
 */
function parseKeyPool(value) {
  return [...new Set(
    String(value || '')
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

/**
 * Gabungkan key pool (`*_API_KEYS`) dengan key tunggal lama (`*_API_KEY`)
 * untuk kompatibilitas mundur. Key pool menang bila diisi.
 *
 * @param {string|undefined} poolValue
 * @param {string|undefined} singleValue
 * @returns {string[]}
 */
function buildKeyPool(poolValue, singleValue) {
  const pool = parseKeyPool(poolValue);
  if (pool.length > 0) return pool;

  const single = stringValue(singleValue, '');
  return single ? [single] : [];
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

  const cookiesFile = stringValue(env.YTDLP_COOKIES_FILE, '');
  const aiPrimaryProvider = stringValue(env.AI_PRIMARY_PROVIDER, 'gemini').toLowerCase();

  const geminiKeys = buildKeyPool(env.GEMINI_API_KEYS, env.GEMINI_API_KEY);
  const groqKeys = buildKeyPool(env.GROQ_API_KEYS, env.GROQ_API_KEY);
  const openRouterKeys = buildKeyPool(env.OPENROUTER_API_KEYS, env.OPENROUTER_API_KEY);
  const aiDefaultModel = stringValue(env.AI_DEFAULT_MODEL, '');
  const aiDailyQuotaPerUser = numberValue(env.AI_DAILY_QUOTA_PER_USER, 0, { min: 0, max: 100_000 });

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
      autoInstall: booleanValue(env.YTDLP_AUTO_INSTALL, false),
      binDir: resolveDir(stringValue(env.BIN_DIR, path.join('data', 'bin'))),
      ffmpegPath: stringValue(env.FFMPEG_PATH, 'ffmpeg'),
      cookiesFile: cookiesFile ? resolveDir(cookiesFile) : '',
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
    ai: {
      enabled: booleanValue(env.AI_ENABLED, true),
      geminiKeys,
      groqKeys,
      openRouterKeys,
      geminiKey: geminiKeys[0] || '',
      groqKey: groqKeys[0] || '',
      openRouterKey: openRouterKeys[0] || '',
      primaryProvider: aiPrimaryProvider,
      primaryModel: stringValue(env.AI_PRIMARY_MODEL, 'gemini-2.5-pro'),
      defaultModel: aiDefaultModel || stringValue(env.AI_PRIMARY_MODEL, 'gemini-2.5-pro'),
      miniModel: stringValue(env.AI_MINI_MODEL, ''),
      fallbacks: parseAiFallbacks(env.AI_FALLBACKS, aiPrimaryProvider),
      systemPrompt: stringValue(env.AI_SYSTEM_PROMPT, ''),
      maxTokens: numberValue(env.AI_MAX_TOKENS, 1024, { min: 64, max: 8_192 }),
      timeoutMs: numberValue(env.AI_TIMEOUT_MS, 60_000, { min: 5_000, max: 300_000 }),
      maxHistory: numberValue(env.AI_MAX_HISTORY, 8, { min: 0, max: 50 }),
      promptMax: numberValue(env.AI_PROMPT_MAX, 2_000, { min: 100, max: 20_000 }),
      dailyLimit: numberValue(env.AI_DAILY_LIMIT, 0, { min: 0, max: 10_000 }),
      dailyQuotaPerUser: aiDailyQuotaPerUser || numberValue(env.AI_DAILY_LIMIT, 0, { min: 0, max: 100_000 }),
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
  booleanValue,
  parseAiTarget,
  parseAiFallbacks,
  parseKeyPool,
  buildKeyPool,
};
