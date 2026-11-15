/**
 * `.warnings [mention|reply|nomor]` — lihat daftar warning anggota.
 * Tanpa target, menampilkan warning milik pengirim.
 */

const { formatDateTime } = require('../../utils/format');
const { jidToNumber } = require('../../utils/jid');
const { getWarnLimit } = require('../../services/warnings');
const {
  resolveGroupTarget,
  resolveSenderTarget,
  targetMention,
} = require('../../utils/groupTarget');

module.exports = {
  name: 'warnings',
  aliases: ['warns', 'cekwarning'],
  category: 'group',
  description: 'Lihat daftar warning anggota',
  descriptionKey: 'commands.warnings.description',
  usage: 'warnings [@user|reply|nomor]',
  examples: ['warnings', 'warnings @6281234567890'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const metadata = await ctx.getGroupMetadata();
    const target = resolveGroupTarget(ctx) || resolveSenderTarget(ctx, metadata);
    const targetJid = target.participant?.id || target.jid;
    const limit = getWarnLimit(ctx.db, ctx.chatId);
    const warnings = ctx.db.getWarnings(ctx.chatId, targetJid);

    if (warnings.length === 0) {
      return ctx.t('group.warningsEmpty', {
        user: targetMention(target),
        limit,
      });
    }

    const lines = [
      ctx.t('group.warningsHeader', {
        user: targetMention(target),
        count: warnings.length,
        limit,
      }),
      '',
      ...warnings.map((warning) => {
        const reason = warning.reason || ctx.t('common.none');
        const by = warning.warned_by
          ? `+${jidToNumber(warning.warned_by)}`
          : ctx.t('common.unknown');
        return `• ${formatDateTime(warning.created_at)} — ${reason} (${by})`;
      }),
    ];

    await ctx.send({ text: lines.join('\n'), mentions: [target.jid] }, { quoted: false });
    return null;
  },
};
