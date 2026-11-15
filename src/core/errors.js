/**
 * Error types dan helper timeout.
 */

class AppError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {string} [userMessage]
   * @param {object} [meta]
   */
  constructor(code, message, userMessage = message, meta = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.meta = meta;
  }
}

class UserError extends AppError {
  /**
   * @param {string} code
   * @param {string} message
   * @param {string} [userMessage]
   */
  constructor(code, message, userMessage = message) {
    super(code, message, userMessage);
    this.name = 'UserError';
  }
}

class TimeoutError extends AppError {
  constructor(message = 'Command timeout') {
    super('COMMAND_TIMEOUT', message, 'Command terlalu lama diproses. Coba lagi.');
    this.name = 'TimeoutError';
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} [label]
 * @returns {Promise<T>}
 */
async function withTimeout(promise, ms, label = 'operation') {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${label} melebihi batas ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  AppError,
  UserError,
  TimeoutError,
  withTimeout,
};
