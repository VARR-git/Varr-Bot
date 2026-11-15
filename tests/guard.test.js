const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN,
  GROUP,
  MEMBER,
  OWNER,
  createTestBot,
  defaultMetadata,
  lastText,
  makeMessage,
} = require('./helpers/bot');
const { LINK_PATTERN, VALID_ACTIONS, normalizeAction } = require('../src/services/guard');

const BOT_NOT_ADMIN = defaultMetadata({
  participants: [
    { id: '628999999999@s.whatsapp.net', admin: null },
    { id: ADMIN, admin: 'superadmin' },
    { id: MEMBER, admin: null },
  ],
});

test('guard: pola tautan mengenali bentuk umum', () => {
  assert.equal(LINK_PATTERN.test('lihat https://example.com'), true);
  assert.equal(LINK_PATTERN.test('www.example.com'), true);
  assert.equal(LINK_PATTERN.test('join chat.whatsapp.com/abcd'), true);
  assert.equal(LINK_PATTERN.test('wa.me/628123'), true);
  assert.equal(LINK_PATTERN.test('t.me/grup'), true);
  assert.equal(LINK_PATTERN.test('halo semua tanpa tautan'), false);
  assert.equal(LINK_PATTERN.test('contoh.com'), false);
});

test('guard: aksi tidak dikenal jatuh ke delete', () => {
  assert.equal(normalizeAction('warn'), 'warn');
  assert.equal(normalizeAction('KICK'), 'kick');
  assert.equal(normalizeAction('hapus'), 'delete');
  assert.equal(normalizeAction(null), 'delete');
  assert.deepEqual([...VALID_ACTIONS], ['delete', 'warn', 'kick']);
});

test('guard: antilink menghapus pesan anggota biasa', async (t) => {
  const clock = { value: 1_000_000 };
  const bot = createTestBot({ now: () => clock.value });
  t.after(() => bot.close());

  bot.db.setGroupSetting(GROUP, 'antilink', true);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: 'promo https://contoh.com' }),
  );

  assert.equal(bot.calls.deletes.length, 1);
  assert.equal(bot.sent.filter((entry) => !entry.payload?.delete).length, 0);
  assert.equal(bot.db.getStat('guard:handled'), 1);
});

test('guard: admin dan owner tidak terkena guard', async (t) => {
  const clock = { value: 2_000_000 };
  const bot = createTestBot({ now: () => clock.value });
  t.after(() => bot.close());

  bot.db.setGroupSetting(GROUP, 'antilink', true);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: 'https://contoh.com dari admin' }),
  );
  assert.equal(bot.calls.deletes.length, 0);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: OWNER, text: 'https://contoh.com dari owner' }),
  );
  assert.equal(bot.calls.deletes.length, 0);

  // Anggota biasa tetap kena guard.
  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: 'https://contoh.com dari anggota' }),
  );
  assert.equal(bot.calls.deletes.length, 1);
});

test('guard: bot bukan admin tidak menghapus pesan', async (t) => {
  const clock = { value: 3_000_000 };
  const bot = createTestBot({ metadata: BOT_NOT_ADMIN, now: () => clock.value });
  t.after(() => bot.close());

  bot.db.setGroupSetting(GROUP, 'antilink', true);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: 'https://contoh.com' }),
  );

  assert.equal(bot.calls.deletes.length, 0);
  assert.equal(bot.db.getStat('guard:handled'), 0);
});

test('guard: aksi warn melakukan eskalasi kick saat batas tercapai', async (t) => {
  const clock = { value: 4_000_000 };
  const bot = createTestBot({ now: () => clock.value });
  t.after(() => bot.close());

  bot.db.setGroupSetting(GROUP, 'antilink', true);
  bot.db.setGroupSetting(GROUP, 'antilink_action', 'warn');
  bot.db.setGroupSetting(GROUP, 'warn_limit', 1);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: 'https://contoh.com' }),
  );

  assert.equal(bot.calls.deletes.length, 1);
  assert.equal(bot.calls.groupParticipantsUpdate.length, 1);
  assert.equal(bot.calls.groupParticipantsUpdate[0].action, 'remove');
  assert.deepEqual(bot.calls.groupParticipantsUpdate[0].jids, [MEMBER]);
  assert.match(lastText(bot), /dikeluarkan oleh guard/);
  assert.equal(bot.db.countWarnings(GROUP, MEMBER), 0);
  assert.ok(
    bot.db.listAudit(10).some((entry) => entry.action === 'warning.kick'),
    'audit warning.kick harus tercatat',
  );
});

test('guard: antispam mendeteksi flood dalam jendela waktu', async (t) => {
  let clock = 5_000_000;
  const bot = createTestBot({ now: () => clock });
  t.after(() => bot.close());

  bot.db.setGroupSetting(GROUP, 'antispam', true);

  for (let index = 0; index < 7; index += 1) {
    clock += 100;
    await bot.handler.handleMessage(
      bot.sock,
      makeMessage({ chatId: GROUP, sender: MEMBER, text: `pesan nomor ${index}` }),
    );
  }

  assert.equal(bot.calls.deletes.length, 1);
  assert.equal(bot.db.getStat('guard:handled'), 1);
});

test('guard: antispam mendeteksi pesan berulang', async (t) => {
  let clock = 6_000_000;
  const bot = createTestBot({ now: () => clock });
  t.after(() => bot.close());

  bot.db.setGroupSetting(GROUP, 'antispam', true);

  for (let index = 0; index < 4; index += 1) {
    clock += 500;
    await bot.handler.handleMessage(
      bot.sock,
      makeMessage({ chatId: GROUP, sender: MEMBER, text: 'pesan yang sama' }),
    );
  }

  assert.equal(bot.calls.deletes.length, 1);
});

test('guard: command antilink dan antispam mengatur pengaturan grup', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.antilink on' }),
  );
  assert.equal(bot.db.getGroupSetting(GROUP, 'antilink'), true);
  assert.match(lastText(bot), /diaktifkan/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.antilink warn' }),
  );
  assert.equal(bot.db.getGroupSetting(GROUP, 'antilink_action'), 'warn');
  assert.match(lastText(bot), /aksi \*warn\*/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.antilink' }),
  );
  assert.match(lastText(bot), /Antilink: \*aktif\*/);
  assert.match(lastText(bot), /Aksi: \*warn\*/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.antispam kick' }),
  );
  assert.equal(bot.db.getGroupSetting(GROUP, 'antispam'), true);
  assert.equal(bot.db.getGroupSetting(GROUP, 'antispam_action'), 'kick');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.antilink off' }),
  );
  assert.equal(bot.db.getGroupSetting(GROUP, 'antilink'), false);
});

test('guard: setwarnlimit membatasi nilai dan guardstatus merangkum', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.setwarnlimit 2' }),
  );
  assert.equal(bot.db.getGroupSetting(GROUP, 'warn_limit'), 2);
  assert.match(lastText(bot), /diubah menjadi \*2\*/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.setwarnlimit 99' }),
  );
  assert.match(lastText(bot), /angka antara 1 dan 10/);
  assert.equal(bot.db.getGroupSetting(GROUP, 'warn_limit'), 2);

  bot.db.setGroupSetting(GROUP, 'antilink', true);
  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.guardstatus' }),
  );

  const text = lastText(bot);
  assert.match(text, /Status Guard/);
  assert.match(text, /Antilink: aktif/);
  assert.match(text, /Batas warning: 2/);
  assert.match(text, /Bot admin: Ya/);
});

test('guard: pengaturan guard hanya untuk admin grup', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.antilink on' }),
  );

  assert.match(lastText(bot), /membutuhkan akses/);
  assert.equal(bot.db.getGroupSetting(GROUP, 'antilink', false), false);
});
