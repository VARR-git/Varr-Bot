/**
 * Layanan AI multi-provider (Phase 3).
 *
 * Urutan fallback: Gemini utama -> Groq -> OpenRouter.
 * Fitur:
 * - Key pool + rotation (pindah key saat 429/rate limit).
 * - Timeout per request, retry ringan, circuit breaker sederhana.
 * - Daily quota guard per user/chat (in-memory + SQLite opsional).
 * - Redaksi API key agar tidak bocor ke error/logger.
 *
 * CommonJS, hanya memakai global fetch (Node.js 22).
 */

const { AppError } = require('../core/errors');

const DEFAULT_ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

const REDACT_MARK = '[REDACTED]';

/**
 * Redaksi key dari string apa pun. Mencari key persis dan potongan panjangnya.
 *
 * @param {string} input
 * @param {string[]} keys
 * @returns {string}
 */
function redactSecrets(input, keys = []) {
  let out = String(input ?? '');
  for (const key of keys) {
    if (!key) continue;
    out = out.split(key).join(REDACT_MARK);
    // Redaksi juga 8 karakter terakhir bila key terlalu panjang untuk dicari utuh.
    if (key.length >= 12) {
      const tail = key.slice(-8);
      if (tail) out = out.split(tail).join(REDACT_MARK);
    }
  }
  return out;
}

/**
 * Sederhanakan header/body error agar tidak membocorkan rahasia.
 *
 * @param {unknown} err
 * @param {string[]} keys
 * @returns {string}
 */
function describeError(err, keys) {
  const message = err instanceof Error ? err.message : String(err);
  return redactSecrets(message, keys);
}

class CircuitBreaker {
  /**
   * @param {{failureThreshold?: number, resetMs?: number}} [options]
   */
  constructor({ failureThreshold = 3, resetMs = 30_000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetMs = resetMs;
    this.failures = 0;
    this.openUntil = 0;
  }

  get isOpen() {
    return Date.now() < this.openUntil;
  }

  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openUntil = Date.now() + this.resetMs;
    }
  }

  recordSuccess() {
    this.failures = 0;
    this.openUntil = 0;
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {unknown} err
 * @returns {boolean} true bila error menandakan rate limit (429).
 */
function isRateLimit(err) {
  return Boolean(
    err &&
      (typeof err.status === 'number' ? err.status === 429 : false ||
        /429|rate.?limit|quota/i.test(err instanceof Error ? err.message : String(err))),
  );
}

/**
 * @param {unknown} err
 * @returns {boolean} true bila error boleh di-retry ringan.
 */
function isRetryable(err) {
  const status = err && typeof err.status === 'number' ? err.status : 0;
  if (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network|socket|abort/i.test(
    err instanceof Error ? err.message : String(err),
  );
}

/**
 * Adaptor per provider: membangun request dan mengekstrak teks respons.
 * Masing-masing kembali memakai global fetch.
 */
const PROVIDERS = {
  async gemini({ model, messages, system, maxTokens, timeoutMs, key }) {
    const url = DEFAULT_ENDPOINTS.gemini.replace('{model}', encodeURIComponent(model));
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${url}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json?.error?.message || `Gemini HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const text = json?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || '')
        .join('')
        .trim();
      if (!text) throw new Error('Gemini mengembalikan respons kosong');
      return text;
    } finally {
      clearTimeout(timer);
    }
  },

  async groq({ model, messages, system, maxTokens, timeoutMs, key }) {
    return PROVIDERS.openaiCompatible({
      url: DEFAULT_ENDPOINTS.groq,
      model,
      messages,
      system,
      maxTokens,
      timeoutMs,
      key,
      label: 'Groq',
    });
  },

  async openrouter({ model, messages, system, maxTokens, timeoutMs, key }) {
    return PROVIDERS.openaiCompatible({
      url: DEFAULT_ENDPOINTS.openrouter,
      model,
      messages,
      system,
      maxTokens,
      timeoutMs,
      key,
      label: 'OpenRouter',
    });
  },

  async openaiCompatible({ url, model, messages, system, maxTokens, timeoutMs, key, label }) {
    const payload = messages.map((m) => ({ role: m.role, content: m.content }));
    if (system) payload.unshift({ role: 'system', content: system });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: payload,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json?.error?.message || `${label} HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const text = json?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error(`${label} mengembalikan respons kosong`);
      return text;
    } finally {
      clearTimeout(timer);
    }
  },
};

class AiService {
  /**
   * @param {object} config - config.ai dari src/config
   * @param {{logger?: object, db?: object}} [deps]
   */
  constructor(config, { logger, db } = {}) {
    this.config = config;
    this.logger = logger;
    this.db = db || null;

    this.providers = [
      { name: 'gemini', keys: config.geminiKeys || [] },
      { name: 'groq', keys: config.groqKeys || [] },
      { name: 'openrouter', keys: config.openRouterKeys || [] },
    ];

    // Provider utama diletakkan paling depan bila bukan gemini.
    this.order = this.buildOrder(config.primaryProvider);

    this.breakers = new Map();
    this.keyIndex = new Map(); // provider -> index key aktif
    this.quota = new Map(); // "chatId|userId" -> { date: 'YYYY-MM-DD', used: number }
  }

  buildOrder(primaryProvider) {
    const known = ['gemini', 'groq', 'openrouter'];
    const primary = known.includes(primaryProvider) ? primaryProvider : 'gemini';
    const rest = known.filter((p) => p !== primary);
    // Urutan akhir: primary dulu, lalu sisanya. Fallback tetap gemini->groq->openrouter
    // ketika primary bukan gemini, tetapi diputar agar primary selalu pertama.
    return [primary, ...rest];
  }

  get allKeys() {
    const keys = [];
    for (const p of this.providers) keys.push(...(p.keys || []));
    return keys;
  }

  breaker(name) {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker());
    }
    return this.breakers.get(name);
  }

  /**
   * Pilih provider berikutnya yang punya key dan breaker tidak terbuka.
   *
   * @param {string[]} order
   * @returns {Array<{name: string, keys: string[]}>}
   */
  usableProviders(order = this.order) {
    const result = [];
    for (const name of order) {
      const provider = this.providers.find((p) => p.name === name);
      if (!provider || !provider.keys || provider.keys.length === 0) continue;
      if (this.breaker(name).isOpen) continue;
      result.push(provider);
    }
    return result;
  }

  currentKey(providerName) {
    const provider = this.providers.find((p) => p.name === providerName);
    const idx = this.keyIndex.get(providerName) || 0;
    return provider.keys[idx % provider.keys.length];
  }

  rotateKey(providerName) {
    const provider = this.providers.find((p) => p.name === providerName);
    const idx = (this.keyIndex.get(providerName) || 0) + 1;
    this.keyIndex.set(providerName, idx % provider.keys.length);
  }

  /**
   * Guard kuota harian per user/chat. Return true bila diizinkan.
   *
   * @param {string} scopeKey
   * @returns {Promise<boolean>}
   */
  async checkQuota(scopeKey) {
    const limit = this.config.dailyQuotaPerUser || 0;
    if (!limit) return true;

    const today = new Date().toISOString().slice(0, 10);
    let entry = this.quota.get(scopeKey);

    if (!entry || entry.date !== today) {
      entry = { date: today, used: 0 };
      this.quota.set(scopeKey, entry);
      // Opsional: muat counter dari SQLite.
      if (this.db && typeof this.db.getAiQuota === 'function') {
        try {
          const persisted = await this.db.getAiQuota(scopeKey, today);
          entry.used = persisted || 0;
        } catch {
          /* fail-open: pakai in-memory */
        }
      }
    }

    return entry.used < limit;
  }

  /**
   * Catat pemakaian kuota.
   *
   * @param {string} scopeKey
   */
  async recordQuota(scopeKey) {
    const limit = this.config.dailyQuotaPerUser || 0;
    if (!limit) return;

    const today = new Date().toISOString().slice(0, 10);
    let entry = this.quota.get(scopeKey);
    if (!entry || entry.date !== today) {
      entry = { date: today, used: 0 };
      this.quota.set(scopeKey, entry);
    }
    entry.used += 1;

    if (this.db && typeof this.db.incrAiQuota === 'function') {
      try {
        await this.db.incrAiQuota(scopeKey, today);
      } catch {
        /* non-fatal */
      }
    }
  }

  /**
   * Panggil satu provider dengan key rotation + retry ringan.
   *
   * @param {object} provider
   * @param {object} request
   * @returns {Promise<string>}
   */
  async callProvider(provider, request) {
    const breaker = this.breaker(provider.name);
    const maxAttempts = Math.max(1, provider.keys.length);
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const key = this.currentKey(provider.name);
      try {
        const text = await PROVIDERS[provider.name]({
          ...request,
          key,
        });
        breaker.recordSuccess();
        return text;
      } catch (err) {
        lastError = err;
        if (isRateLimit(err)) {
          // Pindah key; bila key sudah habis, biarkan loop berhenti.
          this.rotateKey(provider.name);
          this.log('warn', `AI ${provider.name}: rate limit, ganti key`, err);
        } else if (isRetryable(err) && attempt + 1 < maxAttempts) {
          this.log('warn', `AI ${provider.name}: retry (${attempt + 1}/${maxAttempts})`, err);
          await sleep(250 * (attempt + 1));
        } else {
          break;
        }
      }
    }

    breaker.recordFailure();
    const err = new AppError(
      'AI_PROVIDER_ERROR',
      describeError(lastError, this.allKeys),
      'Penyedia AI sedang tidak tersedia. Coba lagi nanti.',
    );
    err.provider = provider.name;
    throw err;
  }

  /**
   * Jalankan permintaan lewat seluruh provider sesuai urutan fallback.
   *
   * @param {object} request
   * @param {string} [request.model]
   * @param {Array<{role: string, content: string}>} request.messages
   * @param {string} [request.system]
   * @param {string} [scopeKey] - "chatId|userId" untuk kuota.
   * @returns {Promise<{text: string, provider: string, model: string}>}
   */
  async generate(request, scopeKey) {
    if (!this.config.enabled) {
      throw new AppError('AI_DISABLED', 'AI dinonaktifkan', 'Fitur AI sedang nonaktif.');
    }

    if (scopeKey && !(await this.checkQuota(scopeKey))) {
      throw new AppError(
        'AI_QUOTA_EXCEEDED',
        'Kuota AI harian habis',
        'Kuota AI harian kamu sudah habis. Coba lagi besok.',
      );
    }

    const model = request.model || this.config.defaultModel || this.config.primaryModel;
    const maxTokens = this.config.maxTokens;
    const timeoutMs = this.config.timeoutMs;
    const system = request.system || this.config.systemPrompt || '';
    const messages = Array.isArray(request.messages) ? request.messages : [];

    const fallbackTargets = this.config.fallbacks || [];
    let lastError;

    for (const providerName of this.order) {
      const provider = this.providers.find((p) => p.name === providerName);
      if (!provider || !provider.keys || provider.keys.length === 0) continue;
      if (this.breaker(providerName).isOpen) continue;

      // Tentukan model untuk provider ini.
      let providerModel = model;
      if (providerName !== this.config.primaryProvider) {
        const fallback = fallbackTargets.find((f) => f.provider === providerName);
        if (fallback) providerModel = fallback.model;
      }

      try {
        const text = await this.callProvider(provider, {
          model: providerModel,
          messages,
          system,
          maxTokens,
          timeoutMs,
        });
        if (scopeKey) await this.recordQuota(scopeKey);
        return { text, provider: providerName, model: providerModel };
      } catch (err) {
        lastError = err;
        this.log('warn', `AI ${providerName} gagal, coba provider berikutnya`, err);
      }
    }

    const finalErr = lastError || new Error('Tidak ada penyedia AI yang tersedia');
    throw new AppError(
      'AI_ALL_PROVIDERS_FAILED',
      describeError(finalErr, this.allKeys),
      'Semua penyedia AI sedang tidak tersedia. Coba lagi nanti.',
    );
  }

  log(level, message, err) {
    if (!this.logger || typeof this.logger[level] !== 'function') return;
    const safeMessage = redactSecrets(message, this.allKeys);
    const safeErr = err ? describeError(err, this.allKeys) : undefined;
    this.logger[level]({ message: safeMessage, error: safeErr });
  }
}

module.exports = {
  AiService,
  redactSecrets,
  isRateLimit,
  isRetryable,
  CircuitBreaker,
};
