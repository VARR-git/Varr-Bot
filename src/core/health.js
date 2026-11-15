/**
 * Laporan kesehatan bot untuk log, `.ping`, dan dashboard nanti.
 */

const os = require('node:os');

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.db
 * @param {object} options.state
 * @param {object} [options.registry]
 * @param {object} [options.connection]
 */
function buildHealthReport({ config, db, state, registry, connection }) {
  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  return {
    bot: {
      name: config.botName,
      version: config.version,
      node: process.version,
      platform: process.platform,
      uptimeSeconds: state?.uptime?.() ?? Math.floor(process.uptime()),
    },
    runtime: {
      mode: state?.mode ?? config.mode,
      maintenance: Boolean(state?.maintenance),
      commands: registry?.size ?? 0,
    },
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      systemTotal: totalMemory,
      systemFree: freeMemory,
    },
    database: db?.health?.() ?? { ok: false },
    connection: connection?.getStatus?.() ?? null,
  };
}

module.exports = {
  buildHealthReport,
};
