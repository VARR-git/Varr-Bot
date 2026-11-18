/**
 * `.ai` — tanya AI dengan konteks percakapan per chat.
 *
 * Menerima pertanyaan langsung (`.ai <pertanyaan>`) atau reply ke sebuah
 * pesan. Riwayat disimpan lewat `aiMemory` agar percakapan punya konteks.
 */

const {
  resolveScope,
  readInputText,
  describeAiError,
} = require('./_shared');

module.exports = {
  name: 'ai',
  aliases: ['ask', 'tanya', 'gpt'],
  category: 'ai',
  description: 'Tanya AI dengan konteks percakapan',
  descriptionKey: 'commands.ai.description',
  usage: 'ai <pertanyaan>',
  examples: ['ai apa itu black hole', 'ai (reply pesan)'],
  permission: 'user',
  scope: 'all',
  cooldown: 5,
  timeoutMs: 120_000,

  async execute(ctx) {
    const ai = ctx.services?.ai;
    const memory = ctx.services?.aiMemory;

    if (!ai) return ctx.t('ai.unavailable');
    if (!ai.config?.enabled) return ctx.t('ai.disabled');

    const input = readInputText(ctx);
    if (!input) {
      return ctx.t('ai.usage', { prefix: ctx.prefix, command: ctx.command.name });
    }

    const scope = resolveScope(ctx);
    const history = memory ? memory.get(scope) : [];
    const messages = [...history, { role: 'user', content: input }];

    await ctx.react('⏳');

    try {
      const result = await ai.generate({ messages }, scope);

      if (memory) {
        memory.append(scope, 'user', input);
        memory.append(scope, 'assistant', result.text);
      }

      await ctx.react('✅');
      return result.text;
    } catch (error) {
      ctx.logger?.warn?.(
        { code: error?.code || 'AI_FAILED', chat: ctx.chatId },
        'AI gagal menjawab',
      );
      await ctx.react('❌');
      return describeAiError(ctx, error);
    }
  },
};
