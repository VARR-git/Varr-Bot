/**
 * `.backup [list|verify <nama>]` — buat, daftar, dan verifikasi backup database.
 */

const { formatBytes, formatDateTime } = require('../../utils/format');
const { findBackup, formatCounts } = require('../../utils/backups');

/**
 * @param {object} ctx
 * @param {Array<{name: string, path: string, sizeBytes: number, createdAt: number}>} backups
 * @returns {string}
 */
function renderList(ctx, backups) {
  if (backups.length === 0) {
    return ctx.t('backup.listEmpty', { prefix: ctx.prefix });
  }

  return [
    ctx.t('backup.listHeader', { count: backups.length }),
    ...backups.map((entry) => ctx.t('backup.listItem', {
      name: entry.name,
      size: formatBytes(entry.sizeBytes),
      date: formatDateTime(entry.createdAt),
    })),
  ].join('\n');
}

/**
 * @param {object} ctx
 * @returns {Promise<string>}
 */
async function createBackup(ctx) {
  try {
    const result = await ctx.db.backup({
      directory: ctx.config.backupsDir,
      keep: ctx.config.backupKeep,
      verify: true,
    });

    ctx.db.audit({
      actor: ctx.senderId,
      action: 'backup.create',
      target: result.name,
      meta: { sizeBytes: result.sizeBytes, removed: result.removed },
    });

    return [
      ctx.t('backup.title'),
      ctx.t('backup.created', {
        name: result.name,
        size: formatBytes(result.sizeBytes),
      }),
      ctx.t('backup.verified', { version: result.verification?.schemaVersion ?? '?' }),
    ].join('\n');
  } catch (error) {
    ctx.logger?.error?.({ err: error }, 'Backup manual gagal');
    return ctx.t('backup.failed', { error: error.message });
  }
}

/**
 * @param {object} ctx
 * @param {string} [name]
 * @returns {string}
 */
function verifyBackup(ctx, name) {
  const backups = ctx.db.listBackups({ directory: ctx.config.backupsDir });
  const entry = findBackup(backups, name);

  if (!entry) return ctx.t('backup.notFound', { prefix: ctx.prefix });

  const result = ctx.db.verifyBackup(entry.path);

  if (!result.ok) {
    return `${ctx.t('backup.verifyHeader', { name: entry.name })}\n${ctx.t('backup.verifyFailed', {
      error: result.error || ctx.t('common.unknown'),
    })}`;
  }

  return [
    ctx.t('backup.verifyHeader', { name: entry.name }),
    ctx.t('backup.verifyOk', {
      version: result.schemaVersion,
      size: formatBytes(result.sizeBytes),
      counts: formatCounts(ctx, result.counts),
    }),
  ].join('\n');
}

module.exports = {
  name: 'backup',
  aliases: ['bck'],
  category: 'owner',
  description: 'Buat, daftar, dan verifikasi backup database',
  descriptionKey: 'commands.backup.description',
  usage: 'backup [list|verify <nama>]',
  examples: ['backup', 'backup list', 'backup verify latest'],
  permission: 'owner',
  scope: 'all',
  cooldown: 10,
  maintenanceSafe: true,

  async execute(ctx) {
    const action = String(ctx.args[0] || '').toLowerCase();
    const backups = ctx.db.listBackups({ directory: ctx.config.backupsDir });

    if (!action) return createBackup(ctx);

    if (action === 'list' || action === 'daftar') {
      return renderList(ctx, backups);
    }

    if (action === 'verify' || action === 'cek') {
      return verifyBackup(ctx, ctx.args[1]);
    }

    return ctx.t('backup.usage', { prefix: ctx.prefix });
  },
};
