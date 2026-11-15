/**
 * Pipeline middleware Varr-Bot.
 *
 * Setiap middleware menerima `(ctx, next)`. Middleware yang tidak memanggil
 * `next()` menghentikan pipeline (misalnya karena permission ditolak).
 */

const { createNormalizeMiddleware } = require('./normalize');
const { createBannedMiddleware } = require('./banned');
const { createMaintenanceMiddleware } = require('./maintenance');
const { createModeMiddleware } = require('./mode');
const { createPermissionMiddleware } = require('./permission');
const { createScopeMiddleware } = require('./scope');
const { createCooldownMiddleware } = require('./cooldown');
const { createRateLimitMiddleware } = require('./rateLimit');

/**
 * @param {Array<(ctx: object, next: () => Promise<void>) => Promise<void>>} middlewares
 * @returns {(ctx: object, final: (ctx: object) => Promise<void>) => Promise<void>}
 */
function compose(middlewares) {
  return function run(ctx, final) {
    let lastIndex = -1;

    async function dispatch(index) {
      if (index <= lastIndex) {
        throw new Error('next() dipanggil lebih dari sekali');
      }
      lastIndex = index;

      const handler = index === middlewares.length ? final : middlewares[index];
      if (!handler) return;

      await handler(ctx, () => dispatch(index + 1));
    }

    return dispatch(0);
  };
}

/**
 * Urutan default: normalize → banned → maintenance → mode → permission →
 * scope → cooldown → rate limit.
 *
 * `banned` sengaja setelah normalize (butuh identitas) dan sebelum maintenance
 * agar pengguna/grup yang diblokir tidak mendapat balasan otomatis apa pun.
 *
 * @param {object} deps
 * @param {object} deps.config
 * @param {object} deps.db
 * @param {object} deps.state
 * @param {(sock: object, groupId: string) => Promise<object>} deps.getGroupMetadata
 * @param {object} [deps.logger]
 * @param {() => number} [deps.now]
 */
function createDefaultMiddlewares({ config, db, state, getGroupMetadata, logger, now }) {
  return [
    createNormalizeMiddleware({ config, db, getGroupMetadata }),
    createBannedMiddleware({ db, logger, now }),
    createMaintenanceMiddleware({ state }),
    createModeMiddleware({ state }),
    createPermissionMiddleware({ logger }),
    createScopeMiddleware(),
    createCooldownMiddleware({ config, now }),
    createRateLimitMiddleware({ config, now }),
  ];
}

module.exports = {
  compose,
  createNormalizeMiddleware,
  createBannedMiddleware,
  createMaintenanceMiddleware,
  createModeMiddleware,
  createPermissionMiddleware,
  createScopeMiddleware,
  createCooldownMiddleware,
  createRateLimitMiddleware,
  createDefaultMiddlewares,
};
