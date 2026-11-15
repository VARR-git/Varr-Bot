/**
 * Cache pesan untuk `getMessage` Baileys.
 *
 * Baileys memanggil `getMessage(key)` ketika penerima meminta kirim ulang
 * (retry receipt), saat memproses event, dan saat membaca poll. Baileys v7
 * sudah punya retry cache bawaan (512 pesan / 5 menit) untuk pesan keluar;
 * cache ini adalah lapisan kedua dengan TTL lebih panjang dan mencakup pesan
 * masuk.
 *
 * Batasan memori dijaga dengan jumlah entri maksimum + TTL. Isi pesan tidak
 * pernah ditulis ke disk.
 */

const DEFAULT_MAX_ENTRIES = 1_024;
const DEFAULT_TTL_MS = 15 * 60 * 1_000;

/**
 * @param {object} [options]
 * @param {number} [options.max]
 * @param {number} [options.ttlMs]
 * @param {() => number} [options.now]
 */
function createMessageCache({ max = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const limit = Math.max(1, Math.trunc(max) || DEFAULT_MAX_ENTRIES);
  const ttl = Math.max(1, Math.trunc(ttlMs) || DEFAULT_TTL_MS);

  /** @type {Map<string, {message: object, expiresAt: number}>} */
  const entries = new Map();

  /**
   * Kunci gabungan chat + id. ID pesan WhatsApp acak, tetapi menyertakan
   * remoteJid membuat lookup tidak pernah salah chat.
   *
   * @param {object} key
   * @returns {string|null}
   */
  function cacheKey(key) {
    const id = String(key?.id || '');
    if (!id) return null;

    const chat = String(key?.remoteJid || '');
    return `${chat}\u0000${id}`;
  }

  /**
   * @param {number} timestamp
   */
  function prune(timestamp) {
    for (const [entryKey, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(entryKey);
    }
  }

  /**
   * @param {object} key WAMessageKey
   * @param {object} message proto.IMessage
   * @returns {boolean}
   */
  function set(key, message) {
    const id = cacheKey(key);
    if (!id || !message) return false;

    const timestamp = now();

    if (entries.size >= limit) prune(timestamp);

    // Hapus dulu agar urutan Map mencerminkan recency (LRU sederhana).
    entries.delete(id);
    entries.set(id, { message, expiresAt: timestamp + ttl });

    while (entries.size > limit) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }

    return true;
  }

  /**
   * @param {object} key WAMessageKey
   * @returns {object|undefined}
   */
  function get(key) {
    const id = cacheKey(key);
    if (!id) return undefined;

    const entry = entries.get(id);
    if (!entry) return undefined;

    if (entry.expiresAt <= now()) {
      entries.delete(id);
      return undefined;
    }

    return entry.message;
  }

  return {
    set,
    get,
    size: () => entries.size,
    clear: () => entries.clear(),
    prune: () => prune(now()),
  };
}

module.exports = {
  createMessageCache,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_TTL_MS,
};
