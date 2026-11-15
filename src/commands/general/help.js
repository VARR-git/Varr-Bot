/**
 * `.help [command]` — detail command atau daftar singkat.
 */

const { permissionLevel } = require('../../core/registry');

const CATEGORY_ORDER = [
  'general',
  'owner',
  'group',
  'guard',
  'tools',
  'media',
  'downloader',
  'ai',
  'games',
  'economy',
  'other',
];

/**
 * @param {object} ctx
 * @param {object} command
 * @returns {string}
 */
function describe(ctx, command) {
  if (command.descriptionKey) return ctx.t(command.descriptionKey);
  return command.description || '';
}

/**
 * @param {object} ctx
 * @param {string} category
 * @returns {string}
 */
function categoryLabel(ctx, category) {
  const key = `categories.${category}`;
  const translated = ctx.t(key);
  if (translated !== key) return translated;
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * @param {object} ctx
 * @param {object} command
 * @returns {string}
 */
function commandDetail(ctx, command) {
  const description = describe(ctx, command);
  const cooldown = command.cooldown ?? ctx.config.defaultCooldown;
  const examples = command.examples.length > 0 ? command.examples : [command.usage];

  const lines = [
    ctx.t('help.header', { bot: ctx.config.botName }),
    '',
    `*${command.name}*`,
    description ? `${ctx.t('help.descriptionLabel')}: ${description}` : null,
    `${ctx.t('help.usage')}: *${ctx.prefix}${command.usage}*`,
    `${ctx.t('help.aliases')}: ${command.aliases.length > 0 ? command.aliases.join(', ') : ctx.t('help.noAlias')}`,
    `${ctx.t('help.category')}: ${categoryLabel(ctx, command.category)}`,
    `${ctx.t('help.permission')}: ${ctx.t(`roles.${command.permission}`)}`,
    `${ctx.t('help.cooldown')}: ${ctx.t('help.cooldownValue', { seconds: cooldown })}`,
    '',
    `${ctx.t('help.examples')}:`,
    ...examples.map((example) => `• *${ctx.prefix}${String(example).replace(/^\W+/, '')}*`),
  ];

  return lines.filter((line) => line !== null).join('\n');
}

module.exports = {
  name: 'help',
  aliases: ['bantuan', 'h'],
  category: 'general',
  description: 'Lihat detail cara pakai sebuah command',
  descriptionKey: 'commands.help.description',
  usage: 'help <command>',
  examples: ['help menu', 'help ping'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,
  maintenanceSafe: true,

  async execute(ctx) {
    const targetName = ctx.args[0];
    const userLevel = permissionLevel(ctx.role);

    if (targetName) {
      const command = ctx.registry.get(targetName);
      if (!command || permissionLevel(command.permission) > userLevel) {
        return ctx.t('help.notFound', { command: targetName });
      }
      return commandDetail(ctx, command);
    }

    const commands = ctx.registry.getAll()
      .filter((command) => !command.hidden)
      .filter((command) => permissionLevel(command.permission) <= userLevel);

    const grouped = new Map();
    for (const command of commands) {
      if (!grouped.has(command.category)) grouped.set(command.category, []);
      grouped.get(command.category).push(command);
    }

    const categories = [...grouped.keys()].sort((a, b) => {
      const indexA = CATEGORY_ORDER.indexOf(a);
      const indexB = CATEGORY_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    const lines = [ctx.t('help.header', { bot: ctx.config.botName }), ''];

    for (const category of categories) {
      lines.push(`*${categoryLabel(ctx, category).toUpperCase()}*`);
      for (const command of grouped.get(category).sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`• *${ctx.prefix}${command.usage}* — ${describe(ctx, command)}`);
      }
      lines.push('');
    }

    lines.push(ctx.t('help.hint', { prefix: ctx.prefix }));
    return lines.join('\n').trim();
  },
};
