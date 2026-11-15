#!/usr/bin/env node
/**
 * Bootstrap Varr-Bot.
 *
 * Tanggung jawab file ini hanya merakit dependency, menjalankan koneksi,
 * dan menangani shutdown. Logika bot ada di `core/`.
 */

const fs = require('node:fs');

const { loadConfig } = require('./config');
const { createBaileysLogger, createLogger } = require('./core/logger');
const { createDatabase } = require('./core/database');
const { createRuntimeState } = require('./core/state');
const { CommandRegistry, loadCommands } = require('./core/registry');
const { createDefaultMiddlewares } = require('./core/middleware');
const { createMessageHandler } = require('./core/handler');
const { createMessageCache } = require('./core/messageCache');
const { createConnection } = require('./core/connection');
const { createGroupMetadataCache } = require('./utils/group');
const { createGuardService } = require('./services/guard');
const { createGroupEvents } = require('./services/groupEvents');
const { createMediaService } = require('./services/media');
const { createDownloaderService } = require('./services/downloader');
const { buildHealthReport } = require('./core/health');

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`[Varr-Bot] Konfigurasi tidak valid: ${error.message}`);
    process.exit(1);
  }

  const logger = createLogger(config);
  const baileysLogger = createBaileysLogger();

  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.authDir, { recursive: true });
  fs.mkdirSync(config.tmpDir, { recursive: true });

  const backupsDir = config.backupsDir;

  let db;
  try {
    db = createDatabase({ config, logger });
  } catch (error) {
    logger.fatal({ err: error }, 'Gagal membuka database');
    process.exit(1);
  }

  const state = createRuntimeState({ config, db });
  const registry = new CommandRegistry({ logger });

  try {
    loadCommands(registry, { logger });
  } catch (error) {
    logger.fatal({ err: error }, 'Gagal memuat command');
    db.close();
    process.exit(1);
  }

  if (config.ownerNumbers.length === 0) {
    logger.warn(
      'OWNER_NUMBERS kosong. Command owner (.mode, .maintenance, dll.) tidak bisa dipakai siapa pun.',
    );
  }

  const getGroupMetadata = createGroupMetadataCache({ logger });
  const messageCache = createMessageCache();
  const media = createMediaService({ config, logger });
  const downloader = createDownloaderService({ config, logger });
  const guard = createGuardService({ config, db, logger, getGroupMetadata });
  const groupEvents = createGroupEvents({ config, db, logger, getGroupMetadata });

  const middlewares = createDefaultMiddlewares({
    config,
    db,
    state,
    getGroupMetadata,
    logger,
  });

  const handler = createMessageHandler({
    config,
    logger,
    registry,
    db,
    state,
    middlewares,
    services: { getGroupMetadata, messageCache, guard, media, downloader },
  });

  const connection = createConnection({
    config,
    logger,
    baileysLogger,
    messageCache,
    getGroupMetadata,
    onMessage: (sock, event) => handler.handleUpsert(sock, event),
    onGroupParticipants: (sock, event) => groupEvents.handle(sock, event),
    onGroupsUpdate: (groupIds) => groupIds.forEach((id) => getGroupMetadata.invalidate(id)),
    onReady: () => {
      const health = buildHealthReport({ config, db, state, registry, connection });
      logger.info(
        {
          database: health.database.ok ? 'ok' : 'error',
          schemaVersion: health.database.schemaVersion,
          commands: health.runtime.commands,
          mode: health.runtime.mode,
        },
        'Varr-Bot siap',
      );

      // Cek dependency downloader tanpa menahan koneksi.
      downloader.available().then((status) => {
        if (status.available) {
          logger.info({ version: status.version }, 'yt-dlp siap');
        } else {
          logger.warn(
            { binary: downloader.binary, error: status.error },
            'yt-dlp tidak tersedia; command downloader dinonaktifkan',
          );
        }
      }).catch((error) => {
        logger.debug?.({ err: error }, 'Gagal memeriksa yt-dlp');
      });
    },
    onFatal: (error) => {
      logger.fatal({ err: error }, 'Koneksi dihentikan permanen');
      shutdown(1);
    },
  });

  let backupTimer = null;
  let shutdownPromise = null;

  async function runBackup(reason) {
    if (!db?.isOpen || db.isMemory) return;

    try {
      const result = await db.backup({
        directory: backupsDir,
        keep: config.backupKeep,
        verify: reason === 'terjadwal',
      });
      logger.info(
        { path: result.path, size: result.sizeBytes, removed: result.removed, reason },
        'Backup database selesai',
      );
    } catch (error) {
      logger.error({ err: error, reason }, 'Backup database gagal');
    }
  }

  /**
   * @param {number} code
   */
  async function shutdown(code = 0) {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      logger.info({ code }, 'Menghentikan Varr-Bot...');

      if (backupTimer) {
        clearInterval(backupTimer);
        backupTimer = null;
      }

      try {
        const drained = await handler.drain(5_000);
        if (!drained) {
          logger.warn('Antrean command belum selesai saat shutdown');
        }
      } catch (error) {
        logger.warn({ err: error }, 'Gagal menunggu antrean command');
      }

      try {
        await connection.stop();
      } catch (error) {
        logger.warn({ err: error }, 'Gagal menutup koneksi dengan rapi');
      }

      handler.dispose();
      await runBackup('shutdown');

      try {
        db.close();
      } catch (error) {
        logger.warn({ err: error }, 'Gagal menutup database');
      }

      logger.info('Varr-Bot berhenti.');
      logger.flush?.();
      process.exit(code);
    })();

    return shutdownPromise;
  }

  process.once('SIGINT', () => {
    shutdown(0).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });

  process.once('SIGTERM', () => {
    shutdown(0).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown(1).catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection');
  });

  backupTimer = setInterval(() => {
    runBackup('terjadwal').catch((error) => {
      logger.error({ err: error }, 'Backup terjadwal gagal');
    });
  }, BACKUP_INTERVAL_MS);
  backupTimer.unref?.();

  logger.info(
    {
      bot: config.botName,
      node: process.version,
      mode: state.mode,
      maintenance: state.maintenance,
      prefixes: config.prefixes,
      commands: registry.size,
      queueMaxPending: config.queueMaxPending,
      database: db.filename,
      authDir: config.authDir,
      loginMethod: config.loginMethod,
    },
    'Memulai Varr-Bot',
  );

  try {
    await connection.start();
  } catch (error) {
    logger.fatal({ err: error }, 'Gagal memulai koneksi WhatsApp');
    await shutdown(1);
  }
}

main().catch((error) => {
  console.error('[Varr-Bot] Fatal:', error);
  process.exit(1);
});
