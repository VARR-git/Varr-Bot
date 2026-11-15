/**
 * Middleware ban: blokir pengguna atau grup yang diblokir owner.
 *
 * Perilaku:
 * - Owner selalu lolos (agar bisa membuka blokir).
 * - Grup yang diblokir diabaikan total (tanpa balasan) supaya bot tidak
 *   mengirim pesan berulang ke grup yang sudah ditolak.
 * - Pengguna yang diblokir dibalas sekali per jendela waktu supaya tidak
 *   menjadi banjir pesan, tetapi tetap tahu alasannya.
 */

const NOTICE_WINDOW_MS = 10 * 60 * 1_000;
const NOTICE_MAX_ENTRIES = 1_000;

/**
 * @param {object} options
 * @param {object} options.db
 * @param {object} [options.logger]
 * @param {() => number} [options.now]
 */
function createBannedMiddleware({ db, logger, now = Date.now }) {
  /** @type {Map<string, number>} */
  const notices = new Map();

  /**
   * @param {number} timestamp
   */
  function prune(timestamp) {
    if (notices.size < NOTICE_MAX_ENTRIES) return;
    for (const [key, value] of notices) {
      if (timestamp - value > NOTICE_WINDOW_MS) notices.delete(key);
    }
  }

  return async function banned(ctx, next) {
    if (ctx.isOwner) {
      await next();
      return;
    }

    try {
      if (ctx.isGroup && db.isGroupBanned(ctx.chatId)) {
        db.incrementStat('banned:group');
        logger?.debug?.({ chat: ctx.chatId }, 'Command dari grup yang diblokir diabaikan');
        return;
      }

      if (db.isUserBanned(ctx.senderId)) {
        db.incrementStat('banned:user');

        const timestamp = now();
        const previous = notices.get(ctx.senderId) || 0;

        if (timestamp - previous >= NOTICE_WINDOW_MS) {
          notices.set(ctx.senderId, timestamp);
          prune(timestamp);
          await ctx.reply(ctx.t('errors.banned'));
        }

        return;
      }
    } catch (error) {
      // Kegagalan cek ban tidak boleh memblokir seluruh bot.
      logger?.warn?.({ err: error }, 'Gagal memeriksa status ban');
    }

    await next();
  };
}

module.exports = {
  NOTICE_WINDOW_MS,
  createBannedMiddleware,
};
