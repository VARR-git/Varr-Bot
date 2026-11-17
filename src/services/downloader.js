/**
 * Downloader Phase 2: YouTube (audio/video) dan TikTok.
 *
 * Mesin utama adalah **yt-dlp** (binary eksternal). Alasan:
 * - yt-dlp menangani perubahan situs sumber jauh lebih cepat daripada library JS;
 * - satu mesin bisa dipakai untuk YouTube, TikTok, dan fase berikutnya;
 * - tidak ada API key pihak ketiga yang harus disimpan.
 *
 * Pengamanan yang diterapkan di sini:
 * - hanya http/https, tanpa userinfo, dan hanya port 80/443;
 * - host wajib masuk allowlist platform (cegah SSRF ke alamat internal);
 * - IP literal, localhost, dan domain internal ditolak;
 * - batas ukuran file, durasi, timeout proses, dan jumlah unduhan paralel;
 * - setiap unduhan memakai direktori temporary sendiri dan selalu dibersihkan;
 * - yt-dlp dijalankan dengan `--ignore-config` dan `--no-cache-dir`;
 * - auto-install (opsional) hanya dari rilis resmi GitHub dan checksum SHA-256
 *   diverifikasi sebelum binary dijalankan.
 *
 * Spawn selalu memakai argumen array (tanpa shell) sehingga URL dari chat tidak
 * bisa menjadi command injection.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { AppError } = require('../core/errors');

const PLATFORMS = Object.freeze({
  youtube: Object.freeze({
    label: 'YouTube',
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
  }),
  tiktok: Object.freeze({
    label: 'TikTok',
    hosts: ['tiktok.com'],
  }),
});

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set(['', '80', '443']);
const MAX_URL_LENGTH = 2_048;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 512 * 1024;
const FFPROBE_TIMEOUT_MS = 30_000;
const REMUX_TIMEOUT_MS = 60_000;
const TRANSCODE_TIMEOUT_MS = 300_000;
const TMP_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const TMP_PREFIX = 'varr-';

const AVAILABLE_TTL_MS = 5 * 60 * 1_000;
const AVAILABLE_FAILURE_TTL_MS = 30 * 1_000;
const FFMPEG_TTL_MS = 5 * 60 * 1_000;
const FFMPEG_FAILURE_TTL_MS = 30 * 1_000;

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const RELEASE_CHECKSUMS = 'SHA2-256SUMS';
const MAX_CHECKSUM_BYTES = 2 * 1024 * 1024;
const MAX_RELEASE_BYTES = 60 * 1024 * 1024;
const RELEASE_TIMEOUT_MS = 180_000;
const DOWNLOAD_HOSTS = Object.freeze(['github.com', 'githubusercontent.com']);

const MIME_BY_EXT = Object.freeze({
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  // IP literal (IPv4) dan IPv6 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(':') || host.startsWith('[')) return true;
  return false;
}

/**
 * @param {string} hostname
 * @param {string[]} allowed
 * @returns {boolean}
 */
function hostMatches(hostname, allowed) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return allowed.some((base) => host === base || host.endsWith(`.${base}`));
}

/**
 * Validasi URL dari chat. Melempar AppError dengan kode yang bisa dipetakan
 * command ke pesan pengguna.
 *
 * @param {string} raw
 * @param {'youtube'|'tiktok'} [platform]
 * @returns {{url: string, host: string, platform: string}}
 */
function validateMediaUrl(raw, platform) {
  const value = String(raw || '').trim();

  if (!value || value.length > MAX_URL_LENGTH) {
    throw new AppError('DOWNLOAD_INVALID_URL', 'URL kosong atau terlalu panjang.');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError('DOWNLOAD_INVALID_URL', 'URL tidak bisa diparse.');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new AppError('DOWNLOAD_INVALID_URL', `Protokol ${parsed.protocol} tidak diizinkan.`);
  }

  if (parsed.username || parsed.password) {
    throw new AppError('DOWNLOAD_INVALID_URL', 'URL dengan kredensial tidak diizinkan.');
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new AppError('DOWNLOAD_INVALID_URL', `Port ${parsed.port} tidak diizinkan.`);
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (isPrivateHost(host)) {
    throw new AppError('DOWNLOAD_INVALID_URL', 'Host internal tidak diizinkan.');
  }

  const config = platform ? PLATFORMS[platform] : null;
  if (config && !hostMatches(host, config.hosts)) {
    throw new AppError('DOWNLOAD_UNSUPPORTED_HOST', `Host ${host} bukan ${config.label}.`);
  }

  return { url: parsed.toString(), host, platform: platform || 'unknown' };
}

/**
 * @param {number} seconds
 * @returns {string}
 */
function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * @param {string} title
 * @param {string} ext
 * @returns {string}
 */
function safeFileName(title, ext) {
  const base = String(title || 'media')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '')
    .slice(0, 60)
    .replace(/[._-]+$/, '');

  return `${base || 'media'}.${ext}`;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isPathLike(value) {
  const text = String(value || '');
  return path.isAbsolute(text) || text.includes('/') || text.includes('\\');
}

const META_PREFIX = 'VARR:';
const META_KEYS = new Set(['title', 'duration', 'acodec', 'uploader', 'islive', 'type', 'weburl']);

/**
 * Parse baris metadata yang dicetak yt-dlp lewat `--print before_dl:VARR:...`.
 * Marker dipakai agar judul/uploader yang mengandung newline tetap terbaca.
 *
 * @param {string} output
 * @returns {{title: string, durationSec: number, hasAudio: boolean, author: string, isLive: boolean, isPlaylist: boolean, webpageUrl: string}}
 */
function parseMetaOutput(output) {
  const raw = {
    title: '',
    duration: '',
    acodec: '',
    uploader: '',
    islive: '',
    type: '',
    weburl: '',
  };

  let current = null;

  for (const line of String(output || '').split(/\r?\n/)) {
    const idx = line.indexOf(META_PREFIX);

    if (idx !== -1) {
      const rest = line.slice(idx + META_PREFIX.length);
      const sep = rest.indexOf(':');
      const key = sep === -1 ? rest : rest.slice(0, sep);
      const value = sep === -1 ? '' : rest.slice(sep + 1);

      if (META_KEYS.has(key)) {
        current = key;
        raw[key] = value;
        continue;
      }
    }

    if (current) raw[current] += `${raw[current] ? '\n' : ''}${line}`;
  }

  return {
    title: raw.title.trim(),
    durationSec: Number(raw.duration) || 0,
    hasAudio: !raw.acodec || raw.acodec.toLowerCase() !== 'none',
    author: raw.uploader.trim(),
    isLive: /^(true|1)$/i.test(raw.islive.trim()),
    isPlaylist: raw.type.trim().toLowerCase() === 'playlist',
    webpageUrl: raw.weburl.trim(),
  };
}

/**
 * Cari binary di BIN_DIR terlebih dahulu, lalu fallback ke nama di PATH.
 *
 * @param {object} options
 * @param {string} options.binary
 * @param {string} options.binDir
 * @param {NodeJS.Platform} [options.platform]
 * @param {object} [options.fsImpl]
 * @returns {string}
 */
function resolveBinaryPath({
  binary = 'yt-dlp',
  binDir,
  platform = process.platform,
  fsImpl = fs,
} = {}) {
  const value = String(binary || 'yt-dlp');
  if (isPathLike(value)) return value;

  const base = path.basename(value);
  const names = platform === 'win32'
    ? (path.extname(base).toLowerCase() === '.exe'
      ? [base, base.slice(0, -4)]
      : [`${base}.exe`, base])
    : [base];

  if (binDir) {
    for (const name of names) {
      const candidate = path.join(binDir, name);
      try {
        if (fsImpl.statSync(candidate).isFile()) return candidate;
      } catch {
        // Lanjut ke kandidat berikutnya.
      }
    }
  }

  return value;
}

/**
 * @param {NodeJS.Platform} platform
 * @returns {boolean}
 */
function isMuslRuntime() {
  if (process.platform !== 'linux') return false;
  try {
    const report = process.report?.getReport?.();
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

/**
 * @param {NodeJS.Platform} platform
 * @returns {string}
 */
function releaseAssetName(platform = process.platform) {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') return isMuslRuntime() ? 'yt-dlp_musl' : 'yt-dlp_linux';
  throw new Error(`Auto-install yt-dlp belum mendukung platform ${platform}.`);
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isAllowedDownloadHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return DOWNLOAD_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

/**
 * Unduh file HTTPS dengan batas ukuran, timeout, dan allowlist host.
 * Redirect hanya boleh menuju host GitHub/GitHubusercontent.
 *
 * @param {string} url
 * @param {string} destination
 * @param {{maxBytes?: number, timeoutMs?: number, redirects?: number}} [options]
 * @returns {Promise<{bytes: number}>}
 */
function httpsDownload(url, destination, {
  maxBytes = MAX_RELEASE_BYTES,
  timeoutMs = RELEASE_TIMEOUT_MS,
  redirects = 5,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const attempt = (target, remaining) => {
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        fail(new Error('URL unduhan tidak valid.'));
        return;
      }

      if (parsed.protocol !== 'https:' || !isAllowedDownloadHost(parsed.hostname)) {
        fail(new Error(`Host unduhan tidak diizinkan: ${parsed.hostname}`));
        return;
      }

      const request = https.get(parsed, {
        headers: {
          'User-Agent': 'Varr-Bot',
          Accept: 'application/octet-stream',
        },
      }, (response) => {
        const status = Number(response.statusCode) || 0;

        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (remaining <= 0) {
            fail(new Error('Redirect unduhan terlalu banyak.'));
            return;
          }
          attempt(new URL(response.headers.location, target).toString(), remaining - 1);
          return;
        }

        if (status !== 200) {
          response.resume();
          fail(new Error(`Unduhan gagal (HTTP ${status}).`));
          return;
        }

        const length = Number(response.headers['content-length']);
        if (Number.isFinite(length) && length > maxBytes) {
          response.resume();
          fail(new Error('File unduhan terlalu besar.'));
          return;
        }

        const output = fs.createWriteStream(destination, { flags: 'w', mode: 0o600 });
        let received = 0;
        let aborted = false;

        const abort = (error) => {
          if (aborted) return;
          aborted = true;
          request.destroy();
          output.destroy();
          fail(error);
        };

        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxBytes) abort(new Error('File unduhan terlalu besar.'));
        });
        response.on('error', abort);
        output.on('error', abort);
        output.on('finish', () => done({ bytes: received }));
        response.pipe(output);
      });

      request.setTimeout(timeoutMs, () => request.destroy(new Error('Unduhan timeout.')));
      request.on('error', fail);
    };

    attempt(url, redirects);
  });
}

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Pasang yt-dlp dari rilis resmi GitHub. Checksum SHA-256 wajib cocok; bila
 * checksum tidak tersedia, instalasi dibatalkan (fail closed).
 *
 * @param {object} options
 * @param {string} options.binDir
 * @param {NodeJS.Platform} [options.platform]
 * @param {object} [options.logger]
 * @param {Function} [options.download]
 * @param {Function} [options.hash]
 * @param {object} [options.fsImpl]
 * @returns {Promise<string>} path binary hasil instalasi
 */
async function installYtDlpRelease({
  binDir,
  platform = process.platform,
  logger,
  download = httpsDownload,
  hash = hashFile,
  fsImpl = fs,
} = {}) {
  const asset = releaseAssetName(platform);
  const target = path.join(binDir, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

  fsImpl.mkdirSync(binDir, { recursive: true, mode: 0o755 });
  const workDir = fsImpl.mkdtempSync(path.join(binDir, '.varr-install-'));

  try {
    const checksumPath = path.join(workDir, RELEASE_CHECKSUMS);
    const assetPath = path.join(workDir, asset);

    await download(`${RELEASE_BASE}/${RELEASE_CHECKSUMS}`, checksumPath, {
      maxBytes: MAX_CHECKSUM_BYTES,
      timeoutMs: RELEASE_TIMEOUT_MS,
    });
    await download(`${RELEASE_BASE}/${asset}`, assetPath, {
      maxBytes: MAX_RELEASE_BYTES,
      timeoutMs: RELEASE_TIMEOUT_MS,
    });

    const checksums = fsImpl.readFileSync(checksumPath, 'utf8');
    const expected = checksums
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .find((parts) => parts.length >= 2 && parts[1] === asset)?.[0];

    if (!/^[a-f0-9]{64}$/i.test(expected || '')) {
      throw new Error(`Checksum untuk ${asset} tidak ditemukan di rilis resmi.`);
    }

    const actual = await hash(assetPath);
    if (String(actual).toLowerCase() !== expected.toLowerCase()) {
      throw new Error('Checksum yt-dlp tidak cocok; instalasi dibatalkan.');
    }

    if (platform !== 'win32') fsImpl.chmodSync(assetPath, 0o755);
    fsImpl.rmSync(target, { force: true });
    fsImpl.renameSync(assetPath, target);

    logger?.info?.({ path: target, asset }, 'yt-dlp dipasang dari rilis resmi GitHub');
    return target;
  } finally {
    fsImpl.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Petakan stderr/error yt-dlp ke kode error yang bisa diterjemahkan command.
 *
 * @param {{stderr?: string, error?: string|null}} result
 * @returns {AppError|null}
 */
function classifyFailure(result = {}) {
  const text = `${result.error || ''}\n${result.stderr || ''}`;

  if (/\btimeout\b/i.test(text)) {
    return new AppError('DOWNLOAD_TIMEOUT', 'Proses unduhan melebihi batas waktu.');
  }

  if (/max-filesize|larger than|file is larger/i.test(text)) {
    return new AppError('DOWNLOAD_TOO_LARGE', 'File melebihi batas ukuran.');
  }

  if (/ffmpeg.*(?:not found|not installed|not available)|ffprobe.*(?:not found|not installed)/i.test(text)) {
    return new AppError('DOWNLOAD_FFMPEG_MISSING', 'FFmpeg tidak tersedia untuk konversi media.');
  }

  if (/not a bot|captcha|unusual traffic|bot check/i.test(text)) {
    return new AppError('DOWNLOAD_BOT_CHECK', 'YouTube meminta verifikasi bot.');
  }

  if (/age[- ]restricted|confirm your age|inappropriate for some users|age[- ]gate/i.test(text)) {
    return new AppError('DOWNLOAD_AGE_RESTRICTED', 'Media dibatasi usia.');
  }

  if (
    /private video|video unavailable|this video is unavailable|has been removed|removed by the uploader|members[- ]only|not available in your country|geo[- ]restricted|live event|premieres in|upcoming|no longer available/i.test(text)
  ) {
    return new AppError('DOWNLOAD_UNAVAILABLE', 'Media tidak tersedia.');
  }

  if (/requested format (?:is )?not available|no video formats found|format is not available/i.test(text)) {
    return new AppError('DOWNLOAD_FORMAT', 'Format media tidak tersedia.');
  }

  return null;
}

/**
 * Batasi jumlah unduhan yang berjalan bersamaan agar RAM dan disk tidak
 * dihabiskan banyak permintaan sekaligus.
 *
 * @param {{concurrency?: number, maxQueue?: number}} [options]
 */
function createLimiter({ concurrency = 2, maxQueue = 10 } = {}) {
  const limit = Math.max(1, Math.trunc(concurrency) || 2);
  const queueLimit = Math.max(1, Math.trunc(maxQueue) || 10);

  let active = 0;
  const queue = [];

  function drain() {
    while (active < limit && queue.length > 0) {
      const job = queue.shift();
      active += 1;

      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function run(task) {
    if (active < limit && queue.length === 0) {
      active += 1;
      return Promise.resolve().then(task).finally(() => {
        active -= 1;
        drain();
      });
    }

    if (queue.length >= queueLimit) {
      return Promise.reject(new AppError(
        'DOWNLOAD_BUSY',
        'Antrean downloader penuh.',
      ));
    }

    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      drain();
    });
  }

  return {
    run,
    get active() {
      return active;
    },
    get pending() {
      return queue.length;
    },
  };
}

/**
 * Menjalankan proses tanpa shell dan mengumpulkan output dengan batas ukuran.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{timeoutMs?: number, onStdout?: (chunk: string, stdout: string) => boolean}} [options]
 *   `onStdout` dipanggil setiap ada data stdout; mengembalikan `true` untuk
 *   menghentikan proses (mis. metadata sudah melanggar batas durasi).
 * @returns {Promise<{code: number|null, stdout: string, stderr: string, error: string|null}>}
 */
function runProcess(file, args, { timeoutMs = 120_000, onStdout } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timer = null;
    let killPromise = null;
    /** @type {{code: number|null, stdout: string, stderr: string, error: string}|null} */
    let forcedResult = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', error: error.message });
      return;
    }

    /**
     * Bunuh proses beserta anak-anaknya, lalu tunggu sebentar agar file
     * temporary tidak dihapus saat masih dipakai (khusus Windows).
     *
     * @returns {Promise<void>}
     */
    const killTree = () => {
      if (killPromise) return killPromise;

      try {
        child.kill('SIGKILL');
      } catch {
        // Proses sudah berhenti.
      }

      if (process.platform !== 'win32' || !child.pid) {
        killPromise = Promise.resolve();
        return killPromise;
      }

      killPromise = new Promise((resolveKill) => {
        let done = false;
        const settle = () => {
          if (done) return;
          done = true;
          resolveKill();
        };

        try {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.on('error', settle);
          killer.on('close', settle);
          const guard = setTimeout(settle, 1_500);
          guard.unref?.();
        } catch {
          settle();
        }
      });

      return killPromise;
    };

    const abortWith = (error) => {
      if (forcedResult) return;
      forcedResult = { code: null, stdout, stderr, error };
      killTree().finally(() => finish(forcedResult));
    };

    timer = setTimeout(() => {
      abortWith(`timeout ${timeoutMs}ms`);
    }, Math.max(1_000, timeoutMs));
    timer.unref?.();

    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        abortWith('output stdout terlalu besar');
        return;
      }

      const text = chunk.toString();
      stdout += text;

      if (typeof onStdout === 'function' && !forcedResult) {
        let abort = false;
        try {
          abort = Boolean(onStdout(text, stdout));
        } catch {
          // Callback tidak boleh menjatuhkan proses.
        }
        if (abort) abortWith('aborted by caller');
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) return;
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      finish({ code: null, stdout, stderr, error: error.message });
    });

    child.on('close', (code) => {
      if (forcedResult) {
        killTree().finally(() => finish(forcedResult));
        return;
      }

      finish({ code, stdout, stderr, error: null });
    });
  });
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeProcessError(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/\s+/g, ' ')
    .slice(0, 300)
    .trim();
}

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} [options.logger]
 * @param {(file: string, args: string[], options?: object) => Promise<object>} [options.runCommand]
 * @param {object} [options.fsImpl]
 * @param {(options: object) => Promise<string>} [options.installBinary]
 */
function createDownloaderService({
  config,
  logger,
  runCommand = runProcess,
  fsImpl = fs,
  installBinary = installYtDlpRelease,
}) {
  const configuredBinary = String(config?.download?.binary || 'yt-dlp');
  const binDir = config?.download?.binDir
    || path.join(config?.dataDir || 'data', 'bin');
  const autoInstall = Boolean(config?.download?.autoInstall);
  const ffmpegPath = String(config?.download?.ffmpegPath || 'ffmpeg');
  const cookiesFile = String(config?.download?.cookiesFile || '');
  const maxBytes = Math.max(1, Number(config?.download?.maxMb) || 16) * 1024 * 1024;
  const maxDurationSec = Math.max(30, Number(config?.download?.maxDurationSec) || 900);
  const timeoutMs = Math.max(5_000, Number(config?.download?.timeoutMs) || 120_000);
  const tmpDir = config?.tmpDir || path.join(config?.dataDir || 'data', 'tmp');

  const limiter = createLimiter({
    concurrency: config?.download?.concurrency ?? 2,
    maxQueue: config?.download?.queueMax ?? 10,
  });

  /** @type {{available: boolean, version: string|null, error?: string, checkedAt: number}|null} */
  let availability = null;
  /** @type {{available: boolean, version: string|null, error?: string, checkedAt: number}|null} */
  let ffmpegStatusCache = null;
  let installPromise = null;
  let installAttempted = false;
  let cookiesWarned = false;

  function resolveBinary() {
    return resolveBinaryPath({
      binary: configuredBinary,
      binDir,
      platform: process.platform,
      fsImpl,
    });
  }

  function ensureTmpDir() {
    fsImpl.mkdirSync(tmpDir, { recursive: true });
  }

  function resolveFfmpeg() {
    return resolveBinaryPath({
      binary: ffmpegPath,
      binDir,
      platform: process.platform,
      fsImpl,
    });
  }

  /**
   * ffprobe biasanya satu paket dengan ffmpeg. Jika FFMPEG_PATH menunjuk file
   * absolut, cari ffprobe di folder yang sama.
   *
   * @returns {string}
   */
  function resolveFfprobe() {
    const ffmpeg = resolveFfmpeg();

    if (isPathLike(ffmpeg)) {
      return path.join(
        path.dirname(ffmpeg),
        process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
      );
    }

    return resolveBinaryPath({
      binary: 'ffprobe',
      binDir,
      platform: process.platform,
      fsImpl,
    });
  }

  function isFresh(status, ttl) {
    return Boolean(status) && Date.now() - Number(status.checkedAt || 0) < ttl;
  }

  /**
   * Hapus file/direktori sementara yang tertinggal (mis. proses mati saat unduh).
   *
   * @param {number} [maxAgeMs]
   * @returns {number}
   */
  function pruneTmp(maxAgeMs = TMP_MAX_AGE_MS) {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    try {
      for (const name of fsImpl.readdirSync(tmpDir)) {
        if (!name.startsWith(TMP_PREFIX)) continue;
        const fullPath = path.join(tmpDir, name);
        try {
          const stat = fsImpl.lstatSync(fullPath);
          if (stat.mtimeMs < cutoff) {
            fsImpl.rmSync(fullPath, { recursive: true, force: true });
            removed += 1;
          }
        } catch {
          // File sudah hilang.
        }
      }
    } catch {
      // Direktori belum ada.
    }

    return removed;
  }

  /**
   * Statistik file sementara milik downloader (rekursif).
   *
   * @returns {{count: number, sizeBytes: number}}
   */
  function tmpStats() {
    let count = 0;
    let sizeBytes = 0;

    const walk = (target) => {
      let stat;
      try {
        stat = fsImpl.lstatSync(target);
      } catch {
        return;
      }

      if (stat.isFile()) {
        count += 1;
        sizeBytes += stat.size;
        return;
      }

      if (!stat.isDirectory()) return;

      let names = [];
      try {
        names = fsImpl.readdirSync(target);
      } catch {
        return;
      }

      for (const name of names) {
        walk(path.join(target, name));
      }
    };

    let names = [];
    try {
      names = fsImpl.readdirSync(tmpDir);
    } catch {
      return { count, sizeBytes };
    }

    for (const name of names) {
      if (!name.startsWith(TMP_PREFIX)) continue;
      walk(path.join(tmpDir, name));
    }

    return { count, sizeBytes };
  }

  /**
   * @param {string} file
   * @returns {Promise<{available: boolean, version: string|null, error?: string, checkedAt: number}>}
   */
  async function checkBinary(file) {
    const result = await runCommand(file, ['--version'], { timeoutMs: 15_000 });
    const version = result.code === 0
      ? String(result.stdout || '').trim().split(/\r?\n/)[0] || null
      : null;

    return {
      available: Boolean(version),
      version,
      error: version
        ? undefined
        : result.error || sanitizeProcessError(result.stderr) || 'binary tidak ditemukan',
      checkedAt: Date.now(),
    };
  }

  /**
   * Cek yt-dlp. Jika `YTDLP_AUTO_INSTALL=true`, binary yang belum ada dipasang
   * sekali dari rilis resmi (dengan verifikasi checksum).
   *
   * @param {{force?: boolean}} [options]
   * @returns {Promise<{available: boolean, version: string|null, error?: string, checkedAt: number}>}
   */
  async function available({ force = false } = {}) {
    if (!force && isFresh(availability, availability?.available
      ? AVAILABLE_TTL_MS
      : AVAILABLE_FAILURE_TTL_MS)) {
      return availability;
    }

    let status = await checkBinary(resolveBinary());

    if (!status.available && autoInstall && !isPathLike(configuredBinary)) {
      if (!installPromise && !installAttempted) {
        installAttempted = true;
        installPromise = (async () => {
          logger?.info?.(
            { binDir, platform: process.platform },
            'yt-dlp tidak ditemukan; mencoba auto-install dari rilis resmi',
          );

          try {
            return await installBinary({
              binDir,
              platform: process.platform,
              logger,
              fsImpl,
            });
          } catch (error) {
            logger?.warn?.({ err: error, binDir }, 'Auto-install yt-dlp gagal');
            return null;
          } finally {
            installPromise = null;
          }
        })();
      }

      if (installPromise) await installPromise;
      status = await checkBinary(resolveBinary());

      if (!status.available) {
        installAttempted = true;
      }
    }

    availability = status;

    if (!status.available) {
      logger?.warn?.(
        { binary: resolveBinary(), error: status.error },
        'yt-dlp tidak tersedia; command downloader dinonaktifkan',
      );
    }

    return status;
  }

  /**
   * @param {{force?: boolean}} [options]
   * @returns {Promise<{available: boolean, version: string|null, error?: string, checkedAt: number}>}
   */
  async function ffmpegStatus({ force = false } = {}) {
    if (!force && isFresh(ffmpegStatusCache, ffmpegStatusCache?.available
      ? FFMPEG_TTL_MS
      : FFMPEG_FAILURE_TTL_MS)) {
      return ffmpegStatusCache;
    }

    const result = await runCommand(resolveFfmpeg(), ['-version'], { timeoutMs: 10_000 });
    const match = result.code === 0
      ? String(result.stdout || '').match(/ffmpeg version (\S+)/i)
      : null;

    ffmpegStatusCache = {
      available: Boolean(match),
      version: match ? match[1] : null,
      error: match ? undefined : result.error || sanitizeProcessError(result.stderr) || 'ffmpeg tidak ditemukan',
      checkedAt: Date.now(),
    };

    return ffmpegStatusCache;
  }

  /**
   * @returns {string|null}
   */
  function resolveCookiesFile() {
    if (!cookiesFile) return null;

    try {
      if (fsImpl.statSync(cookiesFile).isFile()) return cookiesFile;
    } catch {
      // Dilanjutkan ke peringatan di bawah.
    }

    if (!cookiesWarned) {
      cookiesWarned = true;
      logger?.warn?.({ cookiesFile }, 'File cookies yt-dlp tidak ditemukan; cookies diabaikan');
    }

    return null;
  }

  /**
   * Cari file hasil unduhan yang ekstensinya sesuai. File lain (mis. gambar
   * slideshow TikTok) dianggap media tidak didukung.
   *
   * @param {string} directory
   * @param {string[]} extensions
   * @returns {{path: string, ext: string, size: number}}
   */
  function pickOutputFile(directory, extensions) {
    let names = [];
    try {
      names = fsImpl.readdirSync(directory);
    } catch {
      return null;
    }

    const files = [];
    for (const name of names) {
      const fullPath = path.join(directory, name);
      try {
        const stat = fsImpl.lstatSync(fullPath);
        if (!stat.isFile() || stat.size <= 0) continue;
        files.push({
          path: fullPath,
          ext: path.extname(name).slice(1).toLowerCase(),
          size: stat.size,
        });
      } catch {
        // File sudah hilang.
      }
    }

    const expected = files.filter((entry) => extensions.includes(entry.ext));
    if (expected.length > 0) {
      return expected.sort((a, b) => b.size - a.size)[0];
    }

    if (files.length > 0) {
      throw new AppError(
        'DOWNLOAD_UNSUPPORTED_MEDIA',
        'Hasil unduhan bukan audio/video yang didukung (kemungkinan slideshow/foto).',
      );
    }

    return null;
  }

  /**
   * @param {string} file
   * @returns {number}
   */
  function fileSize(file) {
    try {
      const stat = fsImpl.statSync(file);
      return stat.isFile() ? stat.size : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Baca stream + durasi container dengan ffprobe.
   *
   * @param {string} file
   * @returns {Promise<{streams: object[], format: object}|null>}
   */
  async function probeVideoInfo(file) {
    const result = await runCommand(
      resolveFfprobe(),
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      { timeoutMs: FFPROBE_TIMEOUT_MS },
    );

    if (result.code !== 0 || !String(result.stdout || '').trim()) return null;

    try {
      const parsed = JSON.parse(String(result.stdout));
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        streams: Array.isArray(parsed.streams) ? parsed.streams : [],
        format: parsed.format && typeof parsed.format === 'object' ? parsed.format : {},
      };
    } catch {
      return null;
    }
  }

  /**
   * WhatsApp hanya bisa memutar MP4 dengan video H.264 8-bit (yuv420p) dan
   * audio AAC. yt-dlp secara default memilih AV1/VP9 karena kualitasnya lebih
   * tinggi, jadi hasilnya harus dinormalisasi sebelum dikirim.
   *
   * - H.264/AAC → remux cepat (`-c copy`) + faststart.
   * - Codec lain (AV1/VP9/HEVC/AAC selain mp4a) → transcode ke H.264/AAC.
   *
   * Selain normalisasi codec, file juga divalidasi: durasi hasil harus sesuai
   * dengan metadata sumber (mendeteksi unduhan terpotong) dan audio tidak boleh
   * hilang bila sumbernya punya audio.
   *
   * @param {string} file
   * @param {string} workDir
   * @param {{expectedDuration?: number, expectedAudio?: boolean}} [expect]
   * @returns {Promise<string>} path file yang siap dikirim
   */
  async function makeWhatsAppVideo(file, workDir, expect = {}) {
    const info = await probeVideoInfo(file);

    if (!info) {
      logger?.warn?.(
        { ffprobe: resolveFfprobe() },
        'ffprobe tidak tersedia; kompatibilitas video WhatsApp tidak diverifikasi',
      );
      return file;
    }

    const video = info.streams.find((stream) => stream.codec_type === 'video');
    const audio = info.streams.find((stream) => stream.codec_type === 'audio');

    if (!video) {
      throw new AppError('DOWNLOAD_UNSUPPORTED_MEDIA', 'File hasil unduhan tidak berisi video.');
    }

    const expectedDuration = Number(expect.expectedDuration) || 0;
    const actualDuration = Number(video.duration ?? info.format.duration ?? 0);

    if (expectedDuration > 0 && actualDuration > 0) {
      const ratio = actualDuration / expectedDuration;
      if (ratio < 0.9 || ratio > 1.1) {
        throw new AppError(
          'DOWNLOAD_FAILED',
          `Unduhan tampak terpotong: durasi ${formatClock(actualDuration)} dari ${formatClock(expectedDuration)}.`,
        );
      }
    }

    if (expect.expectedAudio && !audio) {
      throw new AppError(
        'DOWNLOAD_FAILED',
        'Audio video hilang pada hasil unduhan.',
      );
    }

    const videoOk = video.codec_name === 'h264'
      && ['yuv420p', 'yuvj420p'].includes(String(video.pix_fmt || ''));
    const audioOk = !audio || audio.codec_name === 'aac';
    const output = path.join(workDir, 'whatsapp.mp4');
    const ffmpeg = resolveFfmpeg();

    if (videoOk && audioOk) {
      const remux = await runCommand(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', file,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c', 'copy',
        '-movflags', '+faststart',
        output,
      ], { timeoutMs: REMUX_TIMEOUT_MS });

      if (remux.code === 0 && fileSize(output) > 0) return output;

      logger?.warn?.(
        { error: sanitizeProcessError(remux.stderr) },
        'Remux faststart gagal; memakai file asli',
      );
      return file;
    }

    logger?.info?.(
      {
        videoCodec: video.codec_name || null,
        pixFmt: video.pix_fmt || null,
        audioCodec: audio?.codec_name || null,
      },
      'Video tidak kompatibel dengan WhatsApp; transcode ke H.264/AAC',
    );

    const transcode = await runCommand(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', file,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-vf', "scale='min(1920,iw)':-2",
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      output,
    ], { timeoutMs: TRANSCODE_TIMEOUT_MS });

    if (transcode.code !== 0 || fileSize(output) === 0) {
      throw new AppError(
        'DOWNLOAD_FORMAT',
        `Video tidak bisa dikonversi ke format WhatsApp: ${sanitizeProcessError(transcode.stderr)}`,
      );
    }

    return output;
  }

  /**
   * Unduh media dan kembalikan buffer. Direktori temporary selalu dihapus.
   *
   * Metadata sumber dikumpulkan lewat `--print before_dl:` dalam proses yt-dlp
   * yang **sama** dengan unduhan, jadi ekstraksi hanya sekali — lebih cepat
   * daripada memanggil yt-dlp dua kali (probe lalu unduh).
   *
   * @param {object} options
   * @param {string} options.url
   * @param {'audio'|'video'} options.kind
   * @param {'youtube'|'tiktok'} options.platform
   * @returns {Promise<object>}
   */
  async function downloadMedia({ url, kind, platform }) {
    ensureTmpDir();
    pruneTmp();

    const ffmpeg = await ffmpegStatus();
    if (kind === 'audio' && !ffmpeg.available) {
      throw new AppError('DOWNLOAD_FFMPEG_MISSING', 'FFmpeg tidak tersedia untuk konversi audio.');
    }

    const workDir = fsImpl.mkdtempSync(path.join(tmpDir, TMP_PREFIX));
    const template = path.join(workDir, 'media.%(ext)s');

    const args = [
      '--ignore-config',
      '--no-cache-dir',
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--no-part',
      '--socket-timeout', '20',
      '--retries', '2',
      '--max-filesize', String(maxBytes),
      '-o', template,
      // Metadata dicetak sebelum unduhan dimulai.
      '--print', `before_dl:${META_PREFIX}title:%(title)s`,
      '--print', `before_dl:${META_PREFIX}duration:%(duration)s`,
      '--print', `before_dl:${META_PREFIX}acodec:%(acodec)s`,
      '--print', `before_dl:${META_PREFIX}uploader:%(uploader)s`,
      '--print', `before_dl:${META_PREFIX}islive:%(is_live)s`,
      '--print', `before_dl:${META_PREFIX}type:%(_type)s`,
      '--print', `before_dl:${META_PREFIX}weburl:%(webpage_url)s`,
    ];

    const resolvedFfmpeg = resolveFfmpeg();
    const ffmpegLocation = isPathLike(resolvedFfmpeg) ? resolvedFfmpeg : '';
    if (ffmpegLocation) args.push('--ffmpeg-location', ffmpegLocation);

    const cookies = resolveCookiesFile();
    if (cookies) args.push('--cookies', cookies);

    if (kind === 'audio') {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '5');
    } else {
      // Prioritaskan format progresif (satu file, H.264+AAC) supaya cepat dan
      // tidak butuh merge; batasi 720p agar ukuran kecil dan unduhan cepat.
      // WhatsApp tidak bisa memutar AV1/VP9, jadi makeWhatsAppVideo akan
      // transcode bila sumber hanya menyediakan codec lain.
      const progressive = ffmpeg.available
        ? 'b[ext=mp4][vcodec^=avc1][height<=720]'
          + '/b[ext=mp4][height<=720]'
          + '/bv*[vcodec^=avc1][height<=720][ext=mp4]+ba[acodec^=mp4a][ext=m4a]'
          + '/b[ext=mp4]/b'
        : 'b[ext=mp4][vcodec^=avc1][height<=720]'
          + '/b[ext=mp4]/b';

      args.push(
        '-f', progressive,
        '-S', 'res:720',
        '--merge-output-format', 'mp4',
      );
    }

    args.push(url);

    let abortedTooLong = false;

    const onStdout = (_chunk, stdoutSoFar) => {
      const match = /VARR:duration:([0-9]+(?:\.[0-9]+)?)/.exec(stdoutSoFar);
      if (match && Number(match[1]) > maxDurationSec) {
        abortedTooLong = true;
        return true;
      }
      return false;
    };

    try {
      const result = await runCommand(resolveBinary(), args, { timeoutMs, onStdout });
      const meta = parseMetaOutput(result.stdout || '');

      if (abortedTooLong) {
        throw new AppError(
          'DOWNLOAD_TOO_LONG',
          `Durasi ${formatClock(meta.durationSec)} melebihi batas ${formatClock(maxDurationSec)}.`,
          undefined,
          { duration: formatClock(meta.durationSec), max: formatClock(maxDurationSec) },
        );
      }

      if (result.code !== 0) {
        const classified = classifyFailure(result);
        if (classified) {
          if (classified.code === 'DOWNLOAD_TOO_LARGE') {
            classified.meta = { max: Math.round(maxBytes / (1024 * 1024)) };
          }
          throw classified;
        }

        throw new AppError(
          'DOWNLOAD_FAILED',
          `yt-dlp gagal: ${result.error || sanitizeProcessError(result.stderr)}`,
        );
      }

      if (meta.isLive) {
        throw new AppError('DOWNLOAD_UNAVAILABLE', 'Live stream tidak bisa diunduh.');
      }

      if (meta.isPlaylist) {
        throw new AppError(
          'DOWNLOAD_UNSUPPORTED_MEDIA',
          'Konten berupa playlist/slideshow tidak didukung.',
        );
      }

      // Fallback bila onStdout tidak sempat mencegat (mis. runner uji).
      if (meta.durationSec > maxDurationSec) {
        throw new AppError(
          'DOWNLOAD_TOO_LONG',
          `Durasi ${formatClock(meta.durationSec)} melebihi batas ${formatClock(maxDurationSec)}.`,
          undefined,
          { duration: formatClock(meta.durationSec), max: formatClock(maxDurationSec) },
        );
      }

      let output = pickOutputFile(
        workDir,
        kind === 'audio' ? ['mp3'] : ['mp4'],
      );

      if (!output) {
        throw new AppError('DOWNLOAD_FAILED', 'File hasil unduhan tidak ditemukan.');
      }

      if (kind === 'video') {
        const compatible = await makeWhatsAppVideo(output.path, workDir, {
          expectedDuration: meta.durationSec,
          expectedAudio: meta.hasAudio,
        });
        if (compatible !== output.path) {
          output = { path: compatible, ext: 'mp4', size: fileSize(compatible) };
        }
      }

      if (fileSize(output.path) === 0) {
        throw new AppError('DOWNLOAD_FAILED', 'File hasil unduhan kosong atau tidak terbaca.');
      }

      if (output.size > maxBytes) {
        throw new AppError(
          'DOWNLOAD_TOO_LARGE',
          `File melebihi batas ${Math.round(maxBytes / (1024 * 1024))} MB.`,
          undefined,
          { max: Math.round(maxBytes / (1024 * 1024)) },
        );
      }

      const buffer = fsImpl.readFileSync(output.path);

      return {
        buffer,
        ext: output.ext,
        mimetype: MIME_BY_EXT[output.ext] || 'application/octet-stream',
        sizeBytes: buffer.length,
        platform,
        kind,
        meta,
      };
    } finally {
      try {
        fsImpl.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Cleanup tidak boleh menutupi error utama.
      }
    }
  }

  /**
   * Alur lengkap: validasi → cek binary → unduh (metadata + media sekali jalan).
   *
   * @param {object} options
   * @param {string} options.rawUrl
   * @param {'audio'|'video'} options.kind
   * @param {'youtube'|'tiktok'} options.platform
   * @returns {Promise<object>}
   */
  async function fetch({ rawUrl, kind, platform }) {
    const { url } = validateMediaUrl(rawUrl, platform);

    return limiter.run(async () => {
      const status = await available();
      if (!status.available) {
        throw new AppError(
          'DOWNLOAD_NOT_READY',
          'yt-dlp belum tersedia sehingga media tidak bisa diunduh.',
        );
      }

      const media = await downloadMedia({ url, kind, platform });
      const meta = media.meta;

      const title = meta.title || 'media';
      const fileName = safeFileName(title, media.ext);

      logger?.info?.(
        {
          platform,
          kind,
          host: new URL(url).hostname,
          sizeBytes: media.sizeBytes,
          durationSec: meta.durationSec,
        },
        'Download media selesai',
      );

      return {
        ...media,
        title,
        author: meta.author || null,
        durationSec: meta.durationSec,
        fileName,
        webpageUrl: meta.webpageUrl || url,
      };
    });
  }

  return {
    get binary() {
      return resolveBinary();
    },
    binDir,
    autoInstall,
    ffmpegPath,
    maxBytes,
    maxDurationSec,
    tmpDir,
    available,
    ffmpegStatus,
    fetch,
    pruneTmp,
    tmpStats,
    get queue() {
      return { active: limiter.active, pending: limiter.pending };
    },
  };
}

module.exports = {
  PLATFORMS,
  MIME_BY_EXT,
  AVAILABLE_TTL_MS,
  AVAILABLE_FAILURE_TTL_MS,
  TMP_PREFIX,
  classifyFailure,
  createLimiter,
  createDownloaderService,
  formatClock,
  hashFile,
  hostMatches,
  httpsDownload,
  installYtDlpRelease,
  isPrivateHost,
  parseMetaOutput,
  releaseAssetName,
  resolveBinaryPath,
  runProcess,
  safeFileName,
  sanitizeProcessError,
  validateMediaUrl,
};
