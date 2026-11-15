/**
 * Middleware mode: public / private / self.
 */

/**
 * @param {{state: {mode: string}}} options
 */
function createModeMiddleware({ state }) {
  return async function mode(ctx, next) {
    const current = state.mode || 'public';

    if (current === 'public' || ctx.isOwner) {
      await next();
      return;
    }

    if (current === 'self') {
      await ctx.reply(ctx.t('errors.modeSelf'));
      return;
    }

    if (current === 'private') {
      if (ctx.isGroup && ctx.role === 'admin') {
        await next();
        return;
      }

      await ctx.reply(ctx.t(ctx.isGroup ? 'errors.modePrivateGroup' : 'errors.modePrivateDirect'));
      return;
    }

    // Mode tidak dikenal: fail open agar bot tidak diam total.
    await next();
  };
}

module.exports = {
  createModeMiddleware,
};
