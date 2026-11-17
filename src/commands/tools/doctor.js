/**
 * `.doctor` — cek kesehatan runtime: database, session, disk, FFmpeg, sharp.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { formatBytes, formatDuration } = require('../../utils/format');

/**
 * @param {string} [binary]
 * @returns {{available: boolean, version: string|null}}
 */
function checkFfmpeg(binary = 'ffmpeg') {
  try {
    const result = spawnSync(binary, ['-version'], {
      encoding: 'utf8',
      timeout: 3_000,
      windowsHide: true,
    });

    if (result.error || result.status !== 0) {
      return { available: false, version: null };
    }

    const match = String(result.stdout || '').match(/ffmpeg version (\S+)/i);
    return { available: true, version: match ? match[1] : 'tersedia' };
  } catch {
    return { available: false, version: null };
  }
}

/**
 * @returns {{ok: boolean, version: string|null}}
 */
function checkSharp(media) {
  if (media && typeof media.available === 'boolean') {
    return { ok: media.available, version: media.available ? 'tersedia' : null };
  }

  try {
    // eslint-disable-next-line global-require
    const sharp = require('sharp');
    return { ok: true, version: sharp.versions?.sharp || 'tersedia' };
  } catch {
    return { ok: false, version: null };
  }
}

module.exports = {
  name: 'doctor',
  aliases: ['diagnosa'],
  category: 'tools',
  description: 'Cek kesehatan bot, session, dan dependensi',
  descriptionKey: 'commands.doctor.description',
  usage: 'doctor',
  examples: ['doctor'],
  permission: 'owner',
  scope: 'all',
  cooldown: 10,
  maintenanceSafe: true,

  async execute(ctx) {
    const lines = [ctx.t('doctor.title'), ''];

    lines.push(`${ctx.t('doctor.node')}: ${process.version}`);

    const health = ctx.db.health();
    if (health.ok) {
      lines.push(`${ctx.t('doctor.database')}: ${ctx.t('doctor.databaseOk', {
        version: health.schemaVersion,
        size: formatBytes(health.sizeBytes),
      })}`);
    } else {
      lines.push(`${ctx.t('doctor.database')}: ${ctx.t('doctor.databaseError')}`);
    }

    const credsFile = path.join(ctx.config.authDir, 'creds.json');
    lines.push(`${ctx.t('doctor.session')}: ${ctx.t(
      fs.existsSync(credsFile) ? 'doctor.sessionFound' : 'doctor.sessionMissing',
    )}`);

    try {
      const stats = fs.statfsSync(ctx.config.dataDir);
      lines.push(`${ctx.t('doctor.disk')}: ${ctx.t('doctor.diskFree', {
        free: formatBytes(stats.bavail * stats.bsize),
        total: formatBytes(stats.blocks * stats.bsize),
      })}`);
    } catch (error) {
      lines.push(`${ctx.t('doctor.disk')}: ${ctx.t('doctor.diskError', { error: error.message })}`);
    }

    const downloader = ctx.services.downloader;
    const ffmpeg = downloader?.ffmpegStatus
      ? await downloader.ffmpegStatus({ force: true })
      : checkFfmpeg(ctx.config.download?.ffmpegPath || 'ffmpeg');

    lines.push(`${ctx.t('doctor.ffmpeg')}: ${ffmpeg.available
      ? ctx.t('doctor.ffmpegOk', { version: ffmpeg.version })
      : ctx.t('doctor.ffmpegMissing')}`);

    const sharp = checkSharp(ctx.services.media);
    lines.push(`${ctx.t('doctor.sharp')}: ${sharp.ok
      ? sharp.version
      : ctx.t('doctor.sharpMissing')}`);

    let ytdlp = { available: false, version: null };
    if (downloader) ytdlp = await downloader.available({ force: true });
    lines.push(`${ctx.t('doctor.ytdlp')}: ${ytdlp.available
      ? ctx.t('doctor.ytdlpOk', { version: ytdlp.version || 'tersedia' })
      : ctx.t('doctor.ytdlpMissing')}`);

    try {
      const backups = ctx.db.listBackups({ directory: ctx.config.backupsDir });
      lines.push(`${ctx.t('doctor.backups')}: ${backups.length > 0
        ? ctx.t('doctor.backupsOk', { count: backups.length })
        : ctx.t('doctor.backupsEmpty')}`);
    } catch (error) {
      lines.push(`${ctx.t('doctor.backups')}: ${ctx.t('doctor.diskError', { error: error.message })}`);
    }

    try {
      let tmp = null;
      if (downloader?.tmpStats) {
        tmp = downloader.tmpStats();
      } else {
        const files = fs.readdirSync(ctx.config.tmpDir)
          .filter((name) => name.startsWith('varr-'));
        const size = files.reduce((total, name) => {
          try {
            return total + fs.statSync(path.join(ctx.config.tmpDir, name)).size;
          } catch {
            return total;
          }
        }, 0);
        tmp = { count: files.length, sizeBytes: size };
      }

      lines.push(`${ctx.t('doctor.tmp')}: ${ctx.t('doctor.tmpOk', {
        count: tmp.count,
        size: formatBytes(tmp.sizeBytes),
      })}`);
    } catch {
      lines.push(`${ctx.t('doctor.tmp')}: ${ctx.t('doctor.tmpOk', { count: 0, size: '0 B' })}`);
    }

    lines.push(`${ctx.t('doctor.uptime')}: ${formatDuration(ctx.state.uptime())}`);
    lines.push(`${ctx.t('doctor.memory')}: ${formatBytes(process.memoryUsage().rss)}`);

    return lines.join('\n');
  },
};
