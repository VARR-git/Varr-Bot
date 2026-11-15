/**
 * Utilitas JID WhatsApp.
 */

/**
 * @param {string} jid
 * @returns {string}
 */
function normalizeJid(jid = '') {
  const value = String(jid || '').trim();
  if (!value) return '';
  const [local, domain = ''] = value.split('@');
  return `${local.split(':')[0]}@${domain}`.replace(/@$/, '');
}

/**
 * @param {string} jid
 * @returns {string}
 */
function jidToNumber(jid = '') {
  return String(jid || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameJid(a, b) {
  if (!a || !b) return false;
  return normalizeJid(a) === normalizeJid(b) || jidToNumber(a) === jidToNumber(b);
}

/**
 * @param {string} jid
 * @returns {boolean}
 */
function isGroupJid(jid = '') {
  return String(jid).endsWith('@g.us');
}

/**
 * @param {string} jid
 * @returns {boolean}
 */
function isStatusJid(jid = '') {
  return String(jid) === 'status@broadcast';
}

/**
 * JID yang bisa dipercaya sebagai nomor telepon (bukan LID).
 * Dipakai untuk mencocokkan owner agar LID tidak bisa menyamar.
 *
 * @param {string} jid
 * @returns {boolean}
 */
function isPhoneJid(jid = '') {
  const value = String(jid || '').trim();
  if (!value) return false;
  const domain = value.split('@')[1]?.split(':')[0] || '';
  return domain === '' || domain === 's.whatsapp.net';
}

/**
 * @param {string} jid
 * @returns {string}
 */
function maskJid(jid = '') {
  const number = jidToNumber(jid);
  const domain = String(jid).split('@')[1] || 'unknown';
  if (number.length <= 6) return `***@${domain}`;
  return `${number.slice(0, 4)}****${number.slice(-2)}@${domain}`;
}

/**
 * Mengumpulkan semua varian JID pengirim (PN, LID, participantAlt).
 * @param {object} msg
 * @param {string} chatId
 * @returns {string[]}
 */
function collectSenderIds(msg, chatId) {
  const key = msg?.key || {};
  const values = [
    key.participant,
    key.participantAlt,
    key.participantPn,
    key.remoteJidAlt,
    key.senderPn,
    msg?.participant,
    msg?.senderPn,
    isGroupJid(chatId) ? null : chatId,
  ];

  return [...new Set(values.filter(Boolean).map(normalizeJid))];
}

module.exports = {
  normalizeJid,
  jidToNumber,
  sameJid,
  isGroupJid,
  isStatusJid,
  isPhoneJid,
  maskJid,
  collectSenderIds,
};
