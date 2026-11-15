/**
 * Cache metadata grup dan pengecekan admin.
 */

const { jidToNumber, normalizeJid } = require('./jid');

const DEFAULT_TTL_MS = 60_000;

/**
 * @param {{ttlMs?: number, logger?: object}} options
 */
function createGroupMetadataCache({ ttlMs = DEFAULT_TTL_MS, logger } = {}) {
  const cache = new Map();

  /**
   * @param {object} sock
   * @param {string} groupId
   * @returns {Promise<object>}
   */
  async function getGroupMetadata(sock, groupId) {
    const now = Date.now();
    const cached = cache.get(groupId);
    if (cached && cached.expiresAt > now) return cached.data;

    try {
      const data = await sock.groupMetadata(groupId);
      cache.set(groupId, { data, expiresAt: now + ttlMs });
      return data;
    } catch (error) {
      logger?.debug?.({ error: error.message, group: groupId }, 'Gagal mengambil metadata grup');
      throw error;
    }
  }

  /**
   * @param {string} groupId
   */
  getGroupMetadata.invalidate = (groupId) => {
    if (groupId) cache.delete(groupId);
  };

  getGroupMetadata.clear = () => cache.clear();
  getGroupMetadata.size = () => cache.size;

  return getGroupMetadata;
}

/**
 * Identitas JID dengan domain agar LID dan nomor telepon tidak tertukar.
 * @param {string} jid
 * @returns {{normalized: string, number: string, domain: string}|null}
 */
function toIdentity(jid) {
  const value = String(jid || '').trim();
  if (!value) return null;

  const number = jidToNumber(value);
  if (!number) return null;

  return {
    normalized: normalizeJid(value),
    number,
    domain: value.split('@')[1]?.split(':')[0] || '',
  };
}

/**
 * @param {{normalized: string, number: string, domain: string}} a
 * @param {{normalized: string, number: string, domain: string}} b
 * @returns {boolean}
 */
function sameIdentity(a, b) {
  if (a.normalized === b.normalized) return true;
  if (a.number !== b.number) return false;
  // Nomor tanpa domain (format lama/robust) boleh dicocokkan.
  if (!a.domain || !b.domain) return true;
  return a.domain === b.domain;
}

/**
 * @param {object} participant
 * @returns {string[]}
 */
function participantIds(participant) {
  return [participant?.id, participant?.lid, participant?.phoneNumber, participant?.jid]
    .filter(Boolean)
    .map(normalizeJid);
}

/**
 * @param {object} metadata
 * @param {string[]|string} jids
 * @returns {object|null}
 */
function findParticipant(metadata, jids) {
  if (!metadata || !Array.isArray(metadata.participants)) return null;

  const values = Array.isArray(jids) ? jids : [jids];
  const targets = values.map(toIdentity).filter(Boolean);
  if (targets.length === 0) return null;

  return metadata.participants.find((participant) => {
    const ids = participantIds(participant).map(toIdentity).filter(Boolean);
    return ids.some((id) => targets.some((target) => sameIdentity(id, target)));
  }) || null;
}

/**
 * @param {object} metadata
 * @param {string[]} senderIds
 * @returns {boolean}
 */
function isParticipantAdmin(metadata, senderIds = []) {
  if (!metadata || !Array.isArray(metadata.participants)) return false;

  const targets = senderIds.map(toIdentity).filter(Boolean);
  if (targets.length === 0) return false;

  return metadata.participants.some((participant) => {
    const isAdmin = participant.admin === 'admin'
      || participant.admin === 'superadmin'
      || participant.isAdmin
      || participant.isSuperAdmin;

    if (!isAdmin) return false;

    const ids = participantIds(participant).map(toIdentity).filter(Boolean);

    return ids.some((id) => targets.some((target) => sameIdentity(id, target)));
  });
}

/**
 * @param {object} metadata
 * @param {object} sock
 * @returns {boolean}
 */
function isBotAdmin(metadata, sock) {
  const ids = [sock?.user?.id, sock?.user?.lid].filter(Boolean);
  return ids.length > 0 && isParticipantAdmin(metadata, ids);
}

/**
 * Mengambil `contextInfo` dari konten pesan apa pun.
 * @param {object|null} content
 * @returns {object|null}
 */
function getContextInfo(content) {
  if (!content || typeof content !== 'object') return null;

  for (const value of Object.values(content)) {
    if (value && typeof value === 'object' && value.contextInfo) {
      return value.contextInfo;
    }
  }

  return null;
}

module.exports = {
  createGroupMetadataCache,
  participantIds,
  findParticipant,
  isParticipantAdmin,
  isBotAdmin,
  getContextInfo,
  toIdentity,
  sameIdentity,
};
