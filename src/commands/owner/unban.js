/**
 * `.unban <@user|reply|nomor|group>` — buka blokir pengguna atau grup.
 */

const { resolveBanTarget, replyWithUserMention } = require('../../utils/ban');
const { targetMention } = require('../../utils/groupTarget');

module.exports = {
  name: 'unban',
  aliases: ['unblock'],
  category: 'owner',
  description: 'Buka kembali blokir pengguna atau grup',
  descriptionKey: 'commands.unban.description',
  usage: 'unban <@user|reply|nomor|group>',
  examples: ['unban @6281234567890', 'unban group'],
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

    if (resolved.type === 'group') {
      if (!ctx.isGroup) return ctx.t('ban.targetMissing', { prefix: ctx.prefix });

      if (!ctx.db.isGroupBanned(ctx.chatId)) {
        return ctx.t('ban.notBanned', { user: ctx.t('common.group') });
      }

      ctx.db.setGroupBanned(ctx.chatId, false);
      ctx.db.audit({
        actor: ctx.senderId,
        action: 'unban.group',
        target: ctx.chatId,
      });

      return ctx.t('ban.unbannedGroup');
    }

    const jids = [...new Set([resolved.target.jid, ...(resolved.target.ids || [])])]
      .filter(Boolean);

    if (!jids.some((jid) => ctx.db.isUserBanned(jid))) {
      await replyWithUserMention(ctx, ctx.t('ban.notBanned', {
        user: targetMention(resolved.target),
      }), resolved.target);
      return null;
    }

    for (const jid of jids) {
      ctx.db.setUserBanned(jid, false);
    }

    ctx.db.audit({
      actor: ctx.senderId,
      action: 'unban.user',
      target: resolved.target.jid,
      meta: { targets: jids },
    });

    await replyWithUserMention(ctx, ctx.t('ban.unbannedUser', {
      user: targetMention(resolved.target),
    }), resolved.target);
    return null;
  },
};
