/**
 * Matematika economy/leveling. Fungsi murni (tanpa I/O) agar mudah diuji.
 *
 * Total XP untuk mencapai level n: 50 * n * (n - 1).
 * Level 2 = 100 XP, level 3 = 300 XP, level 4 = 600 XP, dst.
 */

const XP_PER_LEVEL = 50;
const DAILY_COINS = 500;
const DAILY_XP = 150;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const PASSIVE_XP_MIN = 10;
const PASSIVE_XP_MAX = 20;
const PASSIVE_XP_COOLDOWN_MS = 45 * 1000;

/**
 * @param {number} level
 * @returns {number} total XP kumulatif yang dibutuhkan untuk mencapai level ini
 */
function totalXpForLevel(level) {
  const target = Math.max(1, Math.trunc(Number(level) || 1));
  return XP_PER_LEVEL * target * (target - 1);
}

/**
 * @param {number} xp
 * @returns {number}
 */
function levelFromXp(xp) {
  const value = Math.max(0, Math.trunc(Number(xp) || 0));
  let level = 1;
  while (value >= totalXpForLevel(level + 1)) level += 1;
  return level;
}

/**
 * @param {number} xp
 * @returns {{level: number, current: number, needed: number, percent: number}}
 */
function levelProgress(xp) {
  const value = Math.max(0, Math.trunc(Number(xp) || 0));
  const level = levelFromXp(value);
  const floor = totalXpForLevel(level);
  const next = totalXpForLevel(level + 1);
  const needed = next - floor;
  const current = value - floor;

  return {
    level,
    current,
    needed,
    percent: needed > 0 ? Math.min(100, Math.round((current / needed) * 100)) : 100,
  };
}

/**
 * @param {number} percent
 * @param {number} [size]
 * @returns {string}
 */
function renderBar(percent, size = 10) {
  const segments = Math.max(1, Math.trunc(Number(size) || 10));
  const filled = Math.max(
    0,
    Math.min(segments, Math.round((Math.min(100, Math.max(0, Number(percent) || 0)) / 100) * segments)),
  );
  return '█'.repeat(filled) + '░'.repeat(segments - filled);
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  return Math.trunc(Number(value) || 0).toLocaleString('id-ID');
}

module.exports = {
  XP_PER_LEVEL,
  DAILY_COINS,
  DAILY_XP,
  DAILY_COOLDOWN_MS,
  PASSIVE_XP_MIN,
  PASSIVE_XP_MAX,
  PASSIVE_XP_COOLDOWN_MS,
  totalXpForLevel,
  levelFromXp,
  levelProgress,
  renderBar,
  formatNumber,
};
