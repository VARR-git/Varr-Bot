/**
 * `.maintenance [on|off]` — aktifkan/matikan mode maintenance.
 */

const TRUTHY = new Set(['on', 'true', '1', 'yes', 'ya', 'aktif', 'enable', 'enabled']);
const FALSY = new Set(['off', 'false', '0', 'no', 'tidak', 'nonaktif', 'disable', 'disabled']);

module.exports = {
  name: 'maintenance',
  aliases: ['maint'],
  category: 'owner',
  description: 'Aktifkan atau matikan mode maintenance',
  descriptionKey: 'commands.maintenance.description',
  usage: 'maintenance [on|off]',
  examples: ['maintenance', 'maintenance on'],
  permission: 'owner',
  scope: 'all',
  cooldown: 0,
  maintenanceSafe: true,

  async execute(ctx) {
    const input = String(ctx.args[0] || '').toLowerCase();

    const statusLabel = (enabled) => ctx.t(enabled ? 'maintenance.on' : 'maintenance.off');

    if (!input) {
      return [
        ctx.t('maintenance.title'),
        '',
        ctx.t('maintenance.current', { status: statusLabel(ctx.state.maintenance) }),
        '',
        ctx.t('maintenance.notice'),
      ].join('\n');
    }

    let next;
    if (TRUTHY.has(input)) next = true;
    else if (FALSY.has(input)) next = false;
    else {
      return [
        ctx.t('maintenance.title'),
        '',
        ctx.t('maintenance.invalid', { prefix: ctx.prefix }),
      ].join('\n');
    }

    if (ctx.state.maintenance === next) {
      return ctx.t('maintenance.already', { status: statusLabel(next) });
    }

    ctx.state.setMaintenance(next);
    ctx.db.audit({
      actor: ctx.senderId,
      action: 'maintenance.change',
      target: ctx.chatId,
      meta: { enabled: next },
    });

    ctx.logger.info(
      { enabled: next, actor: ctx.senderId },
      'Mode maintenance diubah',
    );

    return ctx.t('maintenance.changed', { status: statusLabel(next) });
  },
};
