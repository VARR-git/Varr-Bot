/**
 * `.mode [public|private|self]` — ubah mode bot tanpa restart.
 */

const { VALID_MODES } = require('../../config');

module.exports = {
  name: 'mode',
  category: 'owner',
  description: 'Lihat atau ubah mode bot (public/private/self)',
  descriptionKey: 'commands.mode.description',
  usage: 'mode [public|private|self]',
  examples: ['mode', 'mode private'],
  permission: 'owner',
  scope: 'all',
  cooldown: 0,

  async execute(ctx) {
    const requested = String(ctx.args[0] || '').toLowerCase();

    if (!requested) {
      return [
        ctx.t('mode.title'),
        '',
        ctx.t('mode.current', { mode: ctx.state.mode }),
        '',
        ctx.t('mode.list'),
        '',
        ctx.t('mode.usage', { prefix: ctx.prefix }),
      ].join('\n');
    }

    if (!VALID_MODES.includes(requested)) {
      return [
        ctx.t('mode.title'),
        '',
        ctx.t('mode.invalid', { mode: requested, options: VALID_MODES.join(', ') }),
        '',
        ctx.t('mode.usage', { prefix: ctx.prefix }),
      ].join('\n');
    }

    const previous = ctx.state.mode;
    if (previous === requested) {
      return ctx.t('mode.already', { mode: requested });
    }

    ctx.state.setMode(requested);
    ctx.db.audit({
      actor: ctx.senderId,
      action: 'mode.change',
      target: ctx.chatId,
      meta: { from: previous, to: requested },
    });

    ctx.logger.info(
      { from: previous, to: requested, actor: ctx.senderId },
      'Mode bot diubah',
    );

    return ctx.t('mode.changed', { from: previous, to: requested });
  },
};
