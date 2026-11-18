/**
 * Helper status chatbot per chat/grup (persisten di database).
 *
 * - Grup memakai `group_settings` dengan key `chatbot`.
 * - Private chat memakai `settings` dengan key `chatbot:<jid>`.
 */

const { normalizeJid } = require('./jid');

/**
 * @param {object} db
 * @param {string} chatId
 * @param {boolean} isGroup
 * @returns {boolean}
 */
function isChatbotEnabled(db, chatId, isGroup) {
  if (!db) return false;
  return isGroup
    ? Boolean(db.getGroupSetting(chatId, 'chatbot', false))
    : Boolean(db.getSetting(`chatbot:${normalizeJid(chatId)}`, false));
}

/**
 * @param {object} db
 * @param {string} chatId
 * @param {boolean} isGroup
 * @param {boolean} enabled
 */
function setChatbotEnabled(db, chatId, isGroup, enabled) {
  const value = Boolean(enabled);
  if (isGroup) {
    db.setGroupSetting(chatId, 'chatbot', value);
  } else {
    db.setSetting(`chatbot:${normalizeJid(chatId)}`, value);
  }
}

module.exports = {
  isChatbotEnabled,
  setChatbotEnabled,
};
