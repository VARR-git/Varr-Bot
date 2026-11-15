const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN,
  BOT,
  GROUP,
  MEMBER,
  OWNER,
  createTestBot,
  defaultMetadata,
  lastPayload,
  lastText,
  makeMessage,
  silentLogger,
} = require('./helpers/bot');
const { createGroupEvents } = require('../src/services/groupEvents');

function adminBot(options = {}) {
  return createTestBot(options);
}

test('grup: kick mengeluarkan anggota dan mencatat audit', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  bot.db.addWarning(GROUP, MEMBER, { reason: 'spam', warnedBy: ADMIN });

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.kick @628000000003 alasan uji', mentions: [MEMBER] }),
  );

  assert.equal(bot.calls.groupParticipantsUpdate.length, 1);
  assert.deepEqual(bot.calls.groupParticipantsUpdate[0], {
    chatId: GROUP,
    jids: [MEMBER],
    action: 'remove',
  });
  assert.match(lastText(bot), /dikeluarkan/);
  assert.match(lastText(bot), /alasan uji/);
  assert.equal(bot.db.countWarnings(GROUP, MEMBER), 0);

  const audit = bot.db.listAudit(1)[0];
  assert.equal(audit.action, 'group.kick');
  assert.equal(audit.target, MEMBER);
});

test('grup: kick menolak target admin, bot, owner, dan non-anggota', async (t) => {
  const otherAdmin = '628000000004@s.whatsapp.net';
  const metadata = defaultMetadata({
    owner: ADMIN,
    participants: [
      { id: BOT, admin: 'admin' },
      { id: ADMIN, admin: 'superadmin' },
      { id: MEMBER, admin: null },
      { id: OWNER, admin: null },
      { id: otherAdmin, admin: 'admin' },
    ],
  });
  const bot = adminBot({ metadata });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: `.kick @${otherAdmin.split('@')[0]}`, mentions: [otherAdmin] }),
  );
  assert.match(lastText(bot), /admin grup/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.kick @628999999999', mentions: [BOT] }),
  );
  assert.match(lastText(bot), /bot sendiri/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.kick @628000000001', mentions: [OWNER] }),
  );
  assert.match(lastText(bot), /owner bot/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.kick @628777777777', mentions: ['628777777777@s.whatsapp.net'] }),
  );
  assert.match(lastText(bot), /bukan anggota/);

  assert.equal(bot.calls.groupParticipantsUpdate.length, 0);
});

test('grup: command admin ditolak untuk anggota biasa', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: MEMBER, text: '.kick @628000000002', mentions: [ADMIN] }),
  );

  assert.match(lastText(bot), /membutuhkan akses/);
  assert.equal(bot.calls.groupParticipantsUpdate.length, 0);
});

test('grup: bot bukan admin tidak bisa kick dan tidak menghapus warning', async (t) => {
  const metadata = defaultMetadata({
    participants: [
      { id: BOT, admin: null },
      { id: ADMIN, admin: 'superadmin' },
      { id: MEMBER, admin: null },
    ],
  });
  const bot = adminBot({ metadata });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.kick @628000000003', mentions: [MEMBER] }),
  );

  assert.match(lastText(bot), /harus menjadi admin/);
  assert.equal(bot.calls.groupParticipantsUpdate.length, 0);
});

test('grup: promote dan demote memanggil API dengan aksi yang benar', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.promote @628000000003', mentions: [MEMBER] }),
  );
  assert.deepEqual(bot.calls.groupParticipantsUpdate.at(-1), {
    chatId: GROUP,
    jids: [MEMBER],
    action: 'promote',
  });
  assert.match(lastText(bot), /sekarang menjadi admin/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.demote @628000000003', mentions: [MEMBER] }),
  );
  // MEMBER belum admin di metadata, jadi demote ditolak.
  assert.match(lastText(bot), /bukan admin/);

  const promotedMetadata = defaultMetadata({
    participants: [
      { id: BOT, admin: 'admin' },
      { id: ADMIN, admin: 'superadmin' },
      { id: MEMBER, admin: 'admin' },
    ],
  });
  const bot2 = adminBot({ metadata: promotedMetadata });
  t.after(() => bot2.close());

  await bot2.handler.handleMessage(
    bot2.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.demote @628000000003', mentions: [MEMBER] }),
  );
  assert.deepEqual(bot2.calls.groupParticipantsUpdate.at(-1), {
    chatId: GROUP,
    jids: [MEMBER],
    action: 'demote',
  });
  assert.match(lastText(bot2), /Status admin/);
});

test('grup: promote menolak target yang sudah admin', async (t) => {
  const metadata = defaultMetadata({
    participants: [
      { id: BOT, admin: 'admin' },
      { id: ADMIN, admin: 'superadmin' },
      { id: MEMBER, admin: 'admin' },
    ],
  });
  const bot = adminBot({ metadata });
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.promote @628000000003', mentions: [MEMBER] }),
  );

  assert.match(lastText(bot), /sudah menjadi admin/);
  assert.equal(bot.calls.groupParticipantsUpdate.length, 0);
});

test('grup: warning bertambah dan eskalasi kick saat batas tercapai', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  bot.db.setGroupSetting(GROUP, 'warn_limit', 2);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.warn @628000000003 spam', mentions: [MEMBER] }),
  );
  assert.match(lastText(bot), /peringatan 1\/2/);
  assert.equal(bot.db.countWarnings(GROUP, MEMBER), 1);
  assert.equal(bot.calls.groupParticipantsUpdate.length, 0);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.warn @628000000003 spam lagi', mentions: [MEMBER] }),
  );
  assert.match(lastText(bot), /dikeluarkan karena mencapai batas/);
  assert.equal(bot.db.countWarnings(GROUP, MEMBER), 0);
  assert.equal(bot.calls.groupParticipantsUpdate.at(-1).action, 'remove');
});

test('grup: warnings menampilkan daftar dan unwarn menghapusnya', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.warnings @628000000003', mentions: [MEMBER] }),
  );
  assert.match(lastText(bot), /Tidak ada warning/);

  bot.db.addWarning(GROUP, MEMBER, { reason: 'spam', warnedBy: ADMIN });
  bot.db.addWarning(GROUP, MEMBER, { reason: 'kasar', warnedBy: ADMIN });

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.warnings @628000000003', mentions: [MEMBER] }),
  );
  assert.match(lastText(bot), /Warning/);
  assert.match(lastText(bot), /spam/);
  assert.match(lastText(bot), /kasar/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.unwarn @628000000003', mentions: [MEMBER] }),
  );
  assert.match(lastText(bot), /2 warning/);
  assert.equal(bot.db.countWarnings(GROUP, MEMBER), 0);
});

test('grup: mute dan unmute mengubah pengaturan grup', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.mute' }),
  );
  assert.deepEqual(bot.calls.groupSettingUpdate.at(-1), {
    chatId: GROUP,
    setting: 'announcement',
  });
  assert.match(lastText(bot), /Grup ditutup/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.mute' }),
  );
  assert.match(lastText(bot), /sudah dalam mode hanya admin/);

  const muted = defaultMetadata({ announce: true });
  const bot2 = adminBot({ metadata: muted });
  t.after(() => bot2.close());

  await bot2.handler.handleMessage(
    bot2.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.unmute' }),
  );
  assert.deepEqual(bot2.calls.groupSettingUpdate.at(-1), {
    chatId: GROUP,
    setting: 'not_announcement',
  });
  assert.match(lastText(bot2), /Grup dibuka/);
});

test('grup: tagall dan hidetag menyebut semua anggota', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.tagall Rapat jam 8' }),
  );

  const tagged = lastPayload(bot);
  assert.equal(tagged.mentions.length, bot.metadata.participants.length);
  assert.match(tagged.text, /Rapat jam 8/);
  assert.match(tagged.text, /@628000000003/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.hidetag' }),
  );

  const hidden = lastPayload(bot);
  assert.equal(hidden.mentions.length, bot.metadata.participants.length);
  assert.match(hidden.text, /Pengumuman/);
});

test('grup: groupinfo merangkum metadata grup', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.groupinfo' }),
  );

  const text = lastText(bot);
  assert.match(text, /Info Grup Uji/);
  assert.match(text, /Anggota: 3/);
  assert.match(text, /Admin: 2/);
  assert.match(text, /Grup untuk test/);
});

test('grup: welcome/goodbye mengatur saklar, teks kustom, dan reset', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.welcome' }),
  );
  assert.match(lastText(bot), /Status: \*nonaktif\*/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.welcome on' }),
  );
  assert.equal(bot.db.getGroupSetting(GROUP, 'welcome'), true);
  assert.match(lastText(bot), /diaktifkan/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.welcome set Halo {mention} di {group}' }),
  );
  assert.equal(bot.db.getGroupSetting(GROUP, 'welcome_text'), 'Halo {mention} di {group}');
  assert.match(lastText(bot), /disimpan/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.welcome reset' }),
  );
  assert.equal(bot.db.getGroupSetting(GROUP, 'welcome_text', null), null);
  assert.match(lastText(bot), /default/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: GROUP, sender: ADMIN, text: '.goodbye on' }),
  );
  assert.equal(bot.db.getGroupSetting(GROUP, 'goodbye'), true);
});

test('grup: welcome mengirim pesan saat anggota baru masuk', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  bot.db.setGroupSetting(GROUP, 'welcome', true);
  bot.db.setGroupSetting(GROUP, 'welcome_text', 'Halo {mention}, selamat datang di *{group}*');

  const events = createGroupEvents({
    config: bot.config,
    db: bot.db,
    logger: silentLogger,
    getGroupMetadata: bot.services.getGroupMetadata,
  });

  await events.handle(bot.sock, { id: GROUP, action: 'add', participants: [MEMBER] });

  assert.equal(bot.sent.length, 1);
  assert.equal(bot.sent[0].chatId, GROUP);
  assert.match(bot.sent[0].payload.text, /Halo @628000000003/);
  assert.match(bot.sent[0].payload.text, /Grup Uji/);
  assert.deepEqual(bot.sent[0].payload.mentions, [MEMBER]);
});

test('grup: goodbye tidak mengirim apa pun saat fitur mati', async (t) => {
  const bot = adminBot();
  t.after(() => bot.close());

  const events = createGroupEvents({
    config: bot.config,
    db: bot.db,
    logger: silentLogger,
    getGroupMetadata: bot.services.getGroupMetadata,
  });

  await events.handle(bot.sock, { id: GROUP, action: 'remove', participants: [MEMBER] });
  assert.equal(bot.sent.length, 0);
});
