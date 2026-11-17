const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../src/config');
const { createDatabase } = require('../src/core/database');
const { createRuntimeState } = require('../src/core/state');
const { CommandRegistry, loadCommands } = require('../src/core/registry');
const { createDefaultMiddlewares } = require('../src/core/middleware');
const { createMessageHandler } = require('../src/core/handler');
const { createMessageCache } = require('../src/core/messageCache');
const { AppError } = require('../src/core/errors');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
let messageCounter = 0;

function createTestBot({ configOverrides = {}, metadata, groupMetadataError = false } = {}) {
  const config = {
    ...loadConfig({
      OWNER_NUMBERS: '628111111111',
      LOG_LEVEL: 'silent',
      DEFAULT_LANG: 'id',
      COMMAND_COOLDOWN: '0',
      RATE_LIMIT_MAX: '100',
      RATE_LIMIT_WINDOW_MS: '60000',
    }),
    ...configOverrides,
  };

  const db = createDatabase({ config, filename: ':memory:' });
  const state = createRuntimeState({ config, db });
  const registry = new CommandRegistry();
  loadCommands(registry);

  const getGroupMetadata = async (sock, groupId) => {
    if (groupMetadataError) throw new Error('metadata gagal');
    return metadata || { id: groupId, subject: 'Grup Uji', participants: [] };
  };

  const messageCache = createMessageCache();

  const middlewares = createDefaultMiddlewares({
    config,
    db,
    state,
    getGroupMetadata,
    logger: silentLogger,
  });

  const handler = createMessageHandler({
    config,
    logger: silentLogger,
    registry,
    db,
    state,
    middlewares,
    services: { getGroupMetadata, messageCache },
  });

  const sent = [];
  const sock = {
    user: { id: '628999999999@s.whatsapp.net' },
    async sendMessage(chatId, payload, options) {
      sent.push({ chatId, payload, options });
      const message = typeof payload?.text === 'string'
        ? { extendedTextMessage: { text: payload.text } }
        : payload;
      return {
        key: { id: `out-${sent.length}`, remoteJid: chatId, fromMe: true },
        message,
      };
    },
  };

  return { config, db, state, registry, handler, sock, sent, messageCache };
}

function makeMessage({
  chatId = '628222222222@s.whatsapp.net',
  text = '.ping',
  sender = '628222222222@s.whatsapp.net',
  id,
  fromMe = false,
  content,
} = {}) {
  const isGroup = chatId.endsWith('@g.us');
  return {
    key: {
      remoteJid: chatId,
      fromMe,
      id: id || `m-${++messageCounter}`,
      ...(isGroup ? { participant: sender } : {}),
    },
    pushName: 'Tester',
    message: content || { conversation: text },
  };
}

function lastText(bot) {
  return bot.sent.at(-1)?.payload?.text || '';
}

/**
 * @param {() => boolean} check
 * @param {number} [timeoutMs]
 */
async function waitFor(check, timeoutMs = 2_000) {
  const started = Date.now();

  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('handler: menjalankan ping dan mencatat statistik', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.ping' }));

  assert.match(lastText(bot), /Pong/);
  assert.match(lastText(bot), /SQLite/);
  assert.equal(bot.db.getStat('command:total'), 1);
  assert.equal(bot.db.getStat('command:ping'), 1);
  assert.equal(bot.db.getUser('628222222222@s.whatsapp.net').command_count, 1);
});

test('handler: menu menyesuaikan role pengguna', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.menu' }));
  assert.match(lastText(bot), /\.ping/);
  assert.doesNotMatch(lastText(bot), /\.mode/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628111111111@s.whatsapp.net', text: '.menu' }),
  );
  assert.match(lastText(bot), /\.mode/);
});

test('handler: command tidak dikenal dibalas sekali per jendela waktu', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.tidakada' }));
  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.tidakada' }));

  assert.equal(bot.sent.length, 1);
  assert.match(lastText(bot), /tidak dikenal/);
  assert.equal(bot.db.getStat('command:unknown'), 1);
});

test('handler: mengabaikan pesan yang tidak relevan', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  const cases = [
    makeMessage({ fromMe: true }),
    makeMessage({ chatId: 'status@broadcast' }),
    makeMessage({ chatId: '123@newsletter' }),
    makeMessage({ chatId: '123@broadcast' }),
    makeMessage({ content: { reactionMessage: { text: '👍', key: {} } } }),
    makeMessage({ content: { protocolMessage: {} } }),
    makeMessage({ content: { pollUpdateMessage: {} } }),
    makeMessage({ text: 'halo tanpa prefix' }),
    makeMessage({ content: { conversation: '   ' } }),
    { key: { remoteJid: '628222222222@s.whatsapp.net', id: 'tanpa-message' } },
  ];

  for (const message of cases) {
    await bot.handler.handleMessage(bot.sock, message);
  }

  assert.equal(bot.sent.length, 0);
});

test('handler: deduplikasi berdasarkan message id', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  const message = makeMessage({ text: '.ping', id: 'pesan-sama' });
  await bot.handler.handleMessage(bot.sock, message);
  await bot.handler.handleMessage(bot.sock, message);

  assert.equal(bot.sent.length, 1);
});

test('handler: permission owner dan perubahan mode', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.mode self' }));
  assert.match(lastText(bot), /membutuhkan akses/);
  assert.equal(bot.state.mode, 'public');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628111111111@lid', text: '.mode self' }),
  );
  assert.match(lastText(bot), /membutuhkan akses/);
  assert.equal(bot.state.mode, 'public');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628111111111@s.whatsapp.net', text: '.mode self' }),
  );
  assert.equal(bot.state.mode, 'self');
  assert.match(lastText(bot), /diubah/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628111111111@s.whatsapp.net', text: '.mode public' }),
  );
  assert.equal(bot.state.mode, 'public');
});

test('handler: mode private membatasi grup dan DM', async (t) => {
  const metadata = {
    subject: 'Grup Uji',
    participants: [{ id: '628222222222@s.whatsapp.net', admin: 'admin' }],
  };
  const bot = createTestBot({ metadata });
  t.after(() => bot.db.close());

  bot.state.setMode('private');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '120363@g.us', sender: '628222222222@s.whatsapp.net', text: '.ping' }),
  );
  assert.match(lastText(bot), /Pong/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '120363@g.us', sender: '628333333333@s.whatsapp.net', text: '.ping' }),
  );
  assert.match(lastText(bot), /admin grup/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628111111111@s.whatsapp.net', text: '.ping' }),
  );
  assert.match(lastText(bot), /Pong/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628444444444@s.whatsapp.net', text: '.ping' }),
  );
  assert.match(lastText(bot), /chat pribadi/);
});

test('handler: maintenance memblokir non-owner kecuali command darurat', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  bot.state.setMaintenance(true);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628333333333@s.whatsapp.net', text: '.owner' }),
  );
  assert.match(lastText(bot), /maintenance/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628444444444@s.whatsapp.net', text: '.ping' }),
  );
  assert.match(lastText(bot), /Pong/);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628111111111@s.whatsapp.net', text: '.maintenance off' }),
  );
  assert.equal(bot.state.maintenance, false);
  assert.match(lastText(bot), /normal/);
});

test('handler: command admin grup', async (t) => {
  const metadata = {
    subject: 'Grup Uji',
    participants: [{ id: '628222222222@s.whatsapp.net', admin: 'admin' }],
  };
  const bot = createTestBot({ metadata });
  t.after(() => bot.db.close());

  bot.registry.register({
    name: 'adminonly',
    category: 'group',
    permission: 'admin',
    scope: 'group',
    cooldown: 0,
    execute: async () => 'admin ok',
  });

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '120363@g.us', sender: '628222222222@s.whatsapp.net', text: '.adminonly' }),
  );
  assert.equal(lastText(bot), 'admin ok');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '120363@g.us', sender: '628333333333@s.whatsapp.net', text: '.adminonly' }),
  );
  assert.match(lastText(bot), /membutuhkan akses/);
});

test('handler: error command tidak mematikan handler', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  bot.registry.register({
    name: 'failuser',
    cooldown: 0,
    execute: async () => {
      throw new AppError('FAIL_USER', 'detail internal', 'Pesan ramah untuk pengguna');
    },
  });

  bot.registry.register({
    name: 'failhard',
    cooldown: 0,
    execute: async () => {
      throw new Error('boom');
    },
  });

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.failuser' }));
  assert.equal(lastText(bot), 'Pesan ramah untuk pengguna');

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.failhard' }));
  assert.match(lastText(bot), /kesalahan/);

  assert.equal(bot.db.getStat('command:error'), 2);
});

test('handler: command timeout dibalas dengan pesan jelas', async (t) => {
  const bot = createTestBot({ configOverrides: { commandTimeoutMs: 30 } });
  t.after(() => bot.db.close());

  bot.registry.register({
    name: 'lambat',
    cooldown: 0,
    execute: () => new Promise(() => {}),
  });

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.lambat' }));

  assert.match(lastText(bot), /terlalu lama/);
  assert.equal(bot.db.getStat('command:error'), 1);
});

test('handler: timeout per command mengalahkan timeout global', async (t) => {
  const bot = createTestBot({ configOverrides: { commandTimeoutMs: 40 } });
  t.after(() => bot.db.close());

  bot.registry.register({
    name: 'berat',
    cooldown: 0,
    timeoutMs: 1_000,
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return 'selesai';
    },
  });

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.berat' }));

  assert.equal(lastText(bot), 'selesai');
  assert.equal(bot.db.getStat('command:error'), 0);
});

test('handler: kegagalan metadata grup tidak memblokir command', async (t) => {
  const bot = createTestBot({ groupMetadataError: true });
  t.after(() => bot.db.close());

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '120363@g.us', sender: '628222222222@s.whatsapp.net', text: '.ping' }),
  );

  assert.match(lastText(bot), /Pong/);
});

test('handler: mode self membisukan command tidak dikenal non-owner', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  bot.state.setMode('self');

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628222222222@s.whatsapp.net', text: '.tidakada' }),
  );
  assert.equal(bot.sent.length, 0);

  await bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628111111111@s.whatsapp.net', text: '.tidakada' }),
  );
  assert.match(lastText(bot), /tidak dikenal/);
});

test('handler: command mengembalikan string dan argumen diteruskan', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  bot.registry.register({
    name: 'echo',
    cooldown: 0,
    execute: async (ctx) => `kamu bilang: ${ctx.args.join(' ')}`,
  });

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.echo halo dunia' }));

  assert.equal(lastText(bot), 'kamu bilang: halo dunia');
});

test('handler: messages.upsert hanya memproses tipe notify', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  await bot.handler.handleUpsert(bot.sock, {
    type: 'append',
    messages: [makeMessage({ text: '.ping' })],
  });
  assert.equal(bot.sent.length, 0);

  const notify = {
    type: 'notify',
    messages: [makeMessage({ text: '.ping' })],
  };

  await bot.handler.handleUpsert(bot.sock, notify);
  assert.match(lastText(bot), /Pong/);
  assert.equal(bot.sent.length, 1);

  await bot.handler.handleUpsert(bot.sock, notify);
  assert.equal(bot.sent.length, 1);
});

test('handler: pesan dari chat yang sama diproses berurutan', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  let call = 0;
  bot.registry.register({
    name: 'lambat',
    cooldown: 0,
    execute: async (ctx) => {
      call += 1;
      const current = call;
      if (current === 1) await new Promise((resolve) => setTimeout(resolve, 40));
      return `${current}:${ctx.msg.key.id}`;
    },
  });

  await Promise.all([
    bot.handler.handleMessage(bot.sock, makeMessage({ text: '.lambat', id: 'urut-1' })),
    bot.handler.handleMessage(bot.sock, makeMessage({ text: '.lambat', id: 'urut-2' })),
  ]);

  assert.deepEqual(
    bot.sent.map((entry) => entry.payload.text),
    ['1:urut-1', '2:urut-2'],
  );
});

test('handler: chat berbeda tetap berjalan paralel', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  const started = [];
  const releases = new Map();

  bot.registry.register({
    name: 'tahan',
    cooldown: 0,
    execute: async (ctx) => {
      started.push(ctx.chatId);
      await new Promise((resolve) => releases.set(ctx.chatId, resolve));
      return 'selesai';
    },
  });

  const first = bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628222222222@s.whatsapp.net', text: '.tahan' }),
  );
  const second = bot.handler.handleMessage(
    bot.sock,
    makeMessage({ chatId: '628333333333@s.whatsapp.net', text: '.tahan' }),
  );

  await waitFor(() => started.length === 2);

  releases.get('628222222222@s.whatsapp.net')();
  releases.get('628333333333@s.whatsapp.net')();

  await Promise.all([first, second]);
  assert.deepEqual(started.sort(), ['628222222222@s.whatsapp.net', '628333333333@s.whatsapp.net']);
});

test('handler: antrean penuh melewati pesan baru tanpa menghentikan chat', async (t) => {
  const bot = createTestBot({ configOverrides: { queueMaxPending: 2 } });
  t.after(() => bot.db.close());

  let executed = 0;
  let release = null;

  bot.registry.register({
    name: 'blok',
    cooldown: 0,
    execute: async () => {
      executed += 1;
      if (executed === 1) {
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return 'ok';
    },
  });

  const first = bot.handler.handleMessage(bot.sock, makeMessage({ text: '.blok', id: 'blok-1' }));
  await waitFor(() => executed === 1);

  const second = bot.handler.handleMessage(bot.sock, makeMessage({ text: '.blok', id: 'blok-2' }));
  const dropped = bot.handler.handleMessage(bot.sock, makeMessage({ text: '.blok', id: 'blok-3' }));

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(bot.handler.queue.droppedCount(), 1);
  assert.equal(bot.handler.queue.pendingCount('628222222222@s.whatsapp.net'), 2);

  release();
  await Promise.all([first, second, dropped]);

  assert.equal(executed, 2);
  assert.equal(bot.handler.queue.pendingCount('628222222222@s.whatsapp.net'), 0);
});

test('handler: balasan disimpan untuk getMessage', async (t) => {
  const bot = createTestBot();
  t.after(() => bot.db.close());

  await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.ping' }));

  const sentEntry = bot.sent.at(-1);
  assert.ok(sentEntry);

  const cached = bot.messageCache.get({
    id: 'out-1',
    remoteJid: '628222222222@s.whatsapp.net',
  });

  assert.ok(cached);
  assert.equal(cached.extendedTextMessage.text, sentEntry.payload.text);
  assert.equal(bot.messageCache.get({ id: 'out-1', remoteJid: '628999999999@s.whatsapp.net' }), undefined);
});
