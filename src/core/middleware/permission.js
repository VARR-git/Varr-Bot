/**
 * Middleware permission berbasis hierarki role.
 */

const { PERMISSION_LEVELS, permissionLevel } = require('../registry');

/**
 * @param {{logger?: object}} [options]
 */
function createPermissionMiddleware({ logger } = {}) {
  return async function permission(ctx, next) {
    const required = ctx.command?.permission || 'user';
    const current = permissionLevel(ctx.role);

    if (current < permissionLevel(required)) {
      logger?.debug?.(
        { role: ctx.role, required, command: ctx.command?.name },
        'Command ditolak karena permission',
      );
      await ctx.reply(ctx.t('errors.permission', { role: ctx.t(`roles.${required}`) }));
      return;
    }

    await next();
  };
}

module.exports = {
  PERMISSION_LEVELS,
  createPermissionMiddleware,
};
