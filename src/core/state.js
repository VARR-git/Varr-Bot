/**
 * State runtime yang bisa diubah tanpa restart (mode & maintenance).
 */

const { VALID_MODES } = require('../config');
const { AppError } = require('./errors');

/**
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.db
 * @param {() => number} [options.now]
 */
function createRuntimeState({ config, db, now = Date.now }) {
  const storedMode = db.getSetting('mode', config.mode);
  const initialMode = VALID_MODES.includes(storedMode) ? storedMode : config.mode;

  const state = {
    startedAt: now(),
    mode: initialMode,
    maintenance: Boolean(db.getSetting('maintenance', false)),

    /**
     * @param {string} mode
     * @returns {string}
     */
    setMode(mode) {
      const next = String(mode || '').toLowerCase();
      if (!VALID_MODES.includes(next)) {
        throw new AppError('STATE_INVALID_MODE', `Mode tidak valid: "${mode}".`);
      }

      db.setSetting('mode', next);
      state.mode = next;
      return next;
    },

    /**
     * @param {boolean} enabled
     * @returns {boolean}
     */
    setMaintenance(enabled) {
      const value = Boolean(enabled);
      db.setSetting('maintenance', value);
      state.maintenance = value;
      return value;
    },

    /**
     * @returns {number}
     */
    uptime() {
      return Math.max(0, Math.floor((now() - state.startedAt) / 1000));
    },
  };

  return state;
}

module.exports = {
  createRuntimeState,
};
