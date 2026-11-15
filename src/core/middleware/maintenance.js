/**
 * Middleware maintenance: blokir command non-darurat saat maintenance.
 */

/**
 * @param {{state: {maintenance: boolean}}} options
 */
function createMaintenanceMiddleware({ state }) {
  return async function maintenance(ctx, next) {
    if (!state.maintenance || ctx.isOwner || ctx.command?.maintenanceSafe) {
      await next();
      return;
    }

    await ctx.reply(ctx.t('errors.maintenance'));
  };
}

module.exports = {
  createMaintenanceMiddleware,
};
