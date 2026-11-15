/**
 * `.ban <@user|reply|nomor|group> [alasan]` — blokir pengguna atau grup dari bot.
 */

const { resolveBanTarget, replyWithUserMention } = require('../../utils/ban');
const { targetMention } = require('../../utils/groupTarget');

const MAX_REASON_LENGTH = 200;

module.exports = {
  name: 'ban',
  aliases: ['block'],
  category: 'owner',
  description: 'Blokir pengguna atau grup dari bot',
  descriptionKey: 'commands.ban.description',
  usage: 'ban <@user|reply|nomor|group> [alasan]',
  examples: ['ban @6281234567890 spam', 'ban (reply pesan)', 'ban group'],
  permission: 'owner',
  scope: 'all',
  cooldown: 0,

  async execute(ctx) {
    const resolved = await resolveBanTarget(ctx);

    if (!resolved) {
      return ctx.t('ban.targetMissing', { prefix: ctx.prefix });
    }

    if (resolved.type === 'protected') {
      return ctx.t('ban.protected');
    }

    const reason = (resolved.type === 'user' ? resolved.target.remainingArgs : ctx.args.slice(1))
      .join(' ')
      .trim()
      .slice(0, MAX_REASON_LENGTH) || null;

    if (resolved.type === 'group') {
      if (!ctx.isGroup) return ctx.t('ban.targetMissing', { prefix: ctx.prefix });

      if (ctx.db.isGroupBanned(ctx.chatId)) {
        return ctx.t('ban.alreadyBanned', { user: ctx.t('common.group') });
      }

      ctx.db.setGroupBanned(ctx.chatId, true, { reason });
      ctx.db.audit({
        actor: ctx.senderId,
        action: 'ban.group',
        target: ctx.chatId,
        meta: { reason },
      });

      return ctx.t('ban.bannedGroup');
    }

    const jids = [...new Set([resolved.target.jid, ...(resolved.target.ids || [])])]
      .filter(Boolean);

    if (jids.some((jid) => ctx.db.isUserBanned(jid))) {
      await replyWithUserMention(ctx, ctx.t('ban.alreadyBanned', {
        user: targetMention(resolved.target),
      }), resolved.target);
      return null;
    }

    for (const jid of jids) {
      ctx.db.setUserBanned(jid, true, { reason });
    }

    ctx.db.audit({
      actor: ctx.senderId,
      action: 'ban.user',
      target: resolved.target.jid,
      meta: { reason, targets: jids },
    });

    ctx.logger?.info?.(
      { actor: ctx.senderId, targets: jids.length, reason },
      'Pengguna diblokir dari bot',
    );

    await replyWithUserMention(ctx, ctx.t('ban.bannedUser', {
      user: targetMention(resolved.target),
      reason: reason ? ctx.t('ban.reason', { reason }) : '',
    }), resolved.target);
    return null;
  },
};
