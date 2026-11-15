/**
 * Adapter Baileys: koneksi, QR/pairing, reconnect, dan shutdown.
 *
 * Semua detail library diisolasi di sini agar upgrade Baileys tidak menyebar
 * ke seluruh kode.
 */

const {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { maskJid } = require('../utils/jid');

const FATAL_STATUS_CODES = new Set([
  DisconnectReason.loggedOut,
  DisconnectReason.forbidden,
  DisconnectReason.multideviceMismatch,
  DisconnectReason.connectionReplaced,
]);

const MAX_RECONNECT_DELAY_MS = 30_000;
const PAIRING_DELAY_MS = 3_000;

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.logger
 * @param {object} options.baileysLogger
 * @param {(sock: object, event: object) => Promise<void>} options.onMessage
 * @param {(sock: object, event: object) => Promise<void>} [options.onGroupParticipants]
 * @param {(groupIds: string[]) => void} [options.onGroupsUpdate]
 * @param {(sock: object) => void} [options.onReady]
 * @param {(error: Error) => void} [options.onFatal]
 * @param {object} [options.messageCache] Cache pesan untuk `getMessage`.
 * @param {(sock: object, groupId: string) => Promise<object>} [options.getGroupMetadata]
 */
function createConnection({
  config,
  logger,
  baileysLogger,
  onMessage,
  onGroupParticipants,
  onGroupsUpdate,
  onReady,
  onFatal,
  messageCache,
  getGroupMetadata,
}) {
  /** @type {object|null} */
  let sock = null;
  let status = 'idle';
  let attempts = 0;
  let stopping = false;
  let reconnectTimer = null;
  let pairingTimer = null;
  let authPromise = null;
  let versionPromise = null;
  let pairingFailed = false;

  function getAuthState() {
    if (!authPromise) authPromise = useMultiFileAuthState(config.authDir);
    return authPromise;
  }

  function getVersion() {
    if (!versionPromise) {
      versionPromise = fetchLatestBaileysVersion().catch((error) => {
        logger.warn({ error: error.message }, 'Gagal mengambil versi WhatsApp Web, memakai default Baileys');
        return null;
      });
    }
    return versionPromise;
  }

  function clearTimers() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pairingTimer) {
      clearTimeout(pairingTimer);
      pairingTimer = null;
    }
  }

  function scheduleReconnect(reason) {
    if (stopping || reconnectTimer) return;

    const attempt = attempts;
    attempts += 1;

    const base = reason === DisconnectReason.restartRequired
      ? 500
      : Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * (2 ** attempt));
    const delay = Math.max(500, Math.round(base * (0.8 + Math.random() * 0.4)));

    logger.warn({ attempt: attempt + 1, delay, reason }, 'Menjadwalkan reconnect');

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      start().catch((error) => {
        logger.error({ err: error }, 'Gagal memulai ulang koneksi');
        scheduleReconnect('start-failed');
      });
    }, delay);
  }

  /**
   * @param {object} socket
   * @param {object} update
   */
  async function handleConnectionUpdate(socket, update) {
    if (socket !== sock) return;

    const { connection, lastDisconnect, qr, isNewLogin } = update;

    if (connection === 'connecting') {
      status = 'connecting';
      return;
    }

    if (qr && (config.loginMethod !== 'pairing' || pairingFailed)) {
      logger.info('Scan QR berikut dengan WhatsApp → Perangkat tertaut');
      qrcode.generate(qr, { small: true });
      return;
    }

    if (connection === 'open') {
      status = 'open';
      attempts = 0;
      logger.info(
        { user: socket.user?.id ? maskJid(socket.user.id) : null, isNewLogin: Boolean(isNewLogin) },
        'Terhubung ke WhatsApp',
      );
      onReady?.(socket);
      return;
    }

    if (connection !== 'close') return;

    status = 'closed';
    const statusCode = lastDisconnect?.error?.output?.statusCode
      ?? lastDisconnect?.error?.statusCode
      ?? DisconnectReason.connectionClosed;

    logger.warn(
      { statusCode, reason: lastDisconnect?.error?.message || null },
      'Koneksi WhatsApp terputus',
    );

    if (stopping) return;
    if (socket === sock) sock = null;

    if (FATAL_STATUS_CODES.has(statusCode)) {
      logger.error(
        { statusCode },
        'Session tidak bisa dilanjutkan. Hapus folder AUTH_DIR lalu pairing ulang.',
      );
      stopping = true;
      onFatal?.(new Error(`Koneksi dihentikan permanen (status ${statusCode})`));
      return;
    }

    scheduleReconnect(statusCode);
  }

  /**
   * @param {object} socket
   * @param {object} auth
   */
  function requestPairingCode(socket, auth) {
    if (
      config.loginMethod !== 'pairing'
      || !config.pairingNumber
      || auth.creds.registered
      || pairingTimer
      || stopping
    ) {
      return;
    }

    pairingTimer = setTimeout(async () => {
      pairingTimer = null;
      if (stopping || socket !== sock) return;

      try {
        const code = await socket.requestPairingCode(config.pairingNumber);
        pairingFailed = false;
        logger.info({ number: maskJid(`${config.pairingNumber}@s.whatsapp.net`) }, 'Pairing code dibuat');
        // Ditulis ke stdout agar terlihat di console Pterodactyl/Docker.
        console.log('\n╭──────────────────────────╮');
        console.log(`│  Pairing Code: ${code}  │`);
        console.log('╰──────────────────────────╯');
        console.log('Buka WhatsApp → Perangkat tertaut → Tautkan dengan nomor telepon.');
        console.log('Masukkan kode di atas. Kode berlaku beberapa menit.\n');
      } catch (error) {
        pairingFailed = true;
        logger.error(
          { err: error },
          'Gagal meminta pairing code. QR akan ditampilkan sebagai fallback bila tersedia.',
        );
      }
    }, PAIRING_DELAY_MS);
  }

  async function start() {
    if (stopping) return null;
    if (sock && (status === 'open' || status === 'connecting')) return sock;

    clearTimers();
    status = 'connecting';

    const [{ state: auth, saveCreds }, versionInfo] = await Promise.all([
      getAuthState(),
      getVersion(),
    ]);

    const socket = makeWASocket({
      auth,
      ...(versionInfo?.version ? { version: versionInfo.version } : {}),
      logger: baileysLogger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      retryRequestDelayMs: 250,
      // Baileys memanggil ini saat penerima minta kirim ulang pesan.
      getMessage: async (key) => messageCache?.get(key),
      ...(getGroupMetadata
        ? {
          cachedGroupMetadata: async (jid) => {
            try {
              return await getGroupMetadata(sock, jid);
            } catch {
              return undefined;
            }
          },
        }
        : {}),
    });

    sock = socket;

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
      handleConnectionUpdate(socket, update).catch((error) => {
        logger.error({ err: error }, 'Gagal memproses connection.update');
      });
    });

    socket.ev.on('messages.upsert', (event) => {
      // Simpan pesan masuk agar event/poll dan retry bisa menemukannya.
      if (event?.type === 'notify') {
        for (const incoming of event.messages || []) {
          if (incoming?.key && incoming?.message) {
            messageCache?.set(incoming.key, incoming.message);
          }
        }
      }

      Promise.resolve(onMessage?.(socket, event)).catch((error) => {
        logger.error({ err: error }, 'Gagal memproses messages.upsert');
      });
    });

    const invalidateGroups = (items) => {
      const ids = (Array.isArray(items) ? items : [items])
        .map((item) => item?.id)
        .filter(Boolean);
      if (ids.length > 0) onGroupsUpdate?.(ids);
    };

    socket.ev.on('groups.update', invalidateGroups);
    socket.ev.on('groups.upsert', invalidateGroups);
    socket.ev.on('group-participants.update', (event) => {
      // Invalidasi dulu agar welcome/goodbye membaca metadata terbaru.
      invalidateGroups([event]);
      Promise.resolve(onGroupParticipants?.(socket, event)).catch((error) => {
        logger.error({ err: error }, 'Gagal memproses group-participants.update');
      });
    });

    requestPairingCode(socket, auth);

    return socket;
  }

  async function stop() {
    stopping = true;
    clearTimers();

    const current = sock;
    sock = null;
    status = 'stopped';

    if (!current) return;

    try {
      await Promise.race([
        current.end(undefined),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 3_000);
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]);
    } catch (error) {
      logger.debug({ error: error.message }, 'Socket ditutup dengan error saat shutdown');
    }
  }

  function getStatus() {
    return {
      state: status,
      connected: status === 'open',
      attempts,
      user: sock?.user?.id ? maskJid(sock.user.id) : null,
      loginMethod: config.loginMethod,
    };
  }

  return {
    start,
    stop,
    getStatus,
    get socket() {
      return sock;
    },
  };
}

module.exports = {
  createConnection,
  FATAL_STATUS_CODES,
  MAX_RECONNECT_DELAY_MS,
};
