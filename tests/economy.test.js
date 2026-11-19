/**
 * Test sistem economy: migrasi v3, daily, level XP, dan leaderboard.
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createSqliteDatabase } = require('../src/core/database/sqlite');
const { CommandRegistry } = require('../src/core/registry');
const {
  DAILY_COINS,
  DAILY_XP,
  totalXpForLevel,
  levelProgress,
} = require('../src/utils/economy');

const daily = require('../src/commands/economy/daily');
const balance = require('../src/commands/economy/balance');
const level = require('../src/commands/economy/level');
const leaderboard = require('../src/commands/economy/leaderboard');

const JID = '628111111111@s.whatsapp.net';

/**
 * @param {object} db
 * @param {{senderId?: string, args?: string[]}} [options]
 */
function makeCtx(db, { senderId = JID, args = [] } = {}) {
  const t = (key, vars = {}) => [
    key,
    ...Object.entries(vars).map(([name, value]) => `${name}:${value}`),
  ].join(' ');

  return {
    db,
    senderId,
    args,
    msg: { message: { conversation: 'halo' } },
    startedAt: Date.now(),
    t,
  };
}

/**
 * @param {{now?: () => number}} [options]
 */
function openDb(options = {}) {
  return createSqliteDatabase({ filename: ':memory:', ...options });
}

test('migrasi v3 menambah kolom economy ke tabel users', (t) => {
  const db = openDb();
  t.after(() => db.close());

  assert.equal(Number(db.raw.pragma('user_version', { simple: true })), 3);

  const columns = db.raw.pragma('table_info(users)').map((column) => column.name);
  for (const name of ['balance', 'xp', 'level', 'last_daily', 'last_xp_at']) {
    assert.ok(columns.includes(name), `kolom ${name} harus ada`);
  }

  const user = db.ensureUser(JID);
  assert.equal(user.balance, 0);
  assert.equal(user.xp, 0);
  assert.equal(user.level, 1);
  assert.equal(user.last_daily, null);
});

test('.daily memberi koin + XP dan menolak klaim ganda sebelum 24 jam', async (t) => {
  let clock = 1_700_000_000_000;
  const db = openDb({ now: () => clock });
  t.after(() => db.close());

  const ctx = makeCtx(db);

  const first = await daily.execute(ctx);
  assert.match(first, /economy\.daily\.claimed/);

  const user = db.getUser(JID);
  assert.equal(user.balance, DAILY_COINS);
  assert.equal(user.xp, DAILY_XP);
  assert.equal(user.last_daily, clock);

  clock += 60 * 60 * 1000;
  const second = await daily.execute(ctx);
  assert.match(second, /economy\.daily\.wait/);
  assert.equal(db.getUser(JID).balance, DAILY_COINS);

  clock += 24 * 60 * 60 * 1000;
  const third = await daily.execute(ctx);
  assert.match(third, /economy\.daily\.claimed/);
  assert.equal(db.getUser(JID).balance, DAILY_COINS * 2);
});

test('XP menaikkan level saat ambang tercapai', (t) => {
  const db = openDb();
  t.after(() => db.close());

  const gained = db.addXp(JID, totalXpForLevel(2));
  assert.equal(gained.fromLevel, 1);
  assert.equal(gained.toLevel, 2);
  assert.equal(gained.leveledUp, true);
  assert.equal(gained.user.level, 2);
  assert.equal(gained.user.xp, totalXpForLevel(2));

  const progress = levelProgress(gained.user.xp);
  assert.equal(progress.level, 2);
  assert.equal(progress.current, 0);
  assert.equal(progress.needed, totalXpForLevel(3) - totalXpForLevel(2));
});

test('XP pasif dibatasi cooldown', (t) => {
  let clock = 1_700_000_000_000;
  const db = openDb({ now: () => clock });
  t.after(() => db.close());

  const options = { min: 10, max: 20, cooldownMs: 45_000, random: () => 0 };

  const first = db.grantPassiveXp(JID, options);
  assert.equal(first.granted, true);
  assert.equal(first.amount, 10);
  assert.equal(db.getUser(JID).xp, 10);

  clock += 10_000;
  const blocked = db.grantPassiveXp(JID, options);
  assert.equal(blocked.granted, false);
  assert.ok(blocked.remainingMs > 0);
  assert.equal(db.getUser(JID).xp, 10);

  clock += 45_000;
  const again = db.grantPassiveXp(JID, options);
  assert.equal(again.granted, true);
  assert.equal(db.getUser(JID).xp, 20);
});

test('.leaderboard mengurutkan user berdasarkan koin lalu level', async (t) => {
  const db = openDb();
  t.after(() => db.close());

  const alice = '628111111111@s.whatsapp.net';
  const bob = '628222222222@s.whatsapp.net';
  const carol = '628333333333@s.whatsapp.net';

  db.ensureUser(alice, { name: 'Alice' });
  db.ensureUser(bob, { name: 'Bob' });
  db.ensureUser(carol, { name: 'Carol' });

  db.addBalance(alice, 100);
  db.addBalance(bob, 300);
  db.addBalance(carol, 200);
  db.addXp(carol, totalXpForLevel(3));

  const byBalance = await leaderboard.execute(makeCtx(db, { args: [] }));
  assert.ok(byBalance.indexOf('Bob') < byBalance.indexOf('Carol'));
  assert.ok(byBalance.indexOf('Carol') < byBalance.indexOf('Alice'));

  const byLevel = await leaderboard.execute(makeCtx(db, { args: ['level'] }));
  assert.match(byLevel, /economy\.leaderboard\.titleLevel/);
  assert.ok(byLevel.indexOf('Carol') < byLevel.indexOf('Alice'));
});

test('command economy punya manifest yang valid dan alias sesuai', () => {
  const registry = new CommandRegistry();
  registry.registerMany([daily, balance, level, leaderboard]);

  assert.equal(registry.get('bal')?.name, 'balance');
  assert.equal(registry.get('saldo')?.name, 'balance');
  assert.equal(registry.get('rank')?.name, 'level');
  assert.equal(registry.get('lb')?.name, 'leaderboard');
  assert.equal(registry.get('top')?.name, 'leaderboard');
});
