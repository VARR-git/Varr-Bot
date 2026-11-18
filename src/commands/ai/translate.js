/**
 * `.translate` / `.tr` — terjemahkan teks ke bahasa tujuan.
 *
 * Stateless: tidak menyimpan ke `aiMemory`. Format:
 * - `.translate <bahasa> <teks>`
 * - `.translate <bahasa>` (reply pesan)
 * - `.translate <teks>` → bahasa default `id`
 * - `.translate` (reply pesan) → bahasa default `id`
 */

const { quotedMessage, describeAiError } = require('./_shared');
const { extractText } = require('../../utils/text');

/**
 * @param {string} lang
 * @returns {string}
 */
function translatePrompt(lang) {
  const target = String(lang || '').replace(/[^a-zA-Z-]/g, '').slice(0, 12) || 'id';
  return [
    `Translate the following text to ${target}.`,
    'Reply only with the translation, without explanations or notes.',
    'Keep the same meaning and tone as the original.',
  ].join(' ');
}

module.exports = {
  name: 'translate',
  aliases: ['tr'],
  category: 'ai',
  description: 'Terjemahkan teks ke bahasa tujuan',
  descriptionKey: 'commands.translate.description',
  usage: 'translate <bahasa> <teks>',
  examples: ['translate en selamat pagi', 'translate id (reply pesan)'],
  permission: 'user',
  scope: 'all',
  cooldown: 4,
  timeoutMs: 120_000,

  async execute(ctx) {
    const ai = ctx.services?.ai;
    if (!ai) return ctx.t('ai.unavailable');
    if (!ai.config?.enabled) return ctx.t('ai.disabled');

    const args = ctx.args || [];
    const quoted = quotedMessage(ctx);
    const repliedText = quoted ? extractText(quoted.content) : '';

    let lang = 'id';
    let text = '';

    if (repliedText) {
      // Reply → argumen pertama (bila ada) adalah bahasa tujuan.
      lang = args[0] || 'id';
      text = repliedText;
    } else if (args.length === 0) {
      return ctx.t('translate.usage', { prefix: ctx.prefix, command: ctx.command.name });
    } else if (args.length === 1) {
      // Hanya satu argumen → dianggap teks, bahasa default `id`.
      text = args[0];
    } else {
      lang = args[0];
      text = args.slice(1).join(' ');
    }

    if (!text.trim()) {
      return ctx.t('translate.usage', { prefix: ctx.prefix, command: ctx.command.name });
    }

    await ctx.react('⏳');

    try {
      const result = await ai.generate({
        system: translatePrompt(lang),
        messages: [{ role: 'user', content: text }],
      });

      await ctx.react('✅');
      return result.text;
    } catch (error) {
      ctx.logger?.warn?.(
        { code: error?.code || 'TRANSLATE_FAILED', chat: ctx.chatId },
        'Terjemahan gagal',
      );
      await ctx.react('❌');
      return describeAiError(ctx, error);
    }
  },
};
