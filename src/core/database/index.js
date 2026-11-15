/**
 * Interface database Varr-Bot.
 *
 * Phase 1 hanya menyediakan driver SQLite. Driver MySQL/PostgreSQL akan
 * ditambahkan saat masuk fase multi-session (lihat docs/DECISIONS.md).
 *
 * Kontrak driver:
 *   getSetting, setSetting, deleteSetting
 *   getUser, ensureUser, setPremium, isPremium, incrementUserCommands
 *   getGroup, ensureGroup, setGroupBanned, incrementGroupCommands
 *   getGroupSetting, setGroupSetting, deleteGroupSetting
 *   addWarning, getWarnings, countWarnings, clearWarnings
 *   incrementStat, getStat, audit, listAudit
 *   health, backup, close
 */

const path = require('node:path');
const { AppError } = require('../errors');
const { createSqliteDatabase } = require('./sqlite');

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} [options.logger]
 * @param {string} [options.filename] Dipakai terutama untuk test (`:memory:`).
 */
function createDatabase({ config, logger, filename } = {}) {
  const databaseUrl = String(config?.databaseUrl || '').trim();

  if (databaseUrl && !databaseUrl.startsWith('sqlite:')) {
    throw new AppError(
      'DB_UNSUPPORTED_DRIVER',
      `DATABASE_URL "${databaseUrl.split(':')[0]}://..." belum didukung di Phase 1. Kosongkan untuk memakai SQLite.`,
    );
  }

  let target = filename;

  if (!target && databaseUrl.startsWith('sqlite:')) {
    target = databaseUrl.slice('sqlite:'.length);
  }

  if (!target) {
    if (!config?.dataDir) {
      throw new AppError('DB_MISSING_DATA_DIR', 'DATA_DIR belum dikonfigurasi.');
    }
    target = path.join(config.dataDir, 'varr.db');
  }

  if (target !== ':memory:' && !path.isAbsolute(target)) {
    const base = config?.rootDir || process.cwd();
    target = path.resolve(base, target);
  }

  return createSqliteDatabase({ filename: target, logger });
}

module.exports = {
  createDatabase,
};
