/**
 * Formatter kecil untuk output command.
 */

/**
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  const parts = [];
  if (days) parts.push(`${days}h`);
  if (hours) parts.push(`${hours}j`);
  if (minutes) parts.push(`${minutes}m`);
  if (rest || parts.length === 0) parts.push(`${rest}d`);

  return parts.join(' ');
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value) || 0);
}

/**
 * @param {number|string|Date} value Detik Unix, milidetik, string tanggal, atau Date.
 * @param {{dateOnly?: boolean}} [options]
 * @returns {string}
 */
function formatDateTime(value, { dateOnly = false } = {}) {
  let date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    date = new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric);
  } else {
    date = new Date(String(value));
  }

  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('id-ID', dateOnly
    ? { day: '2-digit', month: 'short', year: 'numeric' }
    : {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
}

module.exports = {
  formatDuration,
  formatBytes,
  formatNumber,
  formatDateTime,
};
