/**
 * Middleware scope: batasi command ke grup atau chat pribadi.
 */

function createScopeMiddleware() {
  return async function scope(ctx, next) {
    const target = ctx.command?.scope || 'all';

    if (target === 'group' && !ctx.isGroup) {
      await ctx.reply(ctx.t('errors.groupOnly'));
      return;
    }

    if (target === 'private' && ctx.isGroup) {
      await ctx.reply(ctx.t('errors.privateOnly'));
      return;
    }

    await next();
  };
}

module.exports = {
  createScopeMiddleware,
};
