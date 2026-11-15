/**
 * Middleware cooldown per pengguna + command.
 */

const PRUNE_THRESHOLD = 5_000;
const PRUNE_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * @param {{config: object, now?: () => number}} options
 */
function createCooldownMiddleware({ config, now = Date.now }) {
  /** @type {Map<string, number>} */
  const lastUsed = new Map();

  function prune(timestamp) {
    if (lastUsed.size < PRUNE_THRESHOLD) return;
    for (const [key, value] of lastUsed) {
      if (timestamp - value > PRUNE_MAX_AGE_MS) lastUsed.delete(key);
    }
  }

  async function cooldown(ctx, next) {
    if (ctx.isOwner) {
      await next();
      return;
    }

    const seconds = ctx.command?.cooldown ?? config.defaultCooldown ?? 0;
    const cooldownMs = Math.max(0, Number(seconds) || 0) * 1000;

    if (cooldownMs === 0) {
      await next();
      return;
    }

    const timestamp = now();
    const key = `${ctx.senderId}:${ctx.command.name}`;
    const previous = lastUsed.get(key);

    if (previous !== undefined) {
      const elapsed = timestamp - previous;
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
        await ctx.reply(ctx.t('errors.cooldown', {
          seconds: Math.max(1, remaining),
          command: ctx.command.name,
        }));
        return;
      }
    }

    lastUsed.set(key, timestamp);
    prune(timestamp);
    await next();
  }

  cooldown.reset = () => lastUsed.clear();
  cooldown.size = () => lastUsed.size;

  return cooldown;
}

module.exports = {
  createCooldownMiddleware,
};
