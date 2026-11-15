/**
 * Utilitas teks dan parsing command.
 */

const MESSAGE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
];

/**
 * Membuka wrapper pesan Baileys sampai mendapatkan konten inti.
 * @param {object|null} message
 * @returns {object|null}
 */
function unwrapMessage(message) {
  let current = message;

  for (let i = 0; i < 5 && current; i += 1) {
    let next = null;

    for (const wrapper of MESSAGE_WRAPPERS) {
      if (current[wrapper]?.message) {
        next = current[wrapper].message;
        break;
      }
    }

    if (!next) break;
    current = next;
  }

  return current || null;
}

/**
 * Mengambil teks dari berbagai tipe pesan WhatsApp.
 * @param {object|null} content
 * @returns {string}
 */
function extractText(content) {
  if (!content) return '';

  const candidates = [
    content.conversation,
    content.extendedTextMessage?.text,
    content.imageMessage?.caption,
    content.videoMessage?.caption,
    content.documentMessage?.caption,
    content.buttonsResponseMessage?.selectedButtonId,
    content.listResponseMessage?.singleSelectReply?.selectedRowId,
    content.templateButtonReplyMessage?.selectedId,
    content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

/**
 * @param {string} text
 * @param {string[]} prefixes
 * @returns {{prefix: string, commandName: string, args: string[], rawArgs: string}|null}
 */
function parseCommand(text, prefixes) {
  if (typeof text !== 'string' || !text.trim()) return null;
  if (!Array.isArray(prefixes) || prefixes.length === 0) return null;

  const value = text.trim();
  const prefix = prefixes.find((item) => item && value.startsWith(item));
  if (!prefix) return null;

  const body = value.slice(prefix.length).trim();
  if (!body) return null;

  const firstSpace = body.search(/\s/);
  const commandName = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
  if (!/^[a-z0-9_-]+$/i.test(commandName)) return null;

  const rawArgs = firstSpace === -1 ? '' : body.slice(firstSpace).trim();
  const args = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];

  return { prefix, commandName, args, rawArgs };
}

/**
 * Menghindari nama user merusak format pesan.
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
function sanitizeName(value, maxLength = 40) {
  return String(value || 'Kak')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength) || 'Kak';
}

/**
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(value, maxLength = 120) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

module.exports = {
  MESSAGE_WRAPPERS,
  unwrapMessage,
  extractText,
  parseCommand,
  sanitizeName,
  truncate,
};
