/**
 * `.owner` — kontak owner bot.
 */

module.exports = {
  name: 'owner',
  aliases: ['creator'],
  category: 'general',
  description: 'Tampilkan kontak owner bot',
  descriptionKey: 'commands.owner.description',
  usage: 'owner',
  examples: ['owner'],
  permission: 'user',
  scope: 'all',
  cooldown: 10,

  async execute(ctx) {
    const owners = ctx.config.ownerNumbers;

    if (owners.length === 0) {
      return [
        ctx.t('owner.title', { bot: ctx.config.botName }),
        '',
        ctx.t('owner.empty'),
      ].join('\n');
    }

    const contacts = owners.map((number) => ctx.t('owner.contact', { number }));

    return [
      ctx.t('owner.title', { bot: ctx.config.botName }),
      '',
      ...contacts,
      '',
      ctx.t('owner.footer'),
    ].join('\n');
  },
};
