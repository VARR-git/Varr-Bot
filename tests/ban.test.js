const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN,
  BOT,
  GROUP,
  MEMBER,
  OWNER,
  createTestBot,
  lastText,
  makeMessage,
} = require('./helpers/bot');
const { createBannedMiddleware } = require('../src/core/middleware/banned');
const { createTranslator } = require('../src/core/i18n');

test('ban: owner memblokir pengguna dan pengguna tidak lagi dilayani', async (t) => {
  let clock = 1_000_000;
  const bot = createTestBot({ now: () => clock });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.ban @628000000003 alasan uji', mentions: [MEMBER] }),
  );

  assert.match(lastText(bot), /diblokir dari bot/);
  assert.match(lastText(bot), /alasan uji/);
  assert.equal(bot.db.isUserBanned(MEMBER), true);
  assert.equal(bot.db.getUser(MEMBER).ban_reason, 'alasan uji');

  const before = bot.sent.length;

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: MEMBER, text: '.ping' }),
  );
  assert.match(lastText(bot), /diblokir dari memakai bot/);
  assert.equal(bot.sent.length, before + 1);

  // Notifikasi dibatasi: command berikutnya dalam jendela waktu diabaikan.
  clock += 30_000;
  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: MEMBER, text: '.ping' }),
  );
  assert.equal(bot.sent.length, before + 1);

  // Setelah jendela notifikasi lewat, pengguna diberi tahu lagi.
  clock += 11 * 60 * 1_000;
  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: MEMBER, text: '.ping' }),
  );
  assert.equal(bot.sent.length, before + 2);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.unban @628000000003', mentions: [MEMBER] }),
  );
  assert.equal(bot.db.isUserBanned(MEMBER), false);
  assert.match(lastText(bot), /bisa memakai bot lagi/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: MEMBER, text: '.ping' }),
  );
  assert.match(lastText(bot), /Pong/);
});

test('ban: grup yang diblokir diabaikan total kecuali owner', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: OWNER, text: '.ban group' }),
  );

  assert.equal(bot.db.isGroupBanned(GROUP), true);
  assert.match(lastText(bot), /Grup ini diblokir/);

  const before = bot.sent.length;

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ping' }),
  );
  assert.equal(bot.sent.length, before, 'grup diblokir tidak boleh dibalas');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: 'halo tanpa prefix' }),
  );
  assert.equal(bot.sent.length, before);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: OWNER, text: '.ping' }),
  );
  assert.match(lastText(bot), /Pong/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: OWNER, text: '.unban group' }),
  );
  assert.equal(bot.db.isGroupBanned(GROUP), false);
  assert.match(lastText(bot), /bisa memakai bot lagi/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.ping' }),
  );
  assert.match(lastText(bot), /Pong/);
});

test('ban: owner dan bot dilindungi dari pemblokiran', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.ban @628000000001', mentions: [OWNER] }),
  );
  assert.match(lastText(bot), /Tidak bisa memblokir owner atau bot/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.ban @628999999999', mentions: [BOT] }),
  );
  assert.match(lastText(bot), /Tidak bisa memblokir owner atau bot/);

  assert.equal(bot.db.isUserBanned(OWNER), false);
  assert.equal(bot.db.isUserBanned(BOT), false);
});

test('ban: status ganda dan target grup di chat pribadi ditangani', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.ban group' }),
  );
  assert.match(lastText(bot), /Sebutkan target/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.ban @628000000003', mentions: [MEMBER] }),
  );
  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.ban @628000000003', mentions: [MEMBER] }),
  );
  assert.match(lastText(bot), /sudah diblokir/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.unban @628000000003', mentions: [MEMBER] }),
  );
  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: OWNER, text: '.unban @628000000003', mentions: [MEMBER] }),
  );
  assert.match(lastText(bot), /tidak sedang diblokir/);

  assert.ok(
    bot.db.listAudit(10).some((entry) => entry.action === 'ban.user'),
    'audit ban.user harus tercatat',
  );
});

test('ban: middleware fail-open saat database bermasalah', async () => {
  const middleware = createBannedMiddleware({
    db: {
      isGroupBanned() {
        throw new Error('db rusak');
      },
      isUserBanned() {
        throw new Error('db rusak');
      },
      incrementStat() {},
    },
    logger: { warn() {} },
  });

  let passed = false;
  const ctx = {
    isOwner: false,
    isGroup: false,
    senderId: '628000000003@s.whatsapp.net',
    chatId: '628000000003@s.whatsapp.net',
    t: createTranslator('id'),
    reply: async () => {},
  };

  await middleware(ctx, async () => {
    passed = true;
  });

  assert.equal(passed, true);
});

test('ban: middleware meloloskan owner dan memblokir grup tanpa balasan', async () => {
  const t = createTranslator('id');
  const notices = [];
  const middleware = createBannedMiddleware({
    db: {
      isGroupBanned: () => true,
      isUserBanned: () => true,
      incrementStat() {},
    },
  });

  let passed = false;
  await middleware({
    isOwner: true,
    isGroup: false,
    senderId: MEMBER,
    chatId: MEMBER,
    t,
    reply: async () => {},
  }, async () => {
    passed = true;
  });
  assert.equal(passed, true);

  passed = false;
  await middleware({
    isOwner: false,
    isGroup: true,
    senderId: MEMBER,
    chatId: GROUP,
    t,
    reply: async (text) => notices.push(text),
  }, async () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.deepEqual(notices, []);
});

test('stats: menampilkan ringkasan penggunaan untuk owner', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(bot.sock, makeMessage({ chatId: OWNER, text: '.ping' }));
  await bot.handler.handleMessage(bot.sock, makeMessage({ chatId: OWNER, text: '.ping' }));
  await bot.handler.handleMessage(bot.sock, makeMessage({ chatId: OWNER, text: '.stats' }));

  const text = lastText(bot);
  assert.match(text, /Statistik Varr-Bot/);
  assert.match(text, /Command diproses: 2/);
  assert.match(text, /Pengguna terdaftar: 1/);
  assert.match(text, /SQLite/);
  assert.match(text, /Command terpopuler/);
  assert.match(text, /\.ping — 2/);
});

test('stats: ditolak untuk non-owner', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.stats' }),
  );

  assert.match(lastText(bot), /membutuhkan akses/);
});
