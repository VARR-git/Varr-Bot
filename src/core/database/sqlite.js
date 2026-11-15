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
];

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
  return { ...row, is_premium: Boolean(row.is_premium) };
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
    incrementUserCommands: db.prepare(`
      UPDATE users SET command_count = command_count + 1, updated_at = ? WHERE jid = ?
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
      UPDATE groups SET is_banned = ?, updated_at = ? WHERE jid = ?
    `),
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

    audit: db.prepare(`
      INSERT INTO audit_logs (actor_jid, action, target, meta, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    listAudit: db.prepare(`
      SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?
    `),
  };

  let closed = false;

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

    incrementUserCommands(jid) {
      return statements.incrementUserCommands.run(now(), requireJid(jid)).changes > 0;
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

    setGroupBanned(jid, banned) {
      const id = requireJid(jid);
      database.ensureGroup(id);
      statements.setGroupBanned.run(banned ? 1 : 0, now(), id);
      return database.getGroup(id);
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
     * @param {{directory?: string, keep?: number, prefix?: string}} [options]
     */
    async backup({ directory, keep = 14, prefix = 'varr' } = {}) {
      if (isMemory) {
        throw new AppError('DB_BACKUP_MEMORY', 'Database in-memory tidak bisa dibackup.');
      }

      const targetDir = directory || path.join(path.dirname(filename), 'backups');
      fs.mkdirSync(targetDir, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const destination = path.join(targetDir, `${prefix}-${stamp}.db`);

      await db.backup(destination);

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
      return { path: destination, sizeBytes, removed };
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
  createSqliteDatabase,
};
