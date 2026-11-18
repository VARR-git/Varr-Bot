const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Mock `src/utils/chatbot` BEFORE loading the modules under test.
//
// Both the `.chatbot` command and the message handler destructure the helpers
// at require time, so the cache entry must be replaced first. The mock keeps
// state in memory, which lets every test control exactly which chat is on/off
// without depending on the real database implementation.
// ---------------------------------------------------------------------------
const chatbotStore = new Map();
const chatbotUtilsPath = require.resolve('../src/utils/chatbot.js');

require.cache[chatbotUtilsPath] = {
  id: chatbotUtilsPath,
  filename: chatbotUtilsPath,
  loaded: true,
  exports: {
    isChatbotEnabled(_db, chatId) {
      return chatbotStore.get(chatId) === true;
    },
    setChatbotEnabled(_db, chatId, _isGroup, enabled) {
      chatbotStore.set(chatId, Boolean(enabled));
    },
  },
};

const translate = require('../src/commands/ai/translate.js');
const chatbot = require('../src/commands/ai/chatbot.js');
const { createMessageHandler } = require('../src/core/handler.js');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const BOT_ID = '628000000000@s.whatsapp.net';
const PRIVATE_CHAT = '628111111111@s.whatsapp.net';
const GROUP_CHAT = '123456789@g.us';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
function makeMessage(overrides = {}) {
  return {
    key: { remoteJid: PRIVATE_CHAT, fromMe: false, id: `MSG-${Math.random()}` },
    message: { conversation: 'hello world' },
    ...overrides,
  };
}

function makeSocket() {
  const sent = [];
  const sock = {
    user: { id: BOT_ID, lid: 'bot@lid' },
    sendMessage: async (...args) => {
      sent.push(args);
      return { key: { id: `SENT-${sent.length}` } };
    },
  };
  return { sock, sent };
}

function makeDb() {
  return {
    audit() {},
    incrementStat() {},
    incrementUserCommands() {},
    incrementGroupCommands() {},
    isGroupBanned() {
      return false;
    },
    isUserBanned() {
      return false;
    },
  };
}

/**
 * Build a command context shaped like the one `handler.js` passes to commands.
 */
function makeCommandContext({
  args = [],
  msg = makeMessage(),
  aiGenerate,
  isGroup = false,
  role = 'user',
  chatId = PRIVATE_CHAT,
} = {}) {
  const generateCalls = [];
  const reactions = [];
  const audits = [];

  const ai = {
    config: { enabled: true },
    generate:
      aiGenerate ||
      (async (payload) => {
        generateCalls.push(payload);
        return { text: 'translated text' };
      }),
  };

  const ctx = {
    args,
    msg,
    prefix: '.',
    command: { name: 'translate' },
    chatId,
    senderId: '628222222222@s.whatsapp.net',
    isGroup,
    role,
    services: { ai },
    logger: silentLogger,
    db: { ...makeDb(), audit: (entry) => audits.push(entry) },
    react: async (emoji) => reactions.push(emoji),
    t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  };

  return { ctx, generateCalls, reactions, audits };
}

function makeHandler() {
  const { sock, sent } = makeSocket();
  const aiCalls = [];

  const handler = createMessageHandler({
    config: {
      prefix: '.',
      prefixes: ['.', '!', '/'],
      ownerNumbers: [],
      defaultLang: 'en',
      commandTimeoutMs: 2_000,
      queueMaxPending: 10,
    },
    logger: silentLogger,
    registry: { get: () => null },
    db: makeDb(),
    state: { mode: 'public', maintenance: false },
    services: {
      ai: {
        config: { enabled: true },
        generate: async (payload, scope) => {
          const content = payload.messages[payload.messages.length - 1].content;
          aiCalls.push({ payload, scope });
          return { text: `AI:${content}` };
        },
      },
      aiMemory: {
        get: () => [],
        append: () => {},
      },
    },
    middlewares: [],
  });

  return { handler, sock, sent, aiCalls };
}

beforeEach(() => {
  chatbotStore.clear();
});

// ===========================================================================
// `.translate`
// ===========================================================================
describe('translate command', () => {
  test('translates direct text and returns the AI result', async () => {
    const { ctx, generateCalls, reactions } = makeCommandContext({
      args: ['en', 'selamat', 'pagi'],
    });

    const result = await translate.execute(ctx);

    assert.equal(result, 'translated text');
    assert.equal(generateCalls.length, 1);
    assert.match(generateCalls[0].system, /to en/i);
    assert.deepEqual(generateCalls[0].messages, [{ role: 'user', content: 'selamat pagi' }]);
    assert.deepEqual(reactions, ['⏳', '✅']);
  });

  test('defaults to Indonesian for a single argument', async () => {
    const { ctx, generateCalls } = makeCommandContext({ args: ['good morning'] });

    await translate.execute(ctx);

    assert.match(generateCalls[0].system, /to id/i);
    assert.equal(generateCalls[0].messages[0].content, 'good morning');
  });

  test('translates the replied message using the requested language', async () => {
    const { ctx, generateCalls } = makeCommandContext({
      args: ['en'],
      msg: makeMessage({
        message: {
          extendedTextMessage: {
            text: '.translate en',
            contextInfo: {
              quotedMessage: { conversation: 'hola mundo' },
            },
          },
        },
      }),
    });

    const result = await translate.execute(ctx);

    assert.equal(result, 'translated text');
    assert.match(generateCalls[0].system, /to en/i);
    assert.equal(generateCalls[0].messages[0].content, 'hola mundo');
  });

  test('translates a replied message with the default language when no argument is given', async () => {
    const { ctx, generateCalls } = makeCommandContext({
      args: [],
      msg: makeMessage({
        message: {
          extendedTextMessage: {
            text: '.translate',
            contextInfo: {
              quotedMessage: { conversation: 'good morning' },
            },
          },
        },
      }),
    });

    await translate.execute(ctx);

    assert.match(generateCalls[0].system, /to id/i);
    assert.equal(generateCalls[0].messages[0].content, 'good morning');
  });

  test('returns the usage message when there is no text and no reply', async () => {
    const { ctx, generateCalls } = makeCommandContext({ args: [] });

    const result = await translate.execute(ctx);

    assert.match(result, /^translate\.usage/);
    assert.equal(generateCalls.length, 0);
  });
});

// ===========================================================================
// `.chatbot on|off|status`
// ===========================================================================
describe('chatbot command', () => {
  test('enables chatbot in a private chat and persists the status', async () => {
    const { ctx, audits } = makeCommandContext({ args: ['on'], chatId: PRIVATE_CHAT });

    const result = await chatbot.execute(ctx);

    assert.equal(chatbotStore.get(PRIVATE_CHAT), true);
    assert.equal(result, 'chatbot.enabled');
    assert.deepEqual(audits, [
      { actor: ctx.senderId, action: 'chatbot.on', target: PRIVATE_CHAT },
    ]);
  });

  test('disables chatbot and persists the status', async () => {
    chatbotStore.set(PRIVATE_CHAT, true);
    const { ctx, audits } = makeCommandContext({ args: ['off'], chatId: PRIVATE_CHAT });

    const result = await chatbot.execute(ctx);

    assert.equal(chatbotStore.get(PRIVATE_CHAT), false);
    assert.equal(result, 'chatbot.disabled');
    assert.deepEqual(audits, [
      { actor: ctx.senderId, action: 'chatbot.off', target: PRIVATE_CHAT },
    ]);
  });

  test('reports the current status', async () => {
    chatbotStore.set(PRIVATE_CHAT, true);
    const { ctx } = makeCommandContext({ args: ['status'], chatId: PRIVATE_CHAT });

    const result = await chatbot.execute(ctx);

    assert.match(result, /^chatbot\.status/);
    assert.match(result, /common\.enabled/);
  });

  test('blocks non-admin users from toggling in a group', async () => {
    const { ctx, audits } = makeCommandContext({
      args: ['on'],
      isGroup: true,
      role: 'user',
      chatId: GROUP_CHAT,
    });

    const result = await chatbot.execute(ctx);

    assert.match(result, /^errors\.permission/);
    assert.equal(chatbotStore.has(GROUP_CHAT), false);
    assert.equal(audits.length, 0);
  });

  test('allows group admins to toggle in a group', async () => {
    const { ctx, audits } = makeCommandContext({
      args: ['on'],
      isGroup: true,
      role: 'admin',
      chatId: GROUP_CHAT,
    });

    const result = await chatbot.execute(ctx);

    assert.equal(chatbotStore.get(GROUP_CHAT), true);
    assert.equal(result, 'chatbot.enabled');
    assert.equal(audits[0].action, 'chatbot.on');
  });

  test('allows the owner to toggle in a group', async () => {
    const { ctx } = makeCommandContext({
      args: ['on'],
      isGroup: true,
      role: 'owner',
      chatId: GROUP_CHAT,
    });

    const result = await chatbot.execute(ctx);

    assert.equal(chatbotStore.get(GROUP_CHAT), true);
    assert.equal(result, 'chatbot.enabled');
  });
});

// ===========================================================================
// Chatbot integration in `handler.js`
// ===========================================================================
describe('handler chatbot integration', () => {
  test('replies automatically to non-command messages in private chat', async () => {
    chatbotStore.set(PRIVATE_CHAT, true);
    const { handler, sock, sent, aiCalls } = makeHandler();

    await handler.handleMessage(
      sock,
      makeMessage({
        key: { remoteJid: PRIVATE_CHAT, fromMe: false, id: 'PRIV-1' },
        message: { conversation: 'how are you' },
      }),
    );

    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].payload.messages.at(-1).content, 'how are you');
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], PRIVATE_CHAT);
    assert.deepEqual(sent[0][1], { text: 'AI:how are you' });
  });

  test('does not reply in private chat when chatbot is disabled', async () => {
    const { handler, sock, sent, aiCalls } = makeHandler();

    await handler.handleMessage(
      sock,
      makeMessage({
        key: { remoteJid: PRIVATE_CHAT, fromMe: false, id: 'PRIV-OFF' },
        message: { conversation: 'how are you' },
      }),
    );

    assert.equal(aiCalls.length, 0);
    assert.equal(sent.length, 0);
  });

  test('replies in groups when the bot is mentioned', async () => {
    chatbotStore.set(GROUP_CHAT, true);
    const { handler, sock, sent, aiCalls } = makeHandler();

    await handler.handleMessage(
      sock,
      makeMessage({
        key: { remoteJid: GROUP_CHAT, fromMe: false, id: 'GROUP-MENTION' },
        message: {
          extendedTextMessage: {
            text: '@bot hello there',
            contextInfo: { mentionedJid: [BOT_ID] },
          },
        },
      }),
    );

    assert.equal(aiCalls.length, 1);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0][1], { text: 'AI:@bot hello there' });
  });

  test('replies in groups when replying to a bot message', async () => {
    chatbotStore.set(GROUP_CHAT, true);
    const { handler, sock, sent, aiCalls } = makeHandler();

    await handler.handleMessage(
      sock,
      makeMessage({
        key: { remoteJid: GROUP_CHAT, fromMe: false, id: 'GROUP-REPLY' },
        message: {
          extendedTextMessage: {
            text: 'are you sure?',
            contextInfo: {
              participant: BOT_ID,
              stanzaId: 'BOT-MSG',
              quotedMessage: { conversation: 'previous bot answer' },
            },
          },
        },
      }),
    );

    assert.equal(aiCalls.length, 1);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0][1], { text: 'AI:are you sure?' });
  });

  test('ignores regular group messages without mention or reply', async () => {
    chatbotStore.set(GROUP_CHAT, true);
    const { handler, sock, sent, aiCalls } = makeHandler();

    await handler.handleMessage(
      sock,
      makeMessage({
        key: { remoteJid: GROUP_CHAT, fromMe: false, id: 'GROUP-PLAIN' },
        message: { conversation: 'random group chatter' },
      }),
    );

    assert.equal(aiCalls.length, 0);
    assert.equal(sent.length, 0);
  });
});
