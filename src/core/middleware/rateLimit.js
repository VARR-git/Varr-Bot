/**
 * Middleware rate limit sliding window per pengguna.
 */

const PRUNE_THRESHOLD = 2_000;

/**
 * @param {{config: object, now?: () => number}} options
 */
function createRateLimitMiddleware({ config, now = Date.now }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  const max = Math.max(1, Number(config.rateLimit?.max) || 20);
  const windowMs = Math.max(1_000, Number(config.rateLimit?.windowMs) || 60_000);

  function prune(timestamp) {
    if (hits.size < PRUNE_THRESHOLD) return;
    for (const [key, timestamps] of hits) {
      const recent = timestamps.filter((value) => timestamp - value < windowMs);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  }

  async function rateLimit(ctx, next) {
    if (ctx.isOwner) {
      await next();
      return;
    }

    const timestamp = now();
    const key = ctx.senderId;
    const recent = (hits.get(key) || []).filter((value) => timestamp - value < windowMs);

    if (recent.length >= max) {
      const oldest = recent[0] ?? timestamp;
      const remaining = Math.max(1, Math.ceil((windowMs - (timestamp - oldest)) / 1000));
      hits.set(key, recent);
      await ctx.reply(ctx.t('errors.rateLimit', { seconds: remaining }));
      return;
    }

    recent.push(timestamp);
    hits.set(key, recent);
    prune(timestamp);
    await next();
  }

  rateLimit.reset = () => hits.clear();
  rateLimit.size = () => hits.size;

  return rateLimit;
}

module.exports = {
  createRateLimitMiddleware,
};
