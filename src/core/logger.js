/**
 * Logger terstruktur dengan redaksi rahasia.
 */

const pino = require('pino');

const REDACT_PATHS = [
  'apiKey',
  'api_key',
  'token',
  'password',
  'secret',
  'authorization',
  'headers.authorization',
  '*.apiKey',
  '*.api_key',
  '*.token',
  '*.password',
  '*.secret',
  '*.authorization',
  'config.databaseUrl',
  'config.ownerNumbers',
];

/**
 * @param {object} config
 */
function createLogger(config) {
  return pino({
    level: config.logLevel,
    base: { service: 'varr-bot', version: config.version },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  });
}

/**
 * Logger khusus Baileys agar log library tidak membanjiri output.
 */
function createBaileysLogger() {
  return pino({ level: 'silent' });
}

module.exports = {
  createLogger,
  createBaileysLogger,
  REDACT_PATHS,
};
