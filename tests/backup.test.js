const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OWNER, createTestBot, lastText, makeMessage, MEMBER } = require('./helpers/bot');
const { createSqliteDatabase, RESTORE_TABLES } = require('../src/core/database/sqlite');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'varr-backup-'));
}

/**
 * Siapkan direktori sementara + database file. Cleanup berjalan setelah DB
 * ditutup (urutan hook mengikuti urutan registrasi).
 */
function setup(t, { memory = false } = {}) {
  const dir = tempDir();
  const filename = memory ? ':memory:' : path.join(dir, 'varr.db');
  const db = createSqliteDatabase({ filename });

  t.after(() => db.close());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  return { dir, db, filename };
}

test('backup: membuat backup terverifikasi dan mendaftarnya', async (t) => {
  const { dir, db } = setup(t);

  db.setSetting('mode', 'private');
  db.ensureUser('628111111111@s.whatsapp.net', { name: 'Uji' });
  db.ensureGroup('120363@g.us', { name: 'Grup' });
  db.addWarning('120363@g.us', '628111111111@s.whatsapp.net', { reason: 'spam' });
  db.incrementStat('command:ping', 3);

  const backupsDir = path.join(dir, 'backups');
  const result = await db.backup({ directory: backupsDir, keep: 5, verify: true });

  assert.match(result.name, /^varr-.+\.db$/);
  assert.ok(fs.existsSync(result.path));
  assert.ok(result.sizeBytes > 0);
  assert.equal(result.verification.ok, true);
  assert.equal(result.verification.schemaVersion, 3);
  assert.equal(result.verification.counts.users, 1);
  assert.equal(result.verification.counts.groups, 1);
  assert.equal(result.verification.counts.warnings, 1);

  const list = db.listBackups({ directory: backupsDir });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, result.name);
  assert.ok(list[0].createdAt > 0);
});

test('backup: file rusak ditolak verifikasi', async (t) => {
  const { dir, db } = setup(t);

  const corrupted = path.join(dir, 'varr-rusak.db');
  fs.writeFileSync(corrupted, 'bukan file sqlite');

  const result = db.verifyBackup(corrupted);
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(result.name, 'varr-rusak.db');
});

test('backup: restore mengembalikan isi tabel dan menghapus data sesudah backup', async (t) => {
  const { dir, db } = setup(t);

  db.setSetting('mode', 'private');
  db.ensureUser('628111111111@s.whatsapp.net', { name: 'Lama' });

  const backupsDir = path.join(dir, 'backups');
  const backup = await db.backup({ directory: backupsDir, keep: 5, verify: true });

  db.setSetting('mode', 'public');
  db.ensureUser('628222222222@s.whatsapp.net', { name: 'Baru' });
  assert.equal(db.countUsers(), 2);

  const restored = db.restoreBackup(backup.path);

  assert.equal(db.getSetting('mode'), 'private');
  assert.equal(db.getUser('628111111111@s.whatsapp.net').name, 'Lama');
  assert.equal(db.getUser('628222222222@s.whatsapp.net'), null);
  assert.equal(restored.counts.users, 1);
  assert.deepEqual(Object.keys(restored.counts).sort(), [...RESTORE_TABLES].sort());
});

test('backup: restore menolak file hilang, database memory, dan skema berbeda', async (t) => {
  const { dir, db } = setup(t);

  assert.throws(
    () => db.restoreBackup(path.join(dir, 'tidak-ada.db')),
    /tidak ditemukan/,
  );

  const memory = createSqliteDatabase({ filename: ':memory:' });
  t.after(() => memory.close());
  assert.throws(() => memory.restoreBackup(path.join(dir, 'x.db')), /in-memory/);

  const foreign = path.join(dir, 'varr-masa-depan.db');
  createSqliteDatabase({ filename: foreign }).close();

  // Naikkan versi skema melewati versi kode saat ini.
  const Database = require('better-sqlite3');
  const raw = new Database(foreign);
  raw.pragma('user_version = 99');
  raw.close();

  assert.throws(
    () => db.restoreBackup(foreign),
    /tidak cocok/,
  );
});

test('backup: retensi menghapus backup paling lama', async (t) => {
  const { dir, db } = setup(t);

  const backupsDir = path.join(dir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.writeFileSync(path.join(backupsDir, 'varr-2020-01-01_00-00-00.db'), 'lama-1');
  fs.writeFileSync(path.join(backupsDir, 'varr-2020-01-02_00-00-00.db'), 'lama-2');

  const result = await db.backup({ directory: backupsDir, keep: 2 });

  assert.equal(result.removed, 1);

  const names = db.listBackups({ directory: backupsDir }).map((entry) => entry.name);
  assert.equal(names.length, 2);
  assert.equal(names.includes('varr-2020-01-01_00-00-00.db'), false);
  assert.equal(names.includes(result.name), true);
});

test('backup: command owner membuat, mendaftar, dan memverifikasi backup', async (t) => {
  const dir = tempDir();

  const bot = createTestBot({
    databaseFilename: path.join(dir, 'varr.db'),
    configOverrides: {
      backupsDir: path.join(dir, 'backups'),
      backupKeep: 5,
    },
  });

  t.after(() => bot.close());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.backup' }),
  );

  const created = lastText(bot);
  assert.match(created, /Backup dibuat: \*varr-/);
  assert.match(created, /Verifikasi: \*OK\*/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.backup list' }),
  );
  assert.match(lastText(bot), /Backup tersedia \(1\)/);
  assert.match(lastText(bot), /varr-/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.backup verify latest' }),
  );
  assert.match(lastText(bot), /Integritas: \*OK\*/);
  assert.match(lastText(bot), /Skema: v3/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.backup verify tidak-ada.db' }),
  );
  assert.match(lastText(bot), /tidak ditemukan/);
});

test('backup: command restore butuh konfirmasi dan memulihkan data', async (t) => {
  const dir = tempDir();

  const bot = createTestBot({
    databaseFilename: path.join(dir, 'varr.db'),
    configOverrides: {
      backupsDir: path.join(dir, 'backups'),
      backupKeep: 5,
    },
  });

  t.after(() => bot.close());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  bot.db.setSetting('mode', 'private');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.backup' }),
  );
  assert.match(lastText(bot), /Backup dibuat/);

  bot.db.setSetting('mode', 'public');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.restore latest' }),
  );
  assert.match(lastText(bot), /confirm/);
  assert.equal(bot.db.getSetting('mode'), 'public');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.restore latest confirm' }),
  );

  assert.match(lastText(bot), /Restore selesai/);
  assert.match(lastText(bot), /Backup pengaman/);
  assert.equal(bot.db.getSetting('mode'), 'private');
});

test('backup: command hanya untuk owner', async (t) => {
  const dir = tempDir();

  const bot = createTestBot({
    databaseFilename: path.join(dir, 'varr.db'),
    configOverrides: {
      backupsDir: path.join(dir, 'backups'),
      backupKeep: 5,
    },
  });

  t.after(() => bot.close());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: MEMBER, text: '.backup' }),
  );

  assert.match(lastText(bot), /membutuhkan akses/);
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
});
