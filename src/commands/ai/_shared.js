/**
 * Helper bersama command AI (`ai`, `resetai`, `summary`).
 *
 * File ini sengaja diawali `_` agar tidak dimuat sebagai command oleh
 * `loadCommands` (lihat `core/registry.js`).
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { MEDIA_HOST } = require('../../services/media');
const { getContextInfo } = require('../../utils/group');
const { unwrapMessage, extractText } = require('../../utils/text');

const TEXT_DOC_MIME = /^text\//;
const TEXT_DOC_EXT = /\.(txt|text|md|markdown|json|log|csv)$/i;
const MAX_DOC_CHARS = 50_000;

/**
 * Scope memori: per chat (grup) atau per user (private).
 *
 * @param {object} ctx
 * @returns {string}
 */
function resolveScope(ctx) {
  return ctx.isGroup ? ctx.chatId : ctx.senderId;
}

/**
 * Ambil pesan yang di-reply (quoted) dari sebuah pesan, sudah di-unwrap.
 *
 * @param {object} ctx
 * @returns {{content: object, context: object}|null}
 */
function quotedMessage(ctx) {
  const content = unwrapMessage(ctx.msg?.message);
  const context = content ? getContextInfo(content) : null;
  const quoted = context?.quotedMessage ? unwrapMessage(context.quotedMessage) : null;
  return quoted ? { content: quoted, context } : null;
}

/**
 * Ambil teks masukan command: dari argumen, atau dari pesan yang di-reply.
 *
 * @param {object} ctx
 * @returns {string|null}
 */
function readInputText(ctx) {
  if (ctx.rawArgs && ctx.rawArgs.trim()) return ctx.rawArgs.trim();

  const quoted = quotedMessage(ctx);
  if (!quoted) return null;

  const text = extractText(quoted.content);
  return text || null;
}

/**
 * Coba unduh dokumen teks dari pesan yang di-reply (untuk `.summary`).
 * Mengembalikan null bila bukan dokumen teks atau unduhan gagal.
 *
 * @param {object} ctx
 * @returns {Promise<string|null>}
 */
async function readDocumentText(ctx) {
  const quoted = quotedMessage(ctx);
  const doc = quoted?.content?.documentMessage;
  if (!doc) return null;

  const mimetype = String(doc.mimetype || '');
  const filename = String(doc.fileName || '');
  if (!TEXT_DOC_MIME.test(mimetype) && !TEXT_DOC_EXT.test(filename)) return null;

  const message = {
    key: {
      remoteJid: ctx.msg?.key?.remoteJid,
      id: quoted.context?.stanzaId || `quoted-${Date.now()}`,
      fromMe: false,
      participant: quoted.context?.participant,
    },
    message: { documentMessage: doc },
  };

  try {
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      { host: MEDIA_HOST },
      { logger: ctx.logger },
    );
    const text = buffer.toString('utf8');
    return text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) : text;
  } catch (error) {
    ctx.logger?.warn?.(
      { error: error.message, chat: ctx.chatId },
      'Gagal membaca dokumen untuk ringkasan',
    );
    return null;
  }
}

/**
 * Petakan kode error AI menjadi pesan terjemahan ramah pengguna.
 *
 * @param {object} ctx
 * @param {Error} error
 * @returns {string}
 */
function describeAiError(ctx, error) {
  switch (error?.code) {
    case 'AI_DISABLED':
      return ctx.t('ai.disabled');
    case 'AI_QUOTA_EXCEEDED':
      return ctx.t('ai.quotaExceeded');
    case 'AI_ALL_PROVIDERS_FAILED':
    case 'AI_PROVIDER_ERROR':
      return ctx.t('ai.unavailable');
    default:
      return ctx.t('ai.failed');
  }
}

module.exports = {
  resolveScope,
  readInputText,
  readDocumentText,
  describeAiError,
  quotedMessage,
};
