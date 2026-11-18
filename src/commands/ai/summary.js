/**
 * `.summary` — ringkas teks panjang tanpa menyimpan ke memori chat.
 *
 * Menerima teks langsung (`.summary <teks>`), reply ke pesan teks, atau
 * reply ke dokumen teks (txt/md/json/log/csv).
 */

const {
  readInputText,
  readDocumentText,
  describeAiError,
} = require('./_shared');

const SUMMARY_PROMPT = [
  'You are a concise summarizer.',
  'Summarize the text the user provides in the same language as the input.',
  'Return only the summary with the key points, without any preamble or meta commentary.',
].join(' ');

module.exports = {
  name: 'summary',
  aliases: ['ringkas', 'summarize', 'tldr'],
  category: 'ai',
  description: 'Ringkas teks panjang',
  descriptionKey: 'commands.summary.description',
  usage: 'summary <teks>',
  examples: ['summary (reply pesan panjang)', 'summary (reply dokumen teks)'],
  permission: 'user',
  scope: 'all',
  cooldown: 8,
  timeoutMs: 120_000,

  async execute(ctx) {
    const ai = ctx.services?.ai;
    if (!ai) return ctx.t('ai.unavailable');
    if (!ai.config?.enabled) return ctx.t('ai.disabled');

    let text = readInputText(ctx);

    if (!text) {
      text = await readDocumentText(ctx);
    }

    if (!text) {
      return ctx.t('summary.usage', { prefix: ctx.prefix, command: ctx.command.name });
    }

    await ctx.react('⏳');

    try {
      const result = await ai.generate({
        system: SUMMARY_PROMPT,
        messages: [{ role: 'user', content: text }],
      });

      await ctx.react('✅');
      return result.text;
    } catch (error) {
      ctx.logger?.warn?.(
        { code: error?.code || 'SUMMARY_FAILED', chat: ctx.chatId },
        'Ringkasan AI gagal',
      );
      await ctx.react('❌');
      return describeAiError(ctx, error);
    }
  },
};
