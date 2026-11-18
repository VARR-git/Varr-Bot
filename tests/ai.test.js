const test = require('node:test');
const assert = require('node:assert/strict');

const { AiService, redactSecrets } = require('../src/services/ai');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function errorResponse(status, message) {
  return { ok: false, status, json: async () => ({ error: { message } }) };
}

function geminiText(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function chatText(text) {
  return { choices: [{ message: { content: text } }] };
}

function makeConfig(overrides = {}) {
  return {
    enabled: true,
    geminiKeys: ['g-secret-key-123'],
    groqKeys: ['gr-secret-key-456'],
    openRouterKeys: ['or-secret-key-789'],
    primaryProvider: 'gemini',
    primaryModel: 'gemini-4-hydrogen',
    defaultModel: 'gemini-4-hydrogen',
    fallbacks: [
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
      { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    ],
    systemPrompt: '',
    maxTokens: 128,
    timeoutMs: 2_000,
    dailyQuotaPerUser: 0,
    ...overrides,
  };
}

function installFetch(mock) {
  const original = global.fetch;
  global.fetch = mock;
  return () => {
    global.fetch = original;
  };
}

test('ai: provider utama berhasil dipanggil', async (t) => {
  const calls = [];
  const restore = installFetch(async (url) => {
    calls.push(url);
    return jsonResponse(geminiText('Halo dari Gemini'));
  });
  t.after(restore);

  const service = new AiService(makeConfig(), { logger: silentLogger });
  const result = await service.generate({ messages: [{ role: 'user', content: 'halo' }] });

  assert.equal(result.provider, 'gemini');
  assert.equal(result.text, 'Halo dari Gemini');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /generativelanguage\.googleapis\.com/);
  assert.match(calls[0], /gemini-4-hydrogen/);
});

test('ai: fallback ke Groq saat Gemini mengembalikan 429', async (t) => {
  const calls = [];
  const restore = installFetch(async (url) => {
    calls.push(url);
    if (url.includes('generativelanguage')) return errorResponse(429, 'rate limit exceeded');
    if (url.includes('api.groq.com')) return jsonResponse(chatText('Jawaban dari Groq'));
    throw new Error(`provider tak terduga: ${url}`);
  });
  t.after(restore);

  const service = new AiService(makeConfig({ geminiKeys: ['g1', 'g2'] }), { logger: silentLogger });
  const result = await service.generate({ messages: [{ role: 'user', content: 'halo' }] });

  assert.equal(result.provider, 'groq');
  assert.equal(result.text, 'Jawaban dari Groq');
  assert.ok(calls.some((url) => url.includes('api.groq.com')), 'Groq harus dipanggil');
});

test('ai: fallback ke OpenRouter saat Gemini dan Groq mengembalikan 500', async (t) => {
  const restore = installFetch(async (url) => {
    if (url.includes('generativelanguage')) return errorResponse(500, 'internal error');
    if (url.includes('api.groq.com')) return errorResponse(500, 'internal error');
    if (url.includes('openrouter.ai')) return jsonResponse(chatText('Jawaban dari OpenRouter'));
    throw new Error(`provider tak terduga: ${url}`);
  });
  t.after(restore);

  const service = new AiService(makeConfig(), { logger: silentLogger });
  const result = await service.generate({ messages: [{ role: 'user', content: 'halo' }] });

  assert.equal(result.provider, 'openrouter');
  assert.equal(result.text, 'Jawaban dari OpenRouter');
});

test('ai: circuit breaker terbuka setelah kegagalan beruntun', async (t) => {
  const geminiCalls = [];
  const restore = installFetch(async (url) => {
    if (url.includes('generativelanguage')) {
      geminiCalls.push(url);
      return errorResponse(500, 'internal error');
    }
    return jsonResponse(chatText('Jawaban dari Groq'));
  });
  t.after(restore);

  const service = new AiService(makeConfig(), { logger: silentLogger });

  for (let i = 0; i < 3; i += 1) {
    const result = await service.generate({ messages: [{ role: 'user', content: 'halo' }] });
    assert.equal(result.provider, 'groq');
  }

  assert.equal(service.breaker('gemini').isOpen, true);
  assert.equal(geminiCalls.length, 3);

  // Panggilan ke-4 melewati Gemini karena breaker sudah terbuka.
  const result = await service.generate({ messages: [{ role: 'user', content: 'halo' }] });
  assert.equal(result.provider, 'groq');
  assert.equal(geminiCalls.length, 3);
});

test('ai: quota guard menolak setelah batas harian dan tidak membocorkan API key', async (t) => {
  const restore = installFetch(async () => jsonResponse(geminiText('ok')));
  t.after(restore);

  const service = new AiService(makeConfig({ dailyQuotaPerUser: 1 }), { logger: silentLogger });
  const scope = '120363000000000001@g.us|628000000003@s.whatsapp.net';

  const first = await service.generate({ messages: [{ role: 'user', content: 'halo' }] }, scope);
  assert.equal(first.text, 'ok');

  await assert.rejects(
    service.generate({ messages: [{ role: 'user', content: 'lagi' }] }, scope),
    (error) => {
      assert.equal(error.code, 'AI_QUOTA_EXCEEDED');
      assert.doesNotMatch(error.message, /secret-key/);
      assert.doesNotMatch(error.userMessage, /secret-key/);
      return true;
    },
  );
});

test('ai: pesan error provider dibersihkan dari API key', async (t) => {
  const restore = installFetch(async () => errorResponse(500, 'invalid key g-secret-key-123'));
  t.after(restore);

  const service = new AiService(makeConfig(), { logger: silentLogger });

  await assert.rejects(
    service.generate({ messages: [{ role: 'user', content: 'halo' }] }),
    (error) => {
      assert.doesNotMatch(error.message, /g-secret-key-123/);
      assert.doesNotMatch(error.userMessage, /g-secret-key-123/);
      return true;
    },
  );
});

test('ai: redactSecrets menyamarkan key lengkap dan ekor key', () => {
  assert.equal(redactSecrets('invalid key g-secret-key-123', ['g-secret-key-123']), 'invalid key [REDACTED]');
  assert.equal(
    redactSecrets('unauthorized abcdefghijklmnop', ['abcdefghijklmnop']),
    'unauthorized [REDACTED]',
  );
});
