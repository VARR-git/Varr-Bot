const { setTimeout: wait } = require('node:timers/promises');
const { randomInt } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync } = require('node:fs');
const { normalizeJid, sameJid } = require('../utils/jid');

const TTL = 15 * 60_000;
const DAILY_LIMIT = 20;
const sockets = new WeakMap();

function createAutomation(now = Date.now, quotaFile) {
  const flags = new Set();
  const cache = new Map();
  const reminders = new Set();
  let batch;
  let socket;
  let day;
  let used = 0;

  const cacheKey = (key) => JSON.stringify([normalizeJid(key.remoteJid), key.id]);
  const sender = (key) => key.participant || key.remoteJid;

  function forget(key) {
    const id = cacheKey(key);
    clearTimeout(cache.get(id)?.timer);
    cache.delete(id);
  }

  function remember(msg, content) {
    const key = msg.key;
    if (!key.id || key.fromMe || !content) return;
    // shortcut: restore ordinary text and media only; add explicit policies before supporting other types.
    if (!['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage']
      .some((type) => content[type])) return;
    if (Object.keys(content).some((type) => content[type]?.viewOnce)
      || Object.keys(msg.message).some((type) => /^(viewOnce|ephemeral)/.test(type))) return;
    forget(key);
    if (cache.size >= 500) forget(cache.values().next().value.msg.key);
    const timer = setTimeout(() => forget(key), TTL).unref();
    cache.set(cacheKey(key), { msg, content, expires: now() + TTL, timer });
  }

  function recall(key) {
    if (!key?.remoteJid || !key.id) return;
    const entry = cache.get(cacheKey(key));
    if (entry && entry.expires <= now()) {
      forget(key);
      return;
    }
    if (entry && sameJid(sender(entry.msg.key), sender(key))) return entry;
  }

  async function restore(sock, msg, revoke, t) {
    const key = revoke?.key;
    const chat = msg.key.remoteJid;
    if (revoke?.type !== 0 || !key || key.fromMe || !sameJid(key.remoteJid, chat)) return;
    const actor = sender(msg.key);
    if (key.participant && !sameJid(key.participant, actor)) return;
    const original = recall({ ...key, participant: actor });
    if (!original) return;
    forget(key);
    const owner = sender(original.msg.key);
    const header = t('automation.restored', { sender: owner.split('@')[0] });
    const text = original.content.conversation ?? original.content.extendedTextMessage?.text;
    if (typeof text === 'string') {
      await sock.sendMessage(chat, { text: `${header}\n${text}` });
    } else {
      await sock.sendMessage(chat, { text: header, mentions: [owner] });
      await sock.sendMessage(chat, { forward: { ...original.msg, message: original.content } });
    }
  }

  function toggle(name, enabled) {
    if (enabled) flags.add(name);
    else {
      flags.delete(name);
      if (name === 'broadcast') batch?.abort();
      if (name === 'save' || name === 'antidelete') purge(name === 'save');
    }
  }

  function purge(status, chat) {
    for (const { msg } of cache.values()) {
      const jid = msg.key.remoteJid;
      if (chat ? sameJid(chat, jid) : (jid === 'status@broadcast') === status) forget(msg.key);
    }
  }

  function refreshQuota() {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (day !== today) {
      let quota;
      if (quotaFile) {
        try {
          quota = JSON.parse(readFileSync(quotaFile, 'utf8'));
          if (!Number.isInteger(quota.used) || quota.used < 0) throw new Error('Invalid broadcast quota');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      day = today;
      used = quota?.day === today ? quota.used : 0;
    }
  }

  async function broadcast(targets, send, pause = wait) {
    if (!flags.has('broadcast')) return 'disabled';
    if (batch) return 'busy';
    refreshQuota();
    if (targets.length > DAILY_LIMIT - used) return 'quota';
    const controller = new AbortController();
    batch = controller;
    let sent = 0;
    try {
      for (const target of targets) {
        if (sent) await pause(randomInt(2_000, 4_001), undefined, { signal: controller.signal });
        if (controller.signal.aborted) break;
        refreshQuota();
        if (used >= DAILY_LIMIT) break;
        // Attempts count too: a transport failure may still have reached WhatsApp.
        used += 1;
        if (quotaFile) {
          writeFileSync(`${quotaFile}.tmp`, JSON.stringify({ day, used }), { mode: 0o600 });
          renameSync(`${quotaFile}.tmp`, quotaFile);
        }
        await send(target);
        sent += 1;
      }
    } catch (error) {
      if (!controller.signal.aborted || error.name !== 'AbortError') throw error;
    } finally {
      batch = undefined;
    }
    return sent;
  }

  async function rejectCalls(sock, calls, warning) {
    for (const call of calls) {
      if (!flags.has('anticall')) break;
      if (call.status !== 'offer' || call.isGroup || !call.id || !/@(?:s\.whatsapp\.net|lid)$/.test(call.from)) continue;
      await sock.rejectCall(call.id, call.from);
      await sock.sendMessage(call.from, { text: warning });
    }
  }

  function remind(delay, send, onError) {
    if (reminders.size >= 100) return false;
    const timer = setTimeout(() => {
      reminders.delete(timer);
      if (socket) Promise.resolve().then(() => send(socket)).catch(onError);
    }, delay).unref();
    reminders.add(timer);
    return true;
  }

  return {
    enabled: (name) => flags.has(name),
    toggle, remember, recall, restore, purge, broadcast, rejectCalls, remind,
    attach(sock) {
      socket = sock;
      sockets.set(sock, this);
    },
    disconnect(sock) {
      if (socket === sock) {
        socket = undefined;
        batch?.abort();
      }
    },
    dispose() {
      socket = undefined;
      batch?.abort();
      for (const timer of reminders) clearTimeout(timer);
      reminders.clear();
      for (const { msg } of cache.values()) forget(msg.key);
    },
  };
}

function automationFor(sock) {
  if (!sockets.has(sock)) createAutomation().attach(sock);
  return sockets.get(sock);
}

module.exports = { automationFor, createAutomation, DAILY_LIMIT, TTL };
