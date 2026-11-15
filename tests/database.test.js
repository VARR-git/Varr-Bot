const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDatabase } = require('../src/core/database');
const { createSqliteDatabase } = require('../src/core/database/sqlite');

function configFor(url = '') {
  return {
    databaseUrl: url,
    dataDir: path.resolve(os.tmpdir(), 'varr-bot-test-data'),
    rootDir: process.cwd(),
  };
}

test('database: factory memakai SQLite in-memory untuk test', () => {
  const db = createDatabase({ config: configFor(), filename: ':memory:' });
  assert.equal(db.driver, 'sqlite');
  assert.equal(db.isMemory, true);
  assert.equal(db.health().ok, true);
  assert.equal(db.health().schemaVersion, 1);
  db.close();
});

test('database: driver selain SQLite ditolak jelas', () => {
  assert.throws(
    () => createDatabase({ config: configFor('mysql://user:pass@localhost/db') }),
    /belum didukung/,
  );
});

test('database: settings menyimpan JSON dan fallback', () => {
  const db = createSqliteDatabase({ filename: ':memory:' });

  assert.equal(db.getSetting('mode', 'public'), 'public');
  db.setSetting('mode', 'private');
  db.setSetting('nested', { a: 1, b: ['x'] });
  assert.equal(db.getSetting('mode'), 'private');
  assert.deepEqual(db.getSetting('nested'), { a: 1, b: ['x'] });
  assert.equal(db.deleteSetting('mode'), true);
  assert.equal(db.deleteSetting('mode'), false);
  assert.equal(db.getSetting('mode', 'public'), 'public');

  db.close();
});

test('database: user, premium, dan hitungan command', () => {
  let clock = 1_000;
  const db = createSqliteDatabase({ filename: ':memory:', now: () => clock });

  const user = db.ensureUser('628111@s.whatsapp.net', { name: 'Varr', lid: '111@lid' });
  assert.equal(user.name, 'Varr');
  assert.equal(user.lid, '111@lid');
  assert.equal(user.is_premium, false);
  assert.equal(user.created_at, 1_000);

  db.ensureUser('628111@s.whatsapp.net', { name: 'Varr Baru' });
  assert.equal(db.getUser('628111@s.whatsapp.net').name, 'Varr Baru');

  assert.equal(db.isPremium('628111@s.whatsapp.net'), false);
  db.setPremium('628111@s.whatsapp.net', true, 2_000);
  assert.equal(db.isPremium('628111@s.whatsapp.net'), true);

  clock = 2_500;
  assert.equal(db.isPremium('628111@s.whatsapp.net'), false);
  assert.equal(db.isPremium('628999@s.whatsapp.net'), false);

  db.setPremium('628111@s.whatsapp.net', true);
  db.incrementUserCommands('628111@s.whatsapp.net');
  db.incrementUserCommands('628111@s.whatsapp.net');
  assert.equal(db.getUser('628111@s.whatsapp.net').command_count, 2);

  assert.throws(() => db.ensureUser(''), /JID/);
  db.close();
});

test('database: grup dan pengaturan grup', () => {
  const db = createSqliteDatabase({ filename: ':memory:' });

  const group = db.ensureGroup('120363@g.us', { name: 'Grup Uji' });
  assert.equal(group.name, 'Grup Uji');
  assert.equal(group.is_banned, false);

  db.setGroupSetting('120363@g.us', 'antilink', true);
  db.setGroupSetting('120363@g.us', 'welcome', { enabled: true, text: 'Halo' });
  assert.equal(db.getGroupSetting('120363@g.us', 'antilink'), true);
  assert.deepEqual(db.getGroupSetting('120363@g.us', 'welcome'), { enabled: true, text: 'Halo' });
  assert.equal(db.getGroupSetting('120363@g.us', 'missing', 'fallback'), 'fallback');
  assert.equal(db.deleteGroupSetting('120363@g.us', 'antilink'), true);

  db.setGroupBanned('120363@g.us', true);
  assert.equal(db.getGroup('120363@g.us').is_banned, true);

  db.incrementGroupCommands('120363@g.us');
  assert.equal(db.getGroup('120363@g.us').command_count, 1);

  db.close();
});

test('database: warning, statistik, dan audit log', () => {
  const db = createSqliteDatabase({ filename: ':memory:' });

  const warningId = db.addWarning('120363@g.us', '628111@s.whatsapp.net', {
    reason: 'spam',
    warnedBy: '628222@s.whatsapp.net',
  });
  assert.equal(warningId, 1);
  assert.equal(db.countWarnings('120363@g.us', '628111@s.whatsapp.net'), 1);
  assert.equal(db.getWarnings('120363@g.us', '628111@s.whatsapp.net')[0].reason, 'spam');
  assert.equal(db.clearWarnings('120363@g.us', '628111@s.whatsapp.net'), 1);
  assert.equal(db.countWarnings('120363@g.us', '628111@s.whatsapp.net'), 0);

  assert.equal(db.getStat('command:total', 0), 0);
  db.incrementStat('command:total');
  db.incrementStat('command:total', 4);
  assert.equal(db.getStat('command:total'), 5);
  db.incrementStat('command:total', 0);
  assert.equal(db.getStat('command:total'), 5);

  const auditId = db.audit({
    actor: '628111@s.whatsapp.net',
    action: 'mode.change',
    target: 'chat',
    meta: { to: 'private' },
  });
  assert.equal(auditId, 1);

  const logs = db.listAudit(10);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'mode.change');
  assert.deepEqual(JSON.parse(logs[0].meta), { to: 'private' });

  assert.throws(() => db.audit({ action: '' }), /Action audit/);
  db.close();
});

test('database: backup, retensi, dan reopen', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varr-db-'));
  const filename = path.join(directory, 'varr.db');
  const backupsDir = path.join(directory, 'backups');

  const db = createSqliteDatabase({ filename });
  db.setSetting('hello', 'world');
  db.audit({ actor: 'owner', action: 'test' });

  const backup = await db.backup({ directory: backupsDir, keep: 2 });
  assert.ok(fs.existsSync(backup.path));
  assert.ok(backup.sizeBytes > 0);
  db.close();

  const reopened = createSqliteDatabase({ filename });
  assert.equal(reopened.getSetting('hello'), 'world');
  assert.equal(reopened.listAudit(1).length, 1);
  assert.equal(reopened.health().schemaVersion, 1);
  reopened.close();

  const memory = createSqliteDatabase({ filename: ':memory:' });
  await assert.rejects(() => memory.backup(), /in-memory/);
  memory.close();

  fs.rmSync(directory, { recursive: true, force: true });
});
