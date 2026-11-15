/**
 * `.warn <mention|reply|nomor> [alasan]` — beri peringatan anggota.
 *
 * Saat jumlah warning mencapai `warn_limit`, anggota dikeluarkan dari grup.
 */

const {
  checkBotAdmin,
  checkTarget,
  replyWithMention,
  withReason,
  targetMention,
} = require('../../utils/groupModeration');
const { resolveGroupTarget } = require('../../utils/groupTarget');
const { addWarningAndEscalate } = require('../../services/warnings');

module.exports = {
  name: 'warn',
  aliases: ['peringatkan'],
  category: 'group',
  description: 'Beri peringatan kepada anggota grup',
  descriptionKey: 'commands.warn.description',
  usage: 'warn <@user|reply|nomor> [alasan]',
  examples: ['warn @6281234567890 spam', 'warn (reply pesan)'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const target = resolveGroupTarget(ctx);
    if (!target) {
      return ctx.t('group.targetMissing', { prefix: ctx.prefix, command: 'warn' });
    }

    const metadata = await ctx.getGroupMetadata();
    const botError = checkBotAdmin(ctx, metadata);
    if (botError) return ctx.t(botError);

    const targetError = checkTarget(ctx, metadata, target);
    if (targetError) return ctx.t(targetError);

    const reason = target.remainingArgs.join(' ').trim().slice(0, 200) || null;
    const result = await addWarningAndEscalate({
      db: ctx.db,
      logger: ctx.logger,
      sock: ctx.sock,
      chatId: ctx.chatId,
      target,
      reason,
      warnedBy: ctx.senderId,
      metadata,
    });

    if (result.kicked) {
      ctx.services.getGroupMetadata?.invalidate?.(ctx.chatId);
      await replyWithMention(
        ctx,
        ctx.t('group.warnKicked', {
          user: targetMention(target),
          count: result.count,
          limit: result.limit,
        }),
        target,
      );
      return null;
    }

    if (result.needsAdmin) {
      await replyWithMention(
        ctx,
        ctx.t('group.warnLimitNoAdmin', {
          user: targetMention(target),
          limit: result.limit,
        }),
        target,
      );
      return null;
    }

    await replyWithMention(
      ctx,
      `${ctx.t('group.warnAdded', {
        user: targetMention(target),
        count: result.count,
        limit: result.limit,
      })}${withReason(ctx, target)}`,
      target,
    );
    return null;
  },
};
