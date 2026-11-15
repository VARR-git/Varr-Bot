const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../src/config');
const { createDatabase } = require('../src/core/database');
const { createTranslator } = require('../src/core/i18n');
const {
  compose,
  createNormalizeMiddleware,
  createMaintenanceMiddleware,
  createModeMiddleware,
  createPermissionMiddleware,
  createScopeMiddleware,
  createCooldownMiddleware,
  createRateLimitMiddleware,
} = require('../src/core/middleware');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeContext(overrides = {}) {
  const replies = [];
  const base = {
    chatId: '628222@s.whatsapp.net',
    isGroup: false,
    senderId: '628222@s.whatsapp.net',
    senderIds: ['628222@s.whatsapp.net'],
    isOwner: false,
    role: 'user',
    msg: { pushName: 'Tester' },
    command: { name: 'ping', permission: 'user', scope: 'all', cooldown: 0 },
    config: { defaultCooldown: 0, prefix: '.', ownerNumbers: [] },
    state: { mode: 'public', maintenance: false },
    logger: silentLogger,
    t: createTranslator('id'),
    replies,
    async reply(text) {
      replies.push(String(text));
    },
    ...overrides,
  };

  base.replies = replies;
  return base;
}

async function run(middleware, ctx) {
  let nextCalled = false;
  await middleware(ctx, async () => {
    nextCalled = true;
  });
  return nextCalled;
}

test('middleware: compose berjalan berurutan dan bisa berhenti', async () => {
  const order = [];
  const ctx = makeContext();

  const pipeline = compose([
    async (current, next) => {
      order.push('a');
      current.value = 1;
      await next();
      order.push('d');
    },
    async (current, next) => {
      order.push('b');
      assert.equal(current.value, 1);
      await next();
    },
  ]);

  await pipeline(ctx, async () => {
    order.push('c');
  });

  assert.deepEqual(order, ['a', 'b', 'c', 'd']);

  const halting = compose([
    async () => {
      order.push('stop');
    },
    async () => {
      order.push('tidak-jalan');
    },
  ]);

  await halting(makeContext(), async () => {
    order.push('final');
  });

  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'stop']);
});

test('middleware: normalize menentukan owner, admin, dan premium', async () => {
  const config = loadConfig({
    OWNER_NUMBERS: '628111111111',
    LOG_LEVEL: 'silent',
    COMMAND_COOLDOWN: '0',
  });
  const db = createDatabase({ config, filename: ':memory:' });

  const metadata = {
    subject: 'Grup Uji',
    participants: [
      { id: '628222222222@s.whatsapp.net', admin: 'admin' },
      { id: '628333333333@s.whatsapp.net', admin: null },
    ],
  };

  const getGroupMetadata = async () => metadata;
  const normalize = createNormalizeMiddleware({ config, db, getGroupMetadata });

  const ownerCtx = makeContext({
    senderId: '628111111111@s.whatsapp.net',
    senderIds: ['628111111111@s.whatsapp.net'],
    msg: { pushName: 'Owner' },
  });
  assert.equal(await run(normalize, ownerCtx), true);
  assert.equal(ownerCtx.role, 'owner');
  assert.equal(ownerCtx.isOwner, true);
  assert.equal(ownerCtx.senderName, 'Owner');

  const lidOwnerCtx = makeContext({
    senderId: '628111111111@lid',
    senderIds: ['628111111111@lid'],
  });
  await run(normalize, lidOwnerCtx);
  assert.equal(lidOwnerCtx.role, 'user');
  assert.equal(lidOwnerCtx.isOwner, false);

  const adminCtx = makeContext({
    chatId: '120363@g.us',
    isGroup: true,
    senderId: '628222222222@s.whatsapp.net',
    senderIds: ['628222222222@s.whatsapp.net'],
  });
  await run(normalize, adminCtx);
  assert.equal(adminCtx.role, 'admin');
  assert.equal(db.getGroup('120363@g.us').name, 'Grup Uji');

  const memberCtx = makeContext({
    chatId: '120363@g.us',
    isGroup: true,
    senderId: '628333333333@s.whatsapp.net',
    senderIds: ['628333333333@s.whatsapp.net'],
  });
  await run(normalize, memberCtx);
  assert.equal(memberCtx.role, 'user');

  db.setPremium('628444444444@s.whatsapp.net', true);
  const premiumCtx = makeContext({
    senderId: '628444444444@s.whatsapp.net',
    senderIds: ['628444444444@s.whatsapp.net'],
  });
  await run(normalize, premiumCtx);
  assert.equal(premiumCtx.role, 'premium');

  const failingCtx = makeContext({
    chatId: '120363@g.us',
    isGroup: true,
    senderId: '628555555555@s.whatsapp.net',
    senderIds: ['628555555555@s.whatsapp.net'],
  });
  const failingNormalize = createNormalizeMiddleware({
    config,
    db,
    getGroupMetadata: async () => {
      throw new Error('metadata gagal');
    },
  });
  assert.equal(await run(failingNormalize, failingCtx), true);
  assert.equal(failingCtx.role, 'user');

  db.close();
});

test('middleware: permission mengikuti hierarki role', async () => {
  const middleware = createPermissionMiddleware({ logger: silentLogger });

  for (const [role, allowed] of [
    ['user', ['user']],
    ['premium', ['user', 'premium']],
    ['admin', ['user', 'premium', 'admin']],
    ['owner', ['user', 'premium', 'admin', 'owner']],
  ]) {
    for (const permission of ['user', 'premium', 'admin', 'owner']) {
      const ctx = makeContext({ role, command: { name: 'x', permission } });
      const passed = await run(middleware, ctx);
      assert.equal(passed, allowed.includes(permission), `${role} → ${permission}`);
      if (!passed) assert.ok(ctx.replies[0].includes('akses'));
    }
  }
});

test('middleware: maintenance hanya blokir non-owner dan non-darurat', async () => {
  const state = { maintenance: true };
  const middleware = createMaintenanceMiddleware({ state });

  const normal = makeContext({ state });
  assert.equal(await run(middleware, normal), false);
  assert.ok(normal.replies[0].includes('maintenance'));

  const safe = makeContext({
    state,
    command: { name: 'ping', permission: 'user', maintenanceSafe: true },
  });
  assert.equal(await run(middleware, safe), true);

  const owner = makeContext({ state, isOwner: true });
  assert.equal(await run(middleware, owner), true);

  state.maintenance = false;
  assert.equal(await run(middleware, makeContext({ state })), true);
});

test('middleware: mode public/private/self', async () => {
  const state = { mode: 'private' };
  const middleware = createModeMiddleware({ state });

  const admin = makeContext({ state, isGroup: true, role: 'admin' });
  assert.equal(await run(middleware, admin), true);

  const member = makeContext({ state, isGroup: true, role: 'user' });
  assert.equal(await run(middleware, member), false);
  assert.ok(member.replies[0].includes('admin grup'));

  const directUser = makeContext({ state, role: 'user' });
  assert.equal(await run(middleware, directUser), false);
  assert.ok(directUser.replies[0].includes('chat pribadi'));

  const owner = makeContext({ state, isOwner: true });
  assert.equal(await run(middleware, owner), true);

  state.mode = 'self';
  const selfUser = makeContext({ state, role: 'admin', isGroup: true });
  assert.equal(await run(middleware, selfUser), false);
  assert.ok(selfUser.replies[0].includes('self'));
  assert.equal(await run(middleware, makeContext({ state, isOwner: true })), true);

  state.mode = 'public';
  assert.equal(await run(middleware, makeContext({ state, role: 'user' })), true);
});

test('middleware: scope grup dan private', async () => {
  const middleware = createScopeMiddleware();

  const groupOnly = makeContext({ command: { name: 'kick', scope: 'group' } });
  assert.equal(await run(middleware, groupOnly), false);
  assert.ok(groupOnly.replies[0].includes('grup'));

  const privateOnly = makeContext({ isGroup: true, command: { name: 'owner', scope: 'private' } });
  assert.equal(await run(middleware, privateOnly), false);
  assert.ok(privateOnly.replies[0].includes('chat pribadi'));

  assert.equal(await run(middleware, makeContext({ command: { name: 'ping', scope: 'all' } })), true);
  assert.equal(await run(middleware, makeContext({ isGroup: true, command: { name: 'kick', scope: 'group' } })), true);
  assert.equal(await run(middleware, makeContext({ command: { name: 'owner', scope: 'private' } })), true);
});

test('middleware: cooldown per pengguna dan command', async () => {
  let clock = 10_000;
  const config = { defaultCooldown: 5 };
  const middleware = createCooldownMiddleware({ config, now: () => clock });

  const ctx = makeContext({
    command: { name: 'ping', permission: 'user', cooldown: 5 },
  });

  clock = 10_000;
  assert.equal(await run(middleware, ctx), true);
  assert.equal(await run(middleware, ctx), false);
  assert.ok(ctx.replies[0].includes('Tunggu'));

  clock = 15_000;
  assert.equal(await run(middleware, ctx), true);

  const other = makeContext({ command: { name: 'help', permission: 'user', cooldown: 5 } });
  clock = 15_500;
  assert.equal(await run(middleware, other), true);

  const owner = makeContext({
    isOwner: true,
    command: { name: 'ping', permission: 'owner', cooldown: 99 },
  });
  assert.equal(await run(middleware, owner), true);
  assert.equal(await run(middleware, owner), true);

  middleware.reset();
  assert.equal(middleware.size(), 0);
});

test('middleware: rate limit sliding window', async () => {
  let clock = 100_000;
  const config = { rateLimit: { max: 2, windowMs: 1_000 } };
  const middleware = createRateLimitMiddleware({ config, now: () => clock });
  const ctx = makeContext();

  assert.equal(await run(middleware, ctx), true);
  assert.equal(await run(middleware, ctx), true);
  assert.equal(await run(middleware, ctx), false);
  assert.ok(ctx.replies[0].includes('Terlalu banyak'));

  clock = 101_100;
  assert.equal(await run(middleware, ctx), true);

  const owner = makeContext({ isOwner: true });
  assert.equal(await run(middleware, owner), true);
  assert.equal(await run(middleware, owner), true);

  middleware.reset();
  assert.equal(middleware.size(), 0);
});
