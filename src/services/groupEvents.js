/**
 * Event grup: welcome dan goodbye.
 *
 * Dipanggil dari `group-participants.update`. Hanya bereaksi pada aksi
 * `add` dan `remove`; promote/demote tidak mengirim pesan agar tidak berisik.
 */

const { createTranslator } = require('../core/i18n');
const { jidToNumber } = require('../utils/jid');
const { findParticipant } = require('../utils/group');
const { sanitizeName, truncate } = require('../utils/text');

const MAX_PARTICIPANTS_PER_EVENT = 10;
const MAX_TEMPLATE_LENGTH = 1_000;

/**
 * @param {string} template
 * @param {Record<string, string|number>} vars
 * @returns {string}
 */
function renderTemplate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  ));
}

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.db
 * @param {object} options.logger
 * @param {(sock: object, groupId: string) => Promise<object>} options.getGroupMetadata
 */
function createGroupEvents({ config, db, logger, getGroupMetadata }) {
  const t = createTranslator(config.defaultLang);

  /**
   * @param {object} sock
   * @param {{id: string, action: string, participants?: string[]}} event
   */
  async function handle(sock, event) {
    const groupId = String(event?.id || '');
    if (!groupId.endsWith('@g.us')) return;

    const action = String(event?.action || '').toLowerCase();
    if (action !== 'add' && action !== 'remove') return;

    const setting = action === 'add' ? 'welcome' : 'goodbye';
    if (!db.getGroupSetting(groupId, setting, false)) return;

    let metadata = null;
    try {
      metadata = await getGroupMetadata(sock, groupId);
    } catch (error) {
      logger?.debug?.(
        { err: error, group: groupId },
        'Gagal mengambil metadata untuk pesan grup',
      );
    }

    const custom = String(db.getGroupSetting(groupId, `${setting}_text`, '') || '')
      .trim()
      .slice(0, MAX_TEMPLATE_LENGTH);
    const template = custom || t(`groupEvents.${setting}Default`);
    if (!template.trim()) return;

    const participants = (Array.isArray(event.participants) ? event.participants : [])
      .filter(Boolean)
      .slice(0, MAX_PARTICIPANTS_PER_EVENT);

    for (const jid of participants) {
      const participant = findParticipant(metadata, [jid]);
      const number = jidToNumber(jid) || String(jid).split('@')[0];
      const name = sanitizeName(
        participant?.name || participant?.notify || participant?.verifiedName || number,
      );

      const text = renderTemplate(template, {
        name,
        number,
        mention: `@${number}`,
        group: metadata?.subject || t('groupEvents.fallbackGroup'),
        desc: truncate(metadata?.desc || '-', 300),
        count: metadata?.participants?.length ?? 0,
      }).trim();

      if (!text) continue;

      try {
        await sock.sendMessage(groupId, {
          text,
          mentions: [jid],
        });
      } catch (error) {
        logger?.warn?.(
          { err: error, group: groupId },
          'Gagal mengirim pesan welcome/goodbye',
        );
      }
    }

    logger?.info?.(
      { group: groupId, action, count: participants.length },
      'Pesan event grup diproses',
    );
  }

  return { handle };
}

module.exports = {
  MAX_PARTICIPANTS_PER_EVENT,
  MAX_TEMPLATE_LENGTH,
  renderTemplate,
  createGroupEvents,
};
