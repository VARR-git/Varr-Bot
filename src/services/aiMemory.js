/**
 * Penyimpanan riwayat percakapan AI singkat per scope (user/chat).
 *
 * In-memory dengan TTL sliding per scope. Riwayat terbatas (maxMessages)
 * agar tidak membengkak. Tidak menulis ke disk; aman dipakai lintas command
 * karena dibuat sekali di `src/index.js` lalu dibagikan lewat `ctx.services`.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1_000; // 30 menit
const DEFAULT_MAX_MESSAGES = 20;

/**
 * @param {{ttlMs?: number, maxMessages?: number, now?: () => number}} [options]
 */
function createAiMemory({
  ttlMs = DEFAULT_TTL_MS,
  maxMessages = DEFAULT_MAX_MESSAGES,
  now = Date.now,
} = {}) {
  const ttl = Math.max(1_000, Math.trunc(ttlMs) || DEFAULT_TTL_MS);
  const limit = Math.max(1, Math.trunc(maxMessages) || DEFAULT_MAX_MESSAGES);

  /** @type {Map<string, {messages: Array<{role: string, content: string}>, expiresAt: number}>} */
  const entries = new Map();

  /**
   * @param {number} timestamp
   */
  function prune(timestamp) {
    for (const [scope, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(scope);
    }
  }

  /**
   * @param {string} scope
   * @returns {Array<{role: string, content: string}>}
   */
  function get(scope) {
    const key = String(scope || '');
    if (!key) return [];

    const timestamp = now();
    prune(timestamp);

    const entry = entries.get(key);
    if (!entry) return [];

    return entry.messages.slice();
  }

  /**
   * Tambahkan satu pesan ke riwayat scope. Memperpanjang TTL scope dan
   * memangkas pesan tertua bila melebihi batas.
   *
   * @param {string} scope
   * @param {'user'|'assistant'} role
   * @param {string} content
   * @returns {boolean}
   */
  function append(scope, role, content) {
    const key = String(scope || '');
    const text = String(content || '').trim();
    if (!key || !text) return false;

    const timestamp = now();
    prune(timestamp);

    let entry = entries.get(key);
    if (!entry) {
      entry = { messages: [], expiresAt: timestamp + ttl };
      entries.set(key, entry);
    }

    entry.messages.push({ role, content: text });
    if (entry.messages.length > limit) {
      entry.messages.splice(0, entry.messages.length - limit);
    }
    entry.expiresAt = timestamp + ttl;

    return true;
  }

  /**
   * Hapus seluruh riwayat sebuah scope.
   *
   * @param {string} scope
   * @returns {boolean} true bila ada riwayat yang dihapus
   */
  function reset(scope) {
    return entries.delete(String(scope || ''));
  }

  /**
   * Hapus semua scope.
   */
  function clear() {
    entries.clear();
  }

  /**
   * @returns {number}
   */
  function size() {
    prune(now());
    return entries.size;
  }

  return {
    get,
    append,
    reset,
    clear,
    size,
    prune: () => prune(now()),
  };
}

module.exports = {
  createAiMemory,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_MESSAGES,
};
