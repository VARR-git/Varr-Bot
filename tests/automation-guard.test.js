const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAutomation, DAILY_LIMIT, TTL } = require('../src/core/automation');
const { extraViolation } = require('../src/services/guard');

test('broadcast kill switch cancels a batch; attempts are capped through midnight UTC', async () => {
  let now = 0;
  const automation = createAutomation(() => now);
  let sent = 0;
  const send = () => { sent += 1; };
  assert.equal(await automation.broadcast(['a'], send), 'disabled');
  automation.toggle('broadcast', true);
  assert.equal(await automation.broadcast(['a', 'b'], send, async (delay) => {
    assert.ok(delay >= 2000 && delay <= 4000);
    automation.toggle('broadcast', false);
  }), 1);
  assert.equal(sent, 1);
  automation.toggle('broadcast', true);
  assert.equal(await automation.broadcast(Array(DAILY_LIMIT - 1).fill('a'), send, async () => {}), DAILY_LIMIT - 1);
  assert.equal(await automation.broadcast(['b'], send), 'quota');
  now += 86_400_000;
  assert.equal(await automation.broadcast(['b'], send), 1);
});

test('antidelete restores once to the same chat and only for the original sender before TTL', async () => {
  let now = 0;
  const automation = createAutomation(() => now);
  const remoteJid = '123@g.us';
  const participant = '628123@s.whatsapp.net';
  const key = { id: 'old', remoteJid, participant };
  const content = { conversation: 'hello' };
  const revoke = { type: 0, key };
  const msg = { key: { remoteJid, participant } };
  const sends = [];
  const sock = { sendMessage: async (...args) => sends.push(args) };
  const t = (name, args) => args.sender;
  automation.remember({ key, message: content }, content);
  await automation.restore(sock, { key: { ...msg.key, participant: '222@s.whatsapp.net' } }, revoke, t);
  await automation.restore(sock, msg, { ...revoke, key: { ...key, remoteJid: '999@g.us' } }, t);
  assert.equal(sends.length, 0);
  now = TTL - 1;
  await automation.restore(sock, msg, revoke, t);
  await automation.restore(sock, msg, revoke, t);
  assert.deepEqual(sends, [[remoteJid, { text: '628123\nhello' }]]);
  automation.remember({ key, message: content }, content);
  now += TTL;
  await automation.restore(sock, msg, revoke, t);
  assert.equal(sends.length, 1);
  automation.dispose();
});

test('badword matches whole normalized words and antitagall counts unique mentions', () => {
  const six = Array.from({ length: 6 }, (_, i) => `${i + 1}@s.whatsapp.net`);
  assert.equal(extraViolation('ＨＥＹ!', [], ['hey'], false), 'badword');
  assert.equal(extraViolation('heyday', [], ['hey'], false), undefined);
  assert.equal(extraViolation('', six, [], true), 'tagall');
  assert.equal(extraViolation('', [...six.slice(1), six[1]], [], true), undefined);
  assert.equal(extraViolation('', six, [], false), undefined);
});

test('anticall rejects and warns only for incoming private offers and only while enabled', async () => {
  const automation = createAutomation();
  const from = '628123@s.whatsapp.net';
  const offer = { id: 'test', from, status: 'offer' };
  const seen = [];
  const sock = {
    rejectCall: async (...args) => seen.push(args),
    sendMessage: async (...args) => seen.push(args),
  };
  await automation.rejectCalls(sock, [offer], 'warning');
  assert.deepEqual(seen, []);
  automation.toggle('anticall', true);
  await automation.rejectCalls(sock, [{ ...offer, status: 'reject' }, { ...offer, isGroup: true }, offer], 'warning');
  assert.deepEqual(seen, [['test', from], [from, { text: 'warning' }]]);
  automation.toggle('anticall', false);
  await automation.rejectCalls(sock, [offer], 'warning');
  assert.equal(seen.length, 2);
});
