const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeJid,
  jidToNumber,
  sameJid,
  isGroupJid,
  isStatusJid,
  isPhoneJid,
  maskJid,
  collectSenderIds,
} = require('../src/utils/jid');

test('jid: normalisasi dan konversi nomor', () => {
  assert.equal(normalizeJid('628123:4@s.whatsapp.net'), '628123@s.whatsapp.net');
  assert.equal(normalizeJid(' 628123@s.whatsapp.net '), '628123@s.whatsapp.net');
  assert.equal(normalizeJid(''), '');
  assert.equal(jidToNumber('628123:4@s.whatsapp.net'), '628123');
  assert.equal(jidToNumber('123@lid'), '123');
});

test('jid: perbandingan dan tipe JID', () => {
  assert.equal(sameJid('628123:2@s.whatsapp.net', '628123@s.whatsapp.net'), true);
  assert.equal(sameJid('628123@s.whatsapp.net', '628999@s.whatsapp.net'), false);
  assert.equal(sameJid('', '628123@s.whatsapp.net'), false);
  assert.equal(isGroupJid('123@g.us'), true);
  assert.equal(isGroupJid('123@s.whatsapp.net'), false);
  assert.equal(isStatusJid('status@broadcast'), true);
  assert.equal(isStatusJid('123@s.whatsapp.net'), false);
  assert.equal(isPhoneJid('628123@s.whatsapp.net'), true);
  assert.equal(isPhoneJid('628123'), true);
  assert.equal(isPhoneJid('141124270305300@lid'), false);
  assert.equal(isPhoneJid('123@g.us'), false);
});

test('jid: masking tidak membocorkan nomor penuh', () => {
  assert.equal(maskJid('6281234567890@s.whatsapp.net'), '6281****90@s.whatsapp.net');
  assert.equal(maskJid('12345@lid'), '***@lid');
  assert.equal(maskJid(''), '***@unknown');
});

test('jid: kumpulkan varian pengirim', () => {
  const groupMessage = {
    key: {
      participant: '111:3@lid',
      participantAlt: '628111@s.whatsapp.net',
      remoteJidAlt: '628999@s.whatsapp.net',
    },
  };

  const groupIds = collectSenderIds(groupMessage, '120363@g.us');
  assert.ok(groupIds.includes('111@lid'));
  assert.ok(groupIds.includes('628111@s.whatsapp.net'));
  assert.equal(groupIds.includes('120363@g.us'), false);

  const directIds = collectSenderIds(
    { key: { remoteJidAlt: '628222@s.whatsapp.net' } },
    '222@lid',
  );
  assert.ok(directIds.includes('628222@s.whatsapp.net'));
  assert.ok(directIds.includes('222@lid'));

  assert.deepEqual(collectSenderIds({ key: {} }, ''), []);
});
