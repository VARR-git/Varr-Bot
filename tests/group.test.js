const test = require('node:test');
const assert = require('node:assert/strict');

const { isParticipantAdmin, createGroupMetadataCache } = require('../src/utils/group');

const metadata = {
  participants: [
    { id: '111@lid', phoneNumber: '628111@s.whatsapp.net', admin: 'admin' },
    { id: '222@lid', phoneNumber: '628222@s.whatsapp.net', admin: 'superadmin' },
    { id: '333@lid', phoneNumber: '628333@s.whatsapp.net', admin: null },
    { id: '444@lid', phoneNumber: '628444@s.whatsapp.net', isAdmin: true },
  ],
};

test('group: admin terdeteksi lewat LID, phone number, dan flag', () => {
  assert.equal(isParticipantAdmin(metadata, ['111@lid']), true);
  assert.equal(isParticipantAdmin(metadata, ['628222@s.whatsapp.net']), true);
  assert.equal(isParticipantAdmin(metadata, ['628444@s.whatsapp.net']), true);
  assert.equal(isParticipantAdmin(metadata, ['333@lid']), false);
  assert.equal(isParticipantAdmin(metadata, ['999@lid']), false);
  assert.equal(isParticipantAdmin(null, ['111@lid']), false);
  assert.equal(isParticipantAdmin({ participants: [] }, ['111@lid']), false);
});

test('group: LID tidak bisa menyamar sebagai admin lewat nomor yang sama', () => {
  const crossDomain = {
    participants: [
      { id: '999@lid', phoneNumber: '123@s.whatsapp.net', admin: 'admin' },
    ],
  };

  assert.equal(isParticipantAdmin(crossDomain, ['123@lid']), false);
  assert.equal(isParticipantAdmin(crossDomain, ['123@s.whatsapp.net']), true);
  assert.equal(isParticipantAdmin(crossDomain, ['123']), true);
});

test('group: cache metadata dan invalidasi', async () => {
  let calls = 0;
  const sock = {
    async groupMetadata(groupId) {
      calls += 1;
      return { id: groupId, subject: `Grup ${calls}` };
    },
  };

  const cache = createGroupMetadataCache({ ttlMs: 60_000 });

  const first = await cache(sock, 'g1@g.us');
  const second = await cache(sock, 'g1@g.us');
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(cache.size(), 1);

  cache.invalidate('g1@g.us');
  const third = await cache(sock, 'g1@g.us');
  assert.equal(calls, 2);
  assert.notEqual(third, first);

  cache.clear();
  assert.equal(cache.size(), 0);
});

test('group: kegagalan fetch tidak di-cache', async () => {
  let calls = 0;
  const sock = {
    async groupMetadata() {
      calls += 1;
      throw new Error('gagal');
    },
  };

  const cache = createGroupMetadataCache({ ttlMs: 60_000 });

  await assert.rejects(() => cache(sock, 'g2@g.us'), /gagal/);
  await assert.rejects(() => cache(sock, 'g2@g.us'), /gagal/);
  assert.equal(calls, 2);
  assert.equal(cache.size(), 0);
});
