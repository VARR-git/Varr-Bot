/**
 * `.unwarn <mention|reply|nomor>` — hapus semua warning anggota.
 */

const { checkTarget, replyWithMention, targetMention } = require('../../utils/groupModeration');
const { resolveGroupTarget } = require('../../utils/groupTarget');

module.exports = {
  name: 'unwarn',
  aliases: ['resetwarn', 'clearwarn'],
  category: 'group',
  description: 'Hapus semua warning anggota',
  descriptionKey: 'commands.unwarn.description',
  usage: 'unwarn <@user|reply|nomor>',
  examples: ['unwarn @6281234567890', 'unwarn (reply pesan)'],
  permission: 'admin',
  scope: 'group',
  cooldown: 3,

  async execute(ctx) {
    const target = resolveGroupTarget(ctx);
    if (!target) {
      return ctx.t('group.targetMissing', { prefix: ctx.prefix, command: 'unwarn' });
    }

    const metadata = await ctx.getGroupMetadata();
    const targetError = checkTarget(ctx, metadata, target, {
      adminAllowed: true,
      requireParticipant: false,
      allowSelf: true,
    });
    if (targetError) return ctx.t(targetError);

    let cleared = 0;
    for (const jid of target.ids) {
      cleared += ctx.db.clearWarnings(ctx.chatId, jid);
    }

    ctx.db.audit({
      actor: ctx.senderId,
      action: 'warning.clear',
      target: target.jid,
      meta: { chatId: ctx.chatId, cleared },
    });

    await replyWithMention(
      ctx,
      ctx.t('group.warningsCleared', {
        user: targetMention(target),
        count: cleared,
      }),
      target,
    );
    return null;
  },
};
