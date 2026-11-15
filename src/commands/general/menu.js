/**
 * `.menu` — daftar command yang bisa diakses pengguna.
 */

const { permissionLevel } = require('../../core/registry');
const { formatDuration } = require('../../utils/format');

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

module.exports = {
  name: 'menu',
  aliases: ['list'],
  category: 'general',
  description: 'Tampilkan daftar command yang tersedia',
  descriptionKey: 'commands.menu.description',
  usage: 'menu',
  examples: ['menu'],
  permission: 'user',
  scope: 'all',
  cooldown: 5,
  maintenanceSafe: true,

  async execute(ctx) {
    const userLevel = permissionLevel(ctx.role);
    const commands = ctx.registry.getAll()
      .filter((command) => !command.hidden)
      .filter((command) => permissionLevel(command.permission) <= userLevel);

    const lines = [
      ctx.t('menu.header', { bot: ctx.config.botName, version: ctx.config.version }),
      '',
      ctx.t('menu.greeting', { name: ctx.senderName }),
      `${ctx.t('menu.role')}   : ${ctx.t(`roles.${ctx.role}`)}`,
      `${ctx.t('menu.mode')}   : ${ctx.state.mode}`,
      `${ctx.t('menu.uptime')} : ${formatDuration(ctx.state.uptime())}`,
      `${ctx.t('menu.prefix')} : ${ctx.config.prefixes.join(' ')}`,
      `${ctx.t('menu.total')}  : ${ctx.t('menu.totalValue', { count: commands.length })}`,
      '',
    ];

    if (commands.length === 0) {
      lines.push(ctx.t('menu.empty'));
    } else {
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

      for (const category of categories) {
        const items = grouped.get(category).sort((a, b) => a.name.localeCompare(b.name));
        lines.push(`*${categoryLabel(ctx, category).toUpperCase()}*`);
        for (const command of items) {
          const description = describe(ctx, command);
          lines.push(`• *${ctx.prefix}${command.name}*${description ? ` — ${description}` : ''}`);
        }
        lines.push('');
      }
    }

    lines.push(ctx.t('menu.footer', { prefix: ctx.prefix }));
    return lines.join('\n').trim();
  },
};
