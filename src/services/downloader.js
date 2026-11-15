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
 * - semua file temporary dihapus setelah dipakai.
 *
 * Spawn selalu memakai argumen array (tanpa shell) sehingga URL dari chat tidak
 * bisa menjadi command injection.
 */

const fs = require('node:fs');
const path = require('node:path');
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
const PROBE_TIMEOUT_MS = 45_000;
const TMP_MAX_AGE_MS = 6 * 60 * 60 * 1_000;

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
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{code: number|null, stdout: string, stderr: string, error: string|null}>}
 */
function runProcess(file, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timer = null;

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

    const kill = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Proses sudah berhenti.
      }
    };

    timer = setTimeout(() => {
      kill();
      finish({ code: null, stdout, stderr, error: `timeout ${timeoutMs}ms` });
    }, Math.max(1_000, timeoutMs));
    timer.unref?.();

    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        kill();
        finish({ code: null, stdout, stderr, error: 'output stdout terlalu besar' });
        return;
      }
      stdout += chunk.toString();
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
 */
function createDownloaderService({
  config,
  logger,
  runCommand = runProcess,
  fsImpl = fs,
}) {
  const binary = String(config?.download?.binary || 'yt-dlp');
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

  function ensureTmpDir() {
    fsImpl.mkdirSync(tmpDir, { recursive: true });
  }

  /**
   * Bersihkan file temporary yang tertinggal (mis. proses mati saat unduh).
   */
  function pruneTmp(maxAgeMs = TMP_MAX_AGE_MS) {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    try {
      for (const name of fsImpl.readdirSync(tmpDir)) {
        if (!name.startsWith('varr-')) continue;
        const fullPath = path.join(tmpDir, name);
        try {
          const stat = fsImpl.statSync(fullPath);
          if (stat.mtimeMs < cutoff) {
            fsImpl.rmSync(fullPath, { force: true });
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
   * @param {{force?: boolean}} [options]
   * @returns {Promise<{available: boolean, version: string|null, error?: string, checkedAt: number}>}
   */
  async function available({ force = false } = {}) {
    if (!force && availability) return availability;

    const result = await runCommand(binary, ['--version'], { timeoutMs: 15_000 });
    const version = result.code === 0
      ? String(result.stdout || '').trim().split(/\r?\n/)[0] || null
      : null;

    availability = {
      available: Boolean(version),
      version,
      error: version ? undefined : result.error || sanitizeProcessError(result.stderr) || 'binary tidak ditemukan',
      checkedAt: Date.now(),
    };

    if (!availability.available) {
      logger?.warn?.(
        { binary, error: availability.error },
        'yt-dlp tidak tersedia; command downloader dinonaktifkan',
      );
    }

    return availability;
  }

  /**
   * @param {string} url
   * @returns {Promise<object>}
   */
  async function probe(url) {
    const result = await runCommand(
      binary,
      ['-J', '--no-playlist', '--no-warnings', '--skip-download', '--no-progress', url],
      { timeoutMs: PROBE_TIMEOUT_MS },
    );

    if (result.code !== 0 || !String(result.stdout || '').trim()) {
      throw new AppError(
        'DOWNLOAD_FAILED',
        `Probe media gagal: ${result.error || sanitizeProcessError(result.stderr)}`,
      );
    }

    let info = null;
    const output = String(result.stdout).trim();

    try {
      info = JSON.parse(output);
    } catch {
      // `-J` menulis satu baris JSON; ambil baris terakhir yang valid.
      for (const line of output.split(/\r?\n/).reverse()) {
        if (!line.trim().startsWith('{')) continue;
        try {
          info = JSON.parse(line);
          break;
        } catch {
          // Baris berikutnya.
        }
      }
    }

    if (!info || typeof info !== 'object') {
      throw new AppError('DOWNLOAD_FAILED', 'Metadata media tidak bisa dibaca.');
    }

    return info;
  }

  /**
   * @param {object} info
   * @returns {{title: string, author: string, durationSec: number}}
   */
  function summarize(info) {
    const title = String(info.title || info.fulltitle || '').trim()
      || String(info.id || '').trim()
      || '';
    const author = String(info.uploader || info.channel || info.creator || '').trim();
    const durationSec = Number(info.duration) || 0;

    return { title, author, durationSec };
  }

  /**
   * @param {string} token
   * @param {string[]} extensions
   * @returns {string|null}
   */
  function pickOutputFile(token, extensions) {
    let names = [];
    try {
      names = fsImpl.readdirSync(tmpDir);
    } catch {
      return null;
    }

    const prefix = `${token}.`;
    const candidates = names
      .filter((name) => name.startsWith(prefix))
      .map((name) => {
        const fullPath = path.join(tmpDir, name);
        try {
          return { path: fullPath, size: fsImpl.statSync(fullPath).size };
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && entry.size > 0);

    if (candidates.length === 0) return null;

    const preferred = candidates.find((entry) => (
      extensions.includes(path.extname(entry.path).slice(1).toLowerCase())
    ));

    return (preferred || candidates.sort((a, b) => b.size - a.size)[0]).path;
  }

  /**
   * @param {string} token
   */
  function cleanupToken(token) {
    const prefix = `${token}.`;
    try {
      for (const name of fsImpl.readdirSync(tmpDir)) {
        if (name.startsWith(prefix)) {
          fsImpl.rmSync(path.join(tmpDir, name), { force: true });
        }
      }
    } catch {
      // Tidak ada yang perlu dibersihkan.
    }
  }

  /**
   * Unduh media dan kembalikan buffer. File temporary selalu dihapus.
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

    const token = `varr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const template = path.join(tmpDir, `${token}.%(ext)s`);
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--no-part',
      '--socket-timeout', '20',
      '--retries', '2',
      '--max-filesize', String(maxBytes),
      '-o', template,
    ];

    if (kind === 'audio') {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '5');
    } else {
      args.push(
        '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
        '--merge-output-format', 'mp4',
      );
    }

    args.push(url);

    try {
      const result = await runCommand(binary, args, { timeoutMs });

      if (result.code !== 0) {
        const stderr = String(result.stderr || '');
        if (/max-filesize|larger than/i.test(stderr)) {
          throw new AppError(
            'DOWNLOAD_TOO_LARGE',
            `File melebihi batas ${Math.round(maxBytes / (1024 * 1024))} MB.`,
            undefined,
            { max: Math.round(maxBytes / (1024 * 1024)) },
          );
        }
        if (/ffmpeg.*(not found|not installed)/i.test(stderr)) {
          throw new AppError('DOWNLOAD_FFMPEG_MISSING', 'FFmpeg tidak tersedia untuk konversi media.');
        }
        throw new AppError(
          'DOWNLOAD_FAILED',
          `yt-dlp gagal: ${result.error || sanitizeProcessError(stderr)}`,
        );
      }

      const outputPath = pickOutputFile(token, kind === 'audio' ? ['mp3'] : ['mp4']);
      if (!outputPath) {
        throw new AppError('DOWNLOAD_FAILED', 'File hasil unduhan tidak ditemukan.');
      }

      const size = fsImpl.statSync(outputPath).size;
      if (size > maxBytes) {
        throw new AppError(
          'DOWNLOAD_TOO_LARGE',
          `File melebihi batas ${Math.round(maxBytes / (1024 * 1024))} MB.`,
          undefined,
          { max: Math.round(maxBytes / (1024 * 1024)) },
        );
      }

      const buffer = fsImpl.readFileSync(outputPath);
      const ext = path.extname(outputPath).slice(1).toLowerCase();

      return {
        buffer,
        ext,
        mimetype: MIME_BY_EXT[ext] || 'application/octet-stream',
        sizeBytes: buffer.length,
        platform,
        kind,
      };
    } finally {
      cleanupToken(token);
    }
  }

  /**
   * Alur lengkap: validasi → batas durasi → unduh.
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
      const info = await probe(url);
      const summary = summarize(info);

      if (info.is_live) {
        throw new AppError('DOWNLOAD_FAILED', 'Live stream tidak bisa diunduh.');
      }

      if (summary.durationSec > maxDurationSec) {
        throw new AppError(
          'DOWNLOAD_TOO_LONG',
          `Durasi ${formatClock(summary.durationSec)} melebihi batas ${formatClock(maxDurationSec)}.`,
          undefined,
          { duration: formatClock(summary.durationSec), max: formatClock(maxDurationSec) },
        );
      }

      const media = await downloadMedia({ url, kind, platform });
      const title = summary.title || 'media';
      const fileName = safeFileName(title, media.ext);

      logger?.info?.(
        {
          platform,
          kind,
          host: new URL(url).hostname,
          sizeBytes: media.sizeBytes,
          durationSec: summary.durationSec,
        },
        'Download media selesai',
      );

      return {
        ...media,
        title,
        author: summary.author || null,
        durationSec: summary.durationSec,
        fileName,
        webpageUrl: info.webpage_url || url,
      };
    });
  }

  return {
    binary,
    maxBytes,
    maxDurationSec,
    tmpDir,
    available,
    fetch,
    pruneTmp,
    get queue() {
      return { active: limiter.active, pending: limiter.pending };
    },
  };
}

module.exports = {
  PLATFORMS,
  MIME_BY_EXT,
  createLimiter,
  createDownloaderService,
  formatClock,
  hostMatches,
  isPrivateHost,
  runProcess,
  safeFileName,
  sanitizeProcessError,
  validateMediaUrl,
};
