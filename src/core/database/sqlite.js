/**
 * Driver SQLite untuk Varr-Bot.
 *
 * Semua query disiapkan sekali (prepared statement) agar aman dari SQL injection
 * dan cepat. Nilai kompleks disimpan sebagai JSON di kolom TEXT.
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { AppError } = require('../errors');
const { levelFromXp } = require('../../utils/economy');

const MIGRATIONS = [
  {
    name: 'initial-schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
          jid           TEXT PRIMARY KEY,
          lid           TEXT,
          name          TEXT,
          is_premium    INTEGER NOT NULL DEFAULT 0,
          premium_until INTEGER,
          command_count INTEGER NOT NULL DEFAULT 0,
          last_seen_at  INTEGER,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS groups (
          jid           TEXT PRIMARY KEY,
          name          TEXT,
          is_banned     INTEGER NOT NULL DEFAULT 0,
          command_count INTEGER NOT NULL DEFAULT 0,
          last_seen_at  INTEGER,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_settings (
          group_jid  TEXT NOT NULL,
          key        TEXT NOT NULL,
          value      TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (group_jid, key),
          FOREIGN KEY (group_jid) REFERENCES groups(jid) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS warnings (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          group_jid  TEXT NOT NULL,
          user_jid   TEXT NOT NULL,
          reason     TEXT,
          warned_by  TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_warnings_group_user
          ON warnings (group_jid, user_jid);

        CREATE TABLE IF NOT EXISTS stats (
          key        TEXT PRIMARY KEY,
          value      INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_jid  TEXT,
          action     TEXT NOT NULL,
          target     TEXT,
          meta       TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_audit_logs_created
          ON audit_logs (created_at DESC);
      `);
    },
  },
  {
    name: 'ban-control',
    up(db) {
      db.exec(`
        ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN ban_reason TEXT;
        ALTER TABLE users ADD COLUMN banned_at INTEGER;
        ALTER TABLE groups ADD COLUMN ban_reason TEXT;
        ALTER TABLE groups ADD COLUMN banned_at INTEGER;

        CREATE INDEX IF NOT EXISTS idx_users_banned ON users (is_banned);
        CREATE INDEX IF NOT EXISTS idx_groups_banned ON groups (is_banned);
        CREATE INDEX IF NOT EXISTS idx_stats_value ON stats (value DESC);
      `);
    },
  },
  {
    name: 'economy',
    up(db) {
      db.exec(`
        ALTER TABLE users ADD COLUMN balance INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE users ADD COLUMN last_daily INTEGER;
        ALTER TABLE users ADD COLUMN last_xp_at INTEGER;

        CREATE INDEX IF NOT EXISTS idx_users_balance ON users (balance DESC);
        CREATE INDEX IF NOT EXISTS idx_users_level ON users (level DESC, xp DESC);
      `);
    },
  },
];

/**
 * Tabel yang isinya ikut dipulihkan saat `restoreBackup`. `migrations` sengaja
 * tidak ikut: skema database aktif tidak boleh diturunkan oleh file backup.
 */
const RESTORE_TABLES = Object.freeze([
  'settings',
  'users',
  'groups',
  'group_settings',
  'warnings',
  'stats',
  'audit_logs',
]);

const DELETE_ORDER = Object.freeze([
  'group_settings',
  'warnings',
  'audit_logs',
  'stats',
  'users',
  'groups',
  'settings',
]);

const BACKUP_NAME_PATTERN = /^[A-Za-z0-9._-]+\.db$/;

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} [logger]
 */
function migrate(db, logger) {
  const current = Number(db.pragma('user_version', { simple: true })) || 0;

  if (current > MIGRATIONS.length) {
    throw new AppError(
      'DB_SCHEMA_TOO_NEW',
      `Database memakai skema versi ${current}, sedangkan kode hanya mendukung ${MIGRATIONS.length}.`,
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const migration = MIGRATIONS[version];
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT OR REPLACE INTO migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(version + 1, migration.name, Date.now());
      db.pragma(`user_version = ${version + 1}`);
    });

    apply();
    logger?.info?.({ version: version + 1, name: migration.name }, 'Migrasi database diterapkan');
  }
}

/**
 * @param {object} row
 * @returns {object|null}
 */
function mapUser(row) {
  if (!row) return null;
  return {
    ...row,
    is_premium: Boolean(row.is_premium),
    is_banned: Boolean(row.is_banned),
  };
}

/**
 * @param {object} row
 * @returns {object|null}
 */
function mapGroup(row) {
  if (!row) return null;
  return { ...row, is_banned: Boolean(row.is_banned) };
}

/**
 * @param {string} value
 * @returns {string}
 */
function requireJid(value) {
  const jid = String(value || '').trim();
  if (!jid) {
    throw new AppError('DB_INVALID_JID', 'JID tidak boleh kosong.');
  }
  return jid;
}

/**
 * @param {object} options
 * @param {string} options.filename
 * @param {object} [options.logger]
 * @param {() => number} [options.now]
 */
function createSqliteDatabase({ filename = ':memory:', logger, now = Date.now } = {}) {
  const isMemory = filename === ':memory:';

  if (!isMemory) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (!isMemory) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  migrate(db, logger);

  const statements = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
    deleteSetting: db.prepare('DELETE FROM settings WHERE key = ?'),

    getUser: db.prepare('SELECT * FROM users WHERE jid = ?'),
    upsertUser: db.prepare(`
      INSERT INTO users (jid, lid, name, created_at, updated_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        lid          = COALESCE(excluded.lid, users.lid),
        name         = COALESCE(excluded.name, users.name),
        last_seen_at = excluded.last_seen_at,
        updated_at   = excluded.updated_at
    `),
    setPremium: db.prepare(`
      UPDATE users SET is_premium = ?, premium_until = ?, updated_at = ? WHERE jid = ?
    `),
    premiumCheck: db.prepare(`
      SELECT 1 AS ok FROM users
      WHERE jid = ? AND is_premium = 1
        AND (premium_until IS NULL OR premium_until > ?)
    `),
    setUserBanned: db.prepare(`
      UPDATE users
      SET is_banned = ?, ban_reason = ?, banned_at = ?, updated_at = ?
      WHERE jid = ?
    `),
    userBanned: db.prepare('SELECT is_banned FROM users WHERE jid = ?'),
    incrementUserCommands: db.prepare(`
      UPDATE users SET command_count = command_count + 1, updated_at = ? WHERE jid = ?
    `),

    addBalance: db.prepare(`
      UPDATE users SET balance = balance + ?, updated_at = ? WHERE jid = ?
    `),
    addXp: db.prepare(`
      UPDATE users SET xp = xp + ?, level = ?, updated_at = ? WHERE jid = ?
    `),
    claimDaily: db.prepare(`
      UPDATE users
      SET balance = balance + ?, xp = ?, level = ?, last_daily = ?, updated_at = ?
      WHERE jid = ?
    `),
    setPassiveXp: db.prepare(`
      UPDATE users
      SET xp = ?, level = ?, last_xp_at = ?, updated_at = ?
      WHERE jid = ?
    `),
    topByBalance: db.prepare(`
      SELECT jid, name, balance, xp, level FROM users
      ORDER BY balance DESC, xp DESC, jid ASC LIMIT ?
    `),
    topByLevel: db.prepare(`
      SELECT jid, name, balance, xp, level FROM users
      ORDER BY level DESC, xp DESC, balance DESC, jid ASC LIMIT ?
    `),
    rankByBalance: db.prepare(`
      SELECT COUNT(*) + 1 AS rank FROM users WHERE balance > ?
    `),
    rankByLevel: db.prepare(`
      SELECT COUNT(*) + 1 AS rank FROM users WHERE level > ? OR (level = ? AND xp > ?)
    `),

    getGroup: db.prepare('SELECT * FROM groups WHERE jid = ?'),
    upsertGroup: db.prepare(`
      INSERT INTO groups (jid, name, created_at, updated_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name         = COALESCE(excluded.name, groups.name),
        last_seen_at = excluded.last_seen_at,
        updated_at   = excluded.updated_at
    `),
    setGroupBanned: db.prepare(`
      UPDATE groups
      SET is_banned = ?, ban_reason = ?, banned_at = ?, updated_at = ?
      WHERE jid = ?
    `),
    groupBanned: db.prepare('SELECT is_banned FROM groups WHERE jid = ?'),
    incrementGroupCommands: db.prepare(`
      UPDATE groups SET command_count = command_count + 1, updated_at = ? WHERE jid = ?
    `),
    getGroupSetting: db.prepare('SELECT value FROM group_settings WHERE group_jid = ? AND key = ?'),
    setGroupSetting: db.prepare(`
      INSERT INTO group_settings (group_jid, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(group_jid, key) DO UPDATE SET
        value = excluded.value, updated_at = excluded.updated_at
    `),
    deleteGroupSetting: db.prepare('DELETE FROM group_settings WHERE group_jid = ? AND key = ?'),

    addWarning: db.prepare(`
      INSERT INTO warnings (group_jid, user_jid, reason, warned_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    getWarnings: db.prepare(`
      SELECT * FROM warnings WHERE group_jid = ? AND user_jid = ? ORDER BY id ASC
    `),
    countWarnings: db.prepare(`
      SELECT COUNT(*) AS total FROM warnings WHERE group_jid = ? AND user_jid = ?
    `),
    clearWarnings: db.prepare('DELETE FROM warnings WHERE group_jid = ? AND user_jid = ?'),

    incrementStat: db.prepare(`
      INSERT INTO stats (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = value + excluded.value, updated_at = excluded.updated_at
    `),
    getStat: db.prepare('SELECT value FROM stats WHERE key = ?'),
    topStats: db.prepare(`
      SELECT key, value FROM stats
      WHERE key LIKE ?
      ORDER BY value DESC, key ASC
      LIMIT ?
    `),
    countUsers: db.prepare('SELECT COUNT(*) AS total FROM users'),
    countGroups: db.prepare('SELECT COUNT(*) AS total FROM groups'),
    countAllWarnings: db.prepare('SELECT COUNT(*) AS total FROM warnings'),
    countBannedUsers: db.prepare('SELECT COUNT(*) AS total FROM users WHERE is_banned = 1'),

    audit: db.prepare(`
      INSERT INTO audit_logs (actor_jid, action, target, meta, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    listAudit: db.prepare(`
      SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?
    `),
  };

  let closed = false;

  /**
   * @returns {number}
   */
  function schemaVersionOf(target = db) {
    return Number(target.pragma('user_version', { simple: true })) || 0;
  }

  /**
   * @param {string} [directory]
   * @returns {string}
   */
  function resolveBackupDirectory(directory) {
    return directory || path.join(path.dirname(filename), 'backups');
  }

  /**
   * @param {{directory?: string, prefix?: string}} [options]
   * @returns {Array<{name: string, path: string, sizeBytes: number, createdAt: number}>}
   */
  function listBackups({ directory, prefix = 'varr' } = {}) {
    const targetDir = resolveBackupDirectory(directory);

    let entries = [];
    try {
      entries = fs.readdirSync(targetDir);
    } catch {
      return [];
    }

    return entries
      .filter((name) => BACKUP_NAME_PATTERN.test(name) && name.startsWith(`${prefix}-`))
      .map((name) => {
        const fullPath = path.join(targetDir, name);
        try {
          const stat = fs.statSync(fullPath);
          return { name, path: fullPath, sizeBytes: stat.size, createdAt: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Verifikasi file backup dengan koneksi read-only: integritas, foreign key,
   * versi skema, dan jumlah baris tiap tabel.
   *
   * @param {string} filePath
   * @returns {object}
   */
  function verifyBackup(filePath) {
    const target = String(filePath || '');
    const name = path.basename(target);

    if (!target) return { ok: false, error: 'Path backup kosong.', name, counts: {} };

    let probe = null;
    try {
      const sizeBytes = fs.statSync(target).size;
      probe = new Database(target, { readonly: true, fileMustExist: true });

      const integrity = probe.pragma('integrity_check')
        .map((row) => String(Object.values(row)[0]));
      const foreignKeys = probe.pragma('foreign_key_check');
      const schemaVersion = schemaVersionOf(probe);

      const counts = {};
      for (const table of RESTORE_TABLES) {
        try {
          counts[table] = Number(
            probe.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get()?.total,
          ) || 0;
        } catch {
          counts[table] = 0;
        }
      }

      const ok = sizeBytes > 0
        && integrity.length > 0
        && integrity.every((value) => value === 'ok')
        && foreignKeys.length === 0;

      return {
        ok,
        error: ok ? null : 'Integritas atau foreign key backup bermasalah.',
        path: target,
        name,
        sizeBytes,
        schemaVersion,
        integrity,
        foreignKeyErrors: foreignKeys.length,
        counts,
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        path: target,
        name,
        sizeBytes: 0,
        schemaVersion: 0,
        counts: {},
      };
    } finally {
      try {
        probe?.close();
      } catch {
        // Koneksi probe sudah tertutup.
      }
    }
  }

  /**
   * Pulihkan isi tabel dari file backup ke database aktif.
   *
   * Data disalin lewat `ATTACH DATABASE` di dalam satu transaksi, sehingga
   * tidak perlu restart dan tidak ada momen database setengah pulih.
   *
   * @param {string} filePath
   * @param {{verify?: boolean}} [options]
   * @returns {{name: string, path: string, schemaVersion: number, counts: Record<string, number>}}
   */
  function restoreBackup(filePath, { verify = true } = {}) {
    if (isMemory) {
      throw new AppError('DB_RESTORE_MEMORY', 'Database in-memory tidak bisa direstore.');
    }

    const target = String(filePath || '');
    if (!target) {
      throw new AppError('DB_RESTORE_NO_FILE', 'File backup tidak diberikan.');
    }
    if (!fs.existsSync(target)) {
      throw new AppError('DB_RESTORE_NOT_FOUND', `Backup tidak ditemukan: ${path.basename(target)}.`);
    }

    if (verify) {
      const result = verifyBackup(target);
      if (!result.ok) {
        throw new AppError('DB_RESTORE_INVALID', `Backup tidak valid: ${result.error}`);
      }

      const current = schemaVersionOf();
      if (result.schemaVersion !== current) {
        throw new AppError(
          'DB_RESTORE_SCHEMA',
          `Skema backup v${result.schemaVersion} tidak cocok dengan database v${current}.`,
        );
      }
    }

    let attached = false;
    try {
      db.prepare('ATTACH DATABASE ? AS restore_src').run(target);
      attached = true;

      // Cek ulang lewat koneksi yang benar-benar akan menyalin data.
      const backupVersion = Number(db.pragma('restore_src.user_version', { simple: true })) || 0;
      const currentVersion = schemaVersionOf();
      if (backupVersion !== currentVersion) {
        throw new AppError(
          'DB_RESTORE_SCHEMA',
          `Skema backup v${backupVersion} tidak cocok dengan database v${currentVersion}.`,
        );
      }

      const apply = db.transaction(() => {
        for (const table of DELETE_ORDER) {
          db.prepare(`DELETE FROM "${table}"`).run();
        }
        for (const table of RESTORE_TABLES) {
          db.prepare(`INSERT INTO "${table}" SELECT * FROM restore_src."${table}"`).run();
        }
      });
      apply();
    } catch (error) {
      throw error instanceof AppError
        ? error
        : new AppError('DB_RESTORE_FAILED', `Restore gagal: ${error.message}`);
    } finally {
      if (attached) {
        try {
          db.prepare('DETACH DATABASE restore_src').run();
        } catch {
          // Abaikan: transaksi sudah selesai/dibatalkan.
        }
      }
    }

    const counts = {};
    for (const table of RESTORE_TABLES) {
      counts[table] = Number(db.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get()?.total) || 0;
    }

    return {
      name: path.basename(target),
      path: target,
      schemaVersion: schemaVersionOf(),
      counts,
    };
  }

  const database = {
    driver: 'sqlite',
    filename,
    isMemory,
    raw: db,

    getSetting(key, fallback = null) {
      const row = statements.getSetting.get(String(key));
      if (!row) return fallback;
      try {
        return JSON.parse(row.value);
      } catch {
        return row.value;
      }
    },

    setSetting(key, value) {
      statements.setSetting.run(String(key), JSON.stringify(value), now());
      return value;
    },

    deleteSetting(key) {
      return statements.deleteSetting.run(String(key)).changes > 0;
    },

    getUser(jid) {
      return mapUser(statements.getUser.get(requireJid(jid)));
    },

    ensureUser(jid, { name = null, lid = null } = {}) {
      const id = requireJid(jid);
      const timestamp = now();
      statements.upsertUser.run(id, lid, name, timestamp, timestamp, timestamp);
      return database.getUser(id);
    },

    setPremium(jid, enabled, until = null) {
      const id = requireJid(jid);
      database.ensureUser(id);
      statements.setPremium.run(enabled ? 1 : 0, until, now(), id);
      return database.getUser(id);
    },

    isPremium(jid, at = now()) {
      if (!jid) return false;
      return Boolean(statements.premiumCheck.get(String(jid), at));
    },

    setUserBanned(jid, banned, { reason = null } = {}) {
      const id = requireJid(jid);
      database.ensureUser(id);
      statements.setUserBanned.run(
        banned ? 1 : 0,
        banned ? reason : null,
        banned ? now() : null,
        now(),
        id,
      );
      return database.getUser(id);
    },

    isUserBanned(jid) {
      if (!jid) return false;
      return Boolean(statements.userBanned.get(String(jid))?.is_banned);
    },

    incrementUserCommands(jid) {
      return statements.incrementUserCommands.run(now(), requireJid(jid)).changes > 0;
    },

    addBalance(jid, amount) {
      const id = requireJid(jid);
      const delta = Math.trunc(Number(amount));
      if (!Number.isFinite(delta) || delta === 0) return database.getUser(id);
      database.ensureUser(id);
      statements.addBalance.run(delta, now(), id);
      return database.getUser(id);
    },

    addXp(jid, amount) {
      const id = requireJid(jid);
      const user = database.ensureUser(id);
      const delta = Math.max(0, Math.trunc(Number(amount)) || 0);
      const fromLevel = Number(user.level) || 1;

      if (delta === 0) {
        return { user, gained: 0, fromLevel, toLevel: fromLevel, leveledUp: false };
      }

      const xp = (Number(user.xp) || 0) + delta;
      const toLevel = Math.max(fromLevel, levelFromXp(xp));
      statements.addXp.run(delta, toLevel, now(), id);

      return {
        user: database.getUser(id),
        gained: delta,
        fromLevel,
        toLevel,
        leveledUp: toLevel > fromLevel,
      };
    },

    claimDaily(jid, { coins = 0, xp = 0, cooldownMs = 24 * 60 * 60 * 1000 } = {}) {
      const id = requireJid(jid);
      const user = database.ensureUser(id);
      const last = Number(user.last_daily) || 0;
      const elapsed = now() - last;

      if (last > 0 && elapsed < cooldownMs) {
        return {
          ok: false,
          remainingMs: cooldownMs - elapsed,
          user,
          fromLevel: Number(user.level) || 1,
          toLevel: Number(user.level) || 1,
          leveledUp: false,
        };
      }

      const coinAmount = Math.max(0, Math.trunc(Number(coins)) || 0);
      const xpAmount = Math.max(0, Math.trunc(Number(xp)) || 0);
      const fromLevel = Number(user.level) || 1;
      const newXp = (Number(user.xp) || 0) + xpAmount;
      const toLevel = Math.max(fromLevel, levelFromXp(newXp));

      statements.claimDaily.run(coinAmount, newXp, toLevel, now(), now(), id);

      return {
        ok: true,
        coins: coinAmount,
        xp: xpAmount,
        remainingMs: cooldownMs,
        user: database.getUser(id),
        fromLevel,
        toLevel,
        leveledUp: toLevel > fromLevel,
      };
    },

    grantPassiveXp(jid, {
      min = 10,
      max = 20,
      cooldownMs = 45_000,
      random = Math.random,
    } = {}) {
      const id = requireJid(jid);
      const user = database.ensureUser(id);
      const elapsed = now() - (Number(user.last_xp_at) || 0);

      if (elapsed < cooldownMs) {
        return { granted: false, remainingMs: cooldownMs - elapsed, user, amount: 0 };
      }

      const low = Math.max(1, Math.trunc(Number(min)) || 1);
      const high = Math.max(low, Math.trunc(Number(max)) || low);
      const roll = Math.min(0.999999, Math.max(0, Number(random()) || 0));
      const amount = low + Math.floor(roll * (high - low + 1));

      const fromLevel = Number(user.level) || 1;
      const newXp = (Number(user.xp) || 0) + amount;
      const toLevel = Math.max(fromLevel, levelFromXp(newXp));
      statements.setPassiveXp.run(newXp, toLevel, now(), now(), id);

      return {
        granted: true,
        amount,
        remainingMs: cooldownMs,
        user: database.getUser(id),
        fromLevel,
        toLevel,
        leveledUp: toLevel > fromLevel,
      };
    },

    getLeaderboard({ by = 'balance', limit = 10 } = {}) {
      const size = Math.max(1, Math.min(50, Math.trunc(Number(limit)) || 10));
      const statement = by === 'level' ? statements.topByLevel : statements.topByBalance;

      return statement.all(size).map((row) => ({
        jid: row.jid,
        name: row.name,
        balance: Number(row.balance) || 0,
        xp: Number(row.xp) || 0,
        level: Number(row.level) || 1,
      }));
    },

    getRank(jid, by = 'balance') {
      const user = database.getUser(requireJid(jid));
      if (!user) return 0;

      const row = by === 'level'
        ? statements.rankByLevel.get(user.level, user.level, user.xp)
        : statements.rankByBalance.get(user.balance);

      return Number(row?.rank) || 0;
    },

    getGroup(jid) {
      return mapGroup(statements.getGroup.get(requireJid(jid)));
    },

    ensureGroup(jid, { name = null } = {}) {
      const id = requireJid(jid);
      const timestamp = now();
      statements.upsertGroup.run(id, name, timestamp, timestamp, timestamp);
      return database.getGroup(id);
    },

    setGroupBanned(jid, banned, { reason = null } = {}) {
      const id = requireJid(jid);
      database.ensureGroup(id);
      statements.setGroupBanned.run(
        banned ? 1 : 0,
        banned ? reason : null,
        banned ? now() : null,
        now(),
        id,
      );
      return database.getGroup(id);
    },

    isGroupBanned(jid) {
      if (!jid) return false;
      return Boolean(statements.groupBanned.get(String(jid))?.is_banned);
    },

    incrementGroupCommands(jid) {
      return statements.incrementGroupCommands.run(now(), requireJid(jid)).changes > 0;
    },

    getGroupSetting(groupJid, key, fallback = null) {
      const row = statements.getGroupSetting.get(requireJid(groupJid), String(key));
      if (!row) return fallback;
      try {
        return JSON.parse(row.value);
      } catch {
        return row.value;
      }
    },

    setGroupSetting(groupJid, key, value) {
      const id = requireJid(groupJid);
      database.ensureGroup(id);
      statements.setGroupSetting.run(id, String(key), JSON.stringify(value), now());
      return value;
    },

    deleteGroupSetting(groupJid, key) {
      return statements.deleteGroupSetting.run(requireJid(groupJid), String(key)).changes > 0;
    },

    addWarning(groupJid, userJid, { reason = null, warnedBy = null } = {}) {
      const result = statements.addWarning.run(
        requireJid(groupJid),
        requireJid(userJid),
        reason,
        warnedBy,
        now(),
      );
      return Number(result.lastInsertRowid);
    },

    getWarnings(groupJid, userJid) {
      return statements.getWarnings.all(requireJid(groupJid), requireJid(userJid));
    },

    countWarnings(groupJid, userJid) {
      const row = statements.countWarnings.get(requireJid(groupJid), requireJid(userJid));
      return Number(row?.total) || 0;
    },

    clearWarnings(groupJid, userJid) {
      return statements.clearWarnings.run(requireJid(groupJid), requireJid(userJid)).changes;
    },

    incrementStat(key, by = 1) {
      const amount = Math.trunc(Number(by));
      if (!Number.isFinite(amount) || amount === 0) return 0;
      statements.incrementStat.run(String(key), amount, now());
      return database.getStat(key);
    },

    getStat(key, fallback = 0) {
      const row = statements.getStat.get(String(key));
      return row ? Number(row.value) : fallback;
    },

    audit({ actor = null, action, target = null, meta = null } = {}) {
      if (!action) {
        throw new AppError('DB_INVALID_AUDIT', 'Action audit wajib diisi.');
      }
      const result = statements.audit.run(
        actor,
        String(action),
        target,
        meta === null ? null : JSON.stringify(meta),
        now(),
      );
      return Number(result.lastInsertRowid);
    },

    listAudit(limit = 50) {
      return statements.listAudit.all(Math.max(1, Math.min(1000, Math.trunc(limit) || 50)));
    },

    health() {
      let ok = false;
      try {
        ok = db.prepare('SELECT 1 AS ok').get()?.ok === 1;
      } catch (error) {
        logger?.error?.({ error: error.message }, 'Health check database gagal');
      }

      let sizeBytes = 0;
      if (!isMemory) {
        try {
          sizeBytes = fs.statSync(filename).size;
        } catch {
          sizeBytes = 0;
        }
      }

      return {
        driver: 'sqlite',
        ok,
        memory: isMemory,
        sizeBytes,
        schemaVersion: Number(db.pragma('user_version', { simple: true })) || 0,
      };
    },

    /**
     * Backup konsisten memakai API online backup dari SQLite.
     *
     * @param {{directory?: string, keep?: number, prefix?: string, verify?: boolean}} [options]
     * @returns {Promise<{name: string, path: string, sizeBytes: number, removed: number, verification: object|null}>}
     */
    async backup({ directory, keep = 14, prefix = 'varr', verify = false } = {}) {
      if (isMemory) {
        throw new AppError('DB_BACKUP_MEMORY', 'Database in-memory tidak bisa dibackup.');
      }

      const targetDir = resolveBackupDirectory(directory);
      fs.mkdirSync(targetDir, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
      let destination = path.join(targetDir, `${prefix}-${stamp}.db`);

      // Nama backup memakai timestamp sampai milidetik; penjaga ini menangani
      // kemungkinan dua backup dibuat pada milidetik yang sama.
      let suffix = 1;
      while (fs.existsSync(destination) && suffix < 100) {
        destination = path.join(targetDir, `${prefix}-${stamp}-${suffix}.db`);
        suffix += 1;
      }

      await db.backup(destination);

      let verification = null;
      if (verify) {
        verification = verifyBackup(destination);
        if (!verification.ok) {
          fs.rmSync(destination, { force: true });
          throw new AppError(
            'DB_BACKUP_INVALID',
            `Backup yang baru dibuat gagal diverifikasi: ${verification.error}`,
          );
        }
      }

      let removed = 0;
      const retention = Math.max(1, Math.trunc(keep) || 14);
      try {
        const files = fs.readdirSync(targetDir)
          .filter((file) => file.startsWith(`${prefix}-`) && file.endsWith('.db'))
          .sort();

        while (files.length > retention) {
          const oldest = files.shift();
          fs.rmSync(path.join(targetDir, oldest), { force: true });
          removed += 1;
        }
      } catch (error) {
        logger?.warn?.({ error: error.message }, 'Gagal membersihkan backup lama');
      }

      const sizeBytes = fs.statSync(destination).size;
      return {
        name: path.basename(destination),
        path: destination,
        sizeBytes,
        removed,
        verification,
      };
    },

    listBackups(options) {
      return listBackups(options);
    },

    verifyBackup(filePath) {
      return verifyBackup(filePath);
    },

    restoreBackup(filePath, options) {
      return restoreBackup(filePath, options);
    },

    countUsers() {
      return Number(statements.countUsers.get()?.total) || 0;
    },

    countGroups() {
      return Number(statements.countGroups.get()?.total) || 0;
    },

    countAllWarnings() {
      return Number(statements.countAllWarnings.get()?.total) || 0;
    },

    countBannedUsers() {
      return Number(statements.countBannedUsers.get()?.total) || 0;
    },

    /**
     * @param {{prefix?: string, limit?: number}} [options]
     * @returns {Array<{key: string, value: number}>}
     */
    topStats({ prefix = 'command:', limit = 5 } = {}) {
      const size = Math.max(1, Math.min(100, Math.trunc(limit) || 5));
      return statements.topStats.all(`${prefix}%`, size)
        .map((row) => ({ key: row.key, value: Number(row.value) }));
    },

    close() {
      if (closed) return;
      closed = true;
      db.close();
    },

    get isOpen() {
      return !closed && db.open;
    },
  };

  logger?.debug?.({ filename, isMemory }, 'Database SQLite siap');
  return database;
}

module.exports = {
  MIGRATIONS,
  RESTORE_TABLES,
  createSqliteDatabase,
};
