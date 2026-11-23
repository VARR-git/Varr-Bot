const test = require('node:test');
const assert = require('node:assert/strict');

const { createGameManager, REWARDS } = require('../src/services/gameManager');
const ttt = require('../src/commands/games/ttt');
const hangman = require('../src/commands/games/hangman');
const trivia = require('../src/commands/games/trivia');

function makeDb() {
  const calls = { balance: [], xp: [] };
  return {
    calls,
    addBalance(jid, amount) { calls.balance.push([jid, amount]); },
    addXp(jid, amount) { calls.xp.push([jid, amount]); },
  };
}

function makeCtx({ chatId, senderId, args = [], gm, db }) {
  const replies = [];
  const ctx = {
    chatId,
    senderId,
    senderName: senderId.split('@')[0],
    text: '',
    args,
    rawArgs: args.join(' '),
    msg: { message: { conversation: args.join(' ') } },
    db,
    services: { gameManager: gm },
    t: (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    reply: async (message) => { replies.push(String(message)); return message; },
  };
  return { ctx, replies };
}

async function input(gm, chatId, senderId, text, senderName) {
  const replies = [];
  const consumed = await gm.handleInput({
    chatId,
    senderId,
    senderName,
    text,
    reply: async (message) => { replies.push(String(message)); },
  });
  return { consumed, replies };
}

const A = '628111111111@s.whatsapp.net';
const B = '628222222222@s.whatsapp.net';

test('state game terisolasi per chat', async () => {
  const gm = createGameManager();
  const dbA = makeDb();
  const dbB = makeDb();

  const startA = makeCtx({ chatId: 'grupA@g.us', senderId: A, args: [`@${B.split('@')[0]}`], gm, db: dbA });
  await ttt.execute(startA.ctx);

  const originalRandom = Math.random;
  Math.random = () => 0;
  const startB = makeCtx({ chatId: 'grupB@g.us', senderId: B, gm, db: dbB });
  await hangman.execute(startB.ctx);
  Math.random = originalRandom;

  assert.equal(gm.get('grupA@g.us').type, 'ttt');
  assert.equal(gm.get('grupB@g.us').type, 'hangman');

  await input(gm, 'grupA@g.us', A, '1');
  assert.equal(gm.get('grupA@g.us').type, 'ttt');
  assert.equal(gm.get('grupB@g.us').type, 'hangman');

  await gm.surrender({ chatId: 'grupA@g.us', senderId: A, reply: async () => {} });
  assert.equal(gm.isActive('grupA@g.us'), false);
  assert.equal(gm.isActive('grupB@g.us'), true);
});

test('Tic-Tac-Toe PvP: kemenangan memberi koin dan XP', async () => {
  const gm = createGameManager();
  const db = makeDb();
  const { ctx } = makeCtx({ chatId: 'g1@g.us', senderId: A, args: [`@${B.split('@')[0]}`], gm, db });

  await ttt.execute(ctx);
  assert.equal(gm.isActive('g1@g.us'), true);

  for (const [player, cell] of [[A, '1'], [B, '4'], [A, '2'], [B, '5'], [A, '3']]) {
    const result = await input(gm, 'g1@g.us', player, cell);
    assert.equal(result.consumed, true);
  }

  assert.equal(gm.isActive('g1@g.us'), false);
  assert.equal(db.calls.balance.filter(([, amount]) => amount === REWARDS.ttt.win).length, 1);
  assert.equal(db.calls.xp.filter(([, amount]) => amount === REWARDS.ttt.xp).length, 1);
});

test('Tic-Tac-Toe PvP: seri memberi koin ke kedua pemain', async () => {
  const gm = createGameManager();
  const db = makeDb();
  const { ctx } = makeCtx({ chatId: 'g2@g.us', senderId: A, args: [`@${B.split('@')[0]}`], gm, db });

  await ttt.execute(ctx);

  for (const [player, cell] of [
    [A, '1'], [B, '2'], [A, '3'], [B, '5'], [A, '4'],
    [B, '6'], [A, '8'], [B, '7'], [A, '9'],
  ]) {
    await input(gm, 'g2@g.us', player, cell);
  }

  assert.equal(gm.isActive('g2@g.us'), false);
  const drawRewards = db.calls.balance.filter(([, amount]) => amount === REWARDS.ttt.draw);
  assert.equal(drawRewards.length, 2);
});

test('Hangman: tebakan benar menyelesaikan game dan memberi hadiah', async () => {
  const gm = createGameManager();
  const db = makeDb();

  const originalRandom = Math.random;
  Math.random = () => 0;
  const { ctx } = makeCtx({ chatId: 'h1@g.us', senderId: A, gm, db });
  await hangman.execute(ctx);
  Math.random = originalRandom;

  const word = hangman.WORDS[0];

  const wrong = await input(gm, 'h1@g.us', A, 'z');
  assert.equal(wrong.consumed, true);
  assert.equal(gm.isActive('h1@g.us'), true);

  for (const letter of [...new Set(word)]) {
    await input(gm, 'h1@g.us', A, letter);
  }

  assert.equal(gm.isActive('h1@g.us'), false);
  assert.equal(db.calls.balance.filter(([, amount]) => amount === REWARDS.hangman.win).length, 1);
  assert.equal(db.calls.xp.filter(([, amount]) => amount === REWARDS.hangman.xp).length, 1);
});

test('Trivia: jawaban salah tidak menghadiahkan, jawaban benar pertama menghadiahkan', async () => {
  const gm = createGameManager();
  const db = makeDb();

  const originalRandom = Math.random;
  Math.random = () => 0;
  const { ctx } = makeCtx({ chatId: 't1@g.us', senderId: A, gm, db });
  await trivia.execute(ctx);
  Math.random = originalRandom;

  const question = trivia.BANK[0];

  const wrongIndex = (question.answer + 1) % 4;
  const wrongLetter = ['A', 'B', 'C', 'D'][wrongIndex];
  await input(gm, 't1@g.us', A, wrongLetter);

  assert.equal(gm.isActive('t1@g.us'), true);
  assert.equal(db.calls.balance.length, 0);

  const correctLetter = ['A', 'B', 'C', 'D'][question.answer];
  await input(gm, 't1@g.us', A, correctLetter);

  assert.equal(gm.isActive('t1@g.us'), false);
  assert.equal(db.calls.balance.filter(([, amount]) => amount === REWARDS.trivia.win).length, 1);
  assert.equal(db.calls.xp.filter(([, amount]) => amount === REWARDS.trivia.xp).length, 1);
});

test('nama pengirim dipakai di pesan game, bukan ID', async () => {
  const gm = createGameManager();
  const db = makeDb();

  const opponent = '249580935475411@lid';
  db.getUser = (jid) => jid === opponent ? { name: 'Siti' } : null;
  const startTtt = makeCtx({ chatId: 'n1@g.us', senderId: A, args: ['@249580935475411'], gm, db });
  startTtt.ctx.senderName = 'Budi';
  startTtt.ctx.msg.message = { extendedTextMessage: { contextInfo: { mentionedJid: [opponent] } } };
  await ttt.execute(startTtt.ctx);
  assert.match(startTtt.replies[0], /Budi/);
  assert.doesNotMatch(startTtt.replies[0], /628111111111/);
  const turn = await input(gm, 'n1@g.us', A, '1');
  assert.match(turn.replies[0], /"player":"Siti"/);
  assert.doesNotMatch(turn.replies[0], /249580935475411/);

  const originalRandom = Math.random;
  Math.random = () => 0;
  const startTrivia = makeCtx({ chatId: 'n2@g.us', senderId: A, gm, db });
  await trivia.execute(startTrivia.ctx);
  Math.random = originalRandom;

  const result = await input(gm, 'n2@g.us', opponent, 'A');
  assert.match(result.replies.at(-1), /"player":"Siti"/);
  assert.doesNotMatch(result.replies.at(-1), /249580935475411/);

  gm.dispose();
});

test('timeout membersihkan state game', async () => {
  const gm = createGameManager({ defaultTimeoutMs: 25 });
  const db = makeDb();
  const { ctx } = makeCtx({ chatId: 'to@g.us', senderId: A, gm, db });

  await ttt.execute(ctx);
  assert.equal(gm.isActive('to@g.us'), true);

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(gm.isActive('to@g.us'), false);
});
