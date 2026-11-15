/**
 * Helper command backup/restore.
 */

const TABLE_ORDER = [
  'users',
  'groups',
  'group_settings',
  'warnings',
  'stats',
  'settings',
  'audit_logs',
];

/**
 * @param {object} ctx
 * @param {Record<string, number>} counts
 * @returns {string}
 */
function formatCounts(ctx, counts = {}) {
  const lines = TABLE_ORDER
    .filter((table) => Number(counts[table]) > 0)
    .map((table) => ctx.t('backup.tableRow', {
      table,
      count: counts[table],
    }));

  return lines.length > 0 ? lines.join('\n') : ctx.t('common.none');
}

/**
 * Cari backup berdasarkan nama, atau ambil yang terbaru untuk `latest`.
 *
 * @param {Array<{name: string, path: string}>} backups
 * @param {string} [name]
 * @returns {{name: string, path: string}|null}
 */
function findBackup(backups, name) {
  if (!Array.isArray(backups) || backups.length === 0) return null;

  const keyword = String(name || '').trim();
  if (!keyword) return backups[0];

  if (keyword === 'latest' || keyword === 'terbaru') return backups[0];
  return backups.find((entry) => entry.name === keyword) || null;
}

module.exports = {
  TABLE_ORDER,
  findBackup,
  formatCounts,
};
