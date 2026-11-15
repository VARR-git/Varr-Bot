/**
 * `.restore <nama|latest> confirm` — pulihkan database dari file backup.
 *
 * Sebelum memulihkan, command ini selalu membuat backup pengaman agar data
 * yang sedang aktif bisa dikembalikan bila hasil restore tidak sesuai.
 */

const { formatBytes, formatDateTime } = require('../../utils/format');
const { findBackup, formatCounts } = require('../../utils/backups');

const CONFIRM_WORDS = new Set(['confirm', 'konfirmasi', 'yes', 'ya']);

module.exports = {
  name: 'restore',
  aliases: ['pulihkan'],
  category: 'owner',
  description: 'Pulihkan database dari file backup',
  descriptionKey: 'commands.restore.description',
  usage: 'restore <nama|latest> confirm',
  examples: ['restore latest confirm', 'restore varr-2026-11-15_10-00-00.db confirm'],
  permission: 'owner',
  scope: 'all',
  cooldown: 10,
  maintenanceSafe: true,

  async execute(ctx) {
    const backups = ctx.db.listBackups({ directory: ctx.config.backupsDir });

    if (backups.length === 0) {
      return ctx.t('backup.listEmpty', { prefix: ctx.prefix });
    }

    const requested = ctx.args[0];

    if (!requested) {
      return [
        ctx.t('backup.restoreUsage', { prefix: ctx.prefix }),
        '',
        ctx.t('backup.listHeader', { count: backups.length }),
        ...backups.map((entry) => ctx.t('backup.listItem', {
          name: entry.name,
          size: formatBytes(entry.sizeBytes),
          date: formatDateTime(entry.createdAt),
        })),
      ].join('\n');
    }

    const entry = findBackup(backups, requested);
    if (!entry) {
      return ctx.t('backup.notFound', { prefix: ctx.prefix });
    }

    const confirmed = CONFIRM_WORDS.has(String(ctx.args[1] || '').toLowerCase());
    if (!confirmed) {
      return ctx.t('backup.restoreConfirm');
    }

    let safety = null;
    try {
      safety = await ctx.db.backup({
        directory: ctx.config.backupsDir,
        keep: ctx.config.backupKeep,
        verify: true,
      });
    } catch (error) {
      ctx.logger?.error?.({ err: error }, 'Backup pengaman sebelum restore gagal');
      return ctx.t('backup.failed', { error: error.message });
    }

    let result;
    try {
      result = ctx.db.restoreBackup(entry.path);
    } catch (error) {
      ctx.logger?.error?.({ err: error, backup: entry.name }, 'Restore database gagal');
      return ctx.t('backup.restoreFailed', { error: error.message });
    }

    ctx.db.audit({
      actor: ctx.senderId,
      action: 'backup.restore',
      target: result.name,
      meta: { safety: safety?.name || null, counts: result.counts },
    });

    ctx.logger?.info?.(
      { backup: result.name, safety: safety?.name || null, actor: ctx.senderId },
      'Database dipulihkan dari backup',
    );

    return [
      ctx.t('backup.title'),
      ctx.t('backup.safetyBackup', { name: safety?.name || '-' }),
      ctx.t('backup.restored', {
        name: result.name,
        counts: formatCounts(ctx, result.counts),
      }),
    ].join('\n');
  },
};
