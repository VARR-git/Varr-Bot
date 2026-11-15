const test = require('node:test');
const assert = require('node:assert/strict');

const { createChatQueue } = require('../src/core/queue');

const silentLogger = { warn() {} };

/**
 * @param {() => boolean} check
 * @param {number} [timeoutMs]
 */
async function waitFor(check, timeoutMs = 2_000) {
  const started = Date.now();

  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('queue: task pada chat yang sama berurutan', async () => {
  const queue = createChatQueue({ logger: silentLogger });
  const order = [];

  const first = queue.run('chat-a', async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('pertama');
  });

  const second = queue.run('chat-a', async () => {
    order.push('kedua');
  });

  await Promise.all([first, second]);

  assert.deepEqual(order, ['pertama', 'kedua']);
  assert.equal(queue.size(), 0);
  assert.equal(queue.pendingCount('chat-a'), 0);
});

test('queue: chat berbeda berjalan paralel', async () => {
  const queue = createChatQueue({ logger: silentLogger });
  const started = [];
  const releases = new Map();

  const run = (chat) => queue.run(chat, async () => {
    started.push(chat);
    await new Promise((resolve) => releases.set(chat, resolve));
  });

  const first = run('chat-a');
  const second = run('chat-b');

  await waitFor(() => started.length === 2);

  releases.get('chat-a')();
  releases.get('chat-b')();
  await Promise.all([first, second]);
});

test('queue: error pada satu task tidak memutus rantai chat', async () => {
  const queue = createChatQueue({ logger: silentLogger });
  const order = [];

  const failing = queue.run('chat-a', async () => {
    order.push('gagal');
    throw new Error('boom');
  });

  const next = queue.run('chat-a', async () => {
    order.push('lanjut');
    return 'ok';
  });

  await assert.rejects(() => failing, /boom/);
  assert.deepEqual(await next, { ran: true, value: 'ok' });
  assert.deepEqual(order, ['gagal', 'lanjut']);
  assert.equal(queue.size(), 0);
});

test('queue: batas antrean per chat', async () => {
  const queue = createChatQueue({ maxPending: 2, logger: silentLogger });

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const running = queue.run('chat-a', () => gate);
  const queued = queue.run('chat-a', async () => 'kedua');
  const dropped = await queue.run('chat-a', async () => 'ketiga');

  assert.deepEqual(dropped, { ran: false, reason: 'chat-full' });
  assert.equal(queue.droppedCount(), 1);
  assert.equal(queue.pendingCount('chat-a'), 2);

  release();
  await Promise.all([running, queued]);

  assert.equal(queue.pendingCount('chat-a'), 0);
  assert.equal(queue.size(), 0);
});

test('queue: batas chat aktif bersamaan', async () => {
  const queue = createChatQueue({ maxChats: 1, logger: silentLogger });

  const blocker = new Promise(() => {});
  queue.run('chat-a', () => blocker);

  const dropped = await queue.run('chat-b', async () => 'x');

  assert.deepEqual(dropped, { ran: false, reason: 'too-many-chats' });
  assert.equal(queue.droppedCount(), 1);

  queue.clear();
});

test('queue: drain menunggu task selesai', async () => {
  const queue = createChatQueue({ logger: silentLogger });
  let finished = false;

  queue.run('chat-a', async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    finished = true;
  });

  assert.equal(await queue.drain(1_000), true);
  assert.equal(finished, true);
});

test('queue: drain melaporkan timeout', async () => {
  const queue = createChatQueue({ logger: silentLogger });

  queue.run('chat-a', () => new Promise(() => {}));

  assert.equal(await queue.drain(20), false);
  queue.clear();
});
