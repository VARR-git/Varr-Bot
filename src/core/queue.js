/**
 * Queue eksekusi per chat.
 *
 * Tujuan:
 * - Pesan dari chat yang sama diproses berurutan, sehingga balasan tidak
 *   saling mendahului dan command yang menulis state tidak balapan.
 * - Chat berbeda tetap paralel; satu chat lambat tidak memblokir chat lain.
 *
 * Queue ini in-memory dan best-effort. Saat restart, antrean hilang; itu
 * diterima karena WhatsApp akan mengirim ulang pesan yang belum di-ack.
 */

/**
 * @param {object} [options]
 * @param {number} [options.maxPending] Maksimum pesan menunggu per chat.
 * @param {number} [options.maxChats] Maksimum chat aktif bersamaan.
 * @param {object} [options.logger]
 * @param {() => number} [options.now]
 */
function createChatQueue({ maxPending = 50, maxChats = 500, logger } = {}) {
  const pendingLimit = Math.max(1, Math.trunc(maxPending) || 50);
  const chatLimit = Math.max(1, Math.trunc(maxChats) || 500);

  /** @type {Map<string, Promise<void>>} */
  const tails = new Map();
  /** @type {Map<string, number>} */
  const pending = new Map();

  let dropped = 0;

  /**
   * @param {string} id
   * @param {Promise<void>} tail
   */
  function release(id, tail) {
    const remaining = (pending.get(id) || 1) - 1;

    if (remaining <= 0) {
      pending.delete(id);
      if (tails.get(id) === tail) tails.delete(id);
      return;
    }

    pending.set(id, remaining);
  }

  /**
   * @param {string} chatId
   * @param {() => Promise<any>} task
   * @returns {Promise<{ran: boolean, value?: any}>}
   */
  function run(chatId, task) {
    const id = String(chatId || 'unknown');
    const waiting = pending.get(id) || 0;

    if (waiting >= pendingLimit) {
      dropped += 1;
      logger?.warn?.(
        { chat: id, waiting, maxPending: pendingLimit },
        'Antrean chat penuh, pesan dilewati',
      );
      return Promise.resolve({ ran: false, reason: 'chat-full' });
    }

    if (!tails.has(id) && tails.size >= chatLimit) {
      dropped += 1;
      logger?.warn?.(
        { chat: id, activeChats: tails.size, maxChats: chatLimit },
        'Terlalu banyak chat aktif, pesan dilewati',
      );
      return Promise.resolve({ ran: false, reason: 'too-many-chats' });
    }

    pending.set(id, waiting + 1);

    const previous = tails.get(id) || Promise.resolve();
    const result = previous.then(() => task());

    // tail tidak pernah reject agar rantai chat tetap jalan setelah error.
    const tail = result
      .catch(() => {})
      .then(() => release(id, tail));

    tails.set(id, tail);

    return result.then((value) => ({ ran: true, value }));
  }

  /**
   * Tunggu antrean selesai (best-effort). Task baru yang masuk setelah
   * pemanggilan tidak ikut ditunggu.
   *
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>} false jika timeout
   */
  async function drain(timeoutMs = 5_000) {
    const current = [...tails.values()];
    if (current.length === 0) return true;

    const done = Promise.allSettled(current).then(() => true);

    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs));
    });

    try {
      return await Promise.race([done, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    run,
    drain,

    /** @param {string} chatId */
    pendingCount(chatId) {
      return pending.get(String(chatId || 'unknown')) || 0;
    },

    size() {
      return tails.size;
    },

    droppedCount() {
      return dropped;
    },

    clear() {
      tails.clear();
      pending.clear();
    },
  };
}

module.exports = {
  createChatQueue,
};
