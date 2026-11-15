const test = require('node:test');
const assert = require('node:assert/strict');

const { createMessageCache } = require('../src/core/messageCache');

test('message cache: simpan dan ambil berdasarkan chat + id', () => {
  const cache = createMessageCache();

  assert.equal(cache.set({ remoteJid: '628111@s.whatsapp.net', id: 'm1' }, { conversation: 'halo' }), true);
  assert.deepEqual(cache.get({ remoteJid: '628111@s.whatsapp.net', id: 'm1' }), { conversation: 'halo' });
  assert.equal(cache.size(), 1);

  // ID sama di chat berbeda tidak boleh tertukar.
  assert.equal(cache.get({ remoteJid: '628222@s.whatsapp.net', id: 'm1' }), undefined);

  assert.equal(cache.set({ remoteJid: '628111@s.whatsapp.net' }, { conversation: 'x' }), false);
  assert.equal(cache.set(null, { conversation: 'x' }), false);
  assert.equal(cache.get(null), undefined);
  assert.equal(cache.get({ id: 'm1' }), undefined);
});

test('message cache: TTL menghapus entri kedaluwarsa', () => {
  let clock = 1_000;
  const cache = createMessageCache({ ttlMs: 1_000, now: () => clock });
  const key = { remoteJid: '628111@s.whatsapp.net', id: 'm1' };

  cache.set(key, { conversation: 'halo' });
  assert.ok(cache.get(key));

  clock = 1_999;
  assert.ok(cache.get(key));

  clock = 2_000;
  assert.equal(cache.get(key), undefined);
  assert.equal(cache.size(), 0);
});

test('message cache: entri tertua dibuang saat penuh', () => {
  const cache = createMessageCache({ max: 2 });

  cache.set({ remoteJid: 'c', id: 'a' }, { conversation: 'a' });
  cache.set({ remoteJid: 'c', id: 'b' }, { conversation: 'b' });
  cache.set({ remoteJid: 'c', id: 'c' }, { conversation: 'c' });

  assert.equal(cache.size(), 2);
  assert.equal(cache.get({ remoteJid: 'c', id: 'a' }), undefined);
  assert.ok(cache.get({ remoteJid: 'c', id: 'b' }));
  assert.ok(cache.get({ remoteJid: 'c', id: 'c' }));
});

test('message cache: penulisan ulang memperbarui posisi recency', () => {
  const cache = createMessageCache({ max: 2 });

  cache.set({ remoteJid: 'c', id: 'a' }, { conversation: 'a1' });
  cache.set({ remoteJid: 'c', id: 'b' }, { conversation: 'b' });
  cache.set({ remoteJid: 'c', id: 'a' }, { conversation: 'a2' });
  cache.set({ remoteJid: 'c', id: 'c' }, { conversation: 'c' });

  assert.equal(cache.get({ remoteJid: 'c', id: 'b' }), undefined);
  assert.deepEqual(cache.get({ remoteJid: 'c', id: 'a' }), { conversation: 'a2' });
  assert.deepEqual(cache.get({ remoteJid: 'c', id: 'c' }), { conversation: 'c' });

  cache.clear();
  assert.equal(cache.size(), 0);
});

test('message cache: prune manual membuang entri kedaluwarsa', () => {
  let clock = 0;
  const cache = createMessageCache({ ttlMs: 100, now: () => clock });

  cache.set({ remoteJid: 'c', id: 'a' }, { conversation: 'a' });
  clock = 200;
  cache.prune();

  assert.equal(cache.size(), 0);
});
