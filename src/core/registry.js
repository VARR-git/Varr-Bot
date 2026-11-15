/**
 * Registry command Varr-Bot.
 *
 * Manifest command:
 * {
 *   name: 'ping',
 *   aliases: ['p'],
 *   category: 'general',
 *   description: 'Cek status bot',
 *   descriptionKey: 'commands.ping.description', // opsional, untuk i18n
 *   usage: '.ping',
 *   examples: ['.ping'],
 *   permission: 'user' | 'premium' | 'admin' | 'owner',
 *   scope: 'all' | 'group' | 'private',
 *   cooldown: 3,             // detik; kosong = config.defaultCooldown
 *   maintenanceSafe: false,  // tetap bisa dipakai saat maintenance
 *   hidden: false,
 *   execute: async (ctx) => {}
 * }
 */

const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('./errors');

const PERMISSION_LEVELS = Object.freeze({
  user: 0,
  premium: 1,
  admin: 2,
  owner: 3,
});

const SCOPES = Object.freeze(['all', 'group', 'private']);
const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

/**
 * @param {unknown} name
 * @returns {string}
 */
function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function permissionLevel(value) {
  return PERMISSION_LEVELS[value] ?? -1;
}

class CommandRegistry {
  /**
   * @param {{logger?: object}} [options]
   */
  constructor({ logger } = {}) {
    this.logger = logger;
    /** @type {Map<string, object>} */
    this.commands = new Map();
    /** @type {Map<string, string>} */
    this.aliases = new Map();
  }

  /**
   * @param {object} manifest
   * @returns {object}
   */
  register(manifest) {
    if (!manifest || typeof manifest !== 'object') {
      throw new AppError('REGISTRY_INVALID', 'Manifest command harus berupa object.');
    }

    const name = normalizeName(manifest.name);
    if (!NAME_PATTERN.test(name)) {
      throw new AppError(
        'REGISTRY_INVALID_NAME',
        `Nama command tidak valid: "${manifest.name}". Gunakan huruf kecil, angka, "-" atau "_", maksimal 32 karakter.`,
      );
    }

    if (this.commands.has(name)) {
      throw new AppError('REGISTRY_DUPLICATE', `Command "${name}" sudah terdaftar.`);
    }

    if (this.aliases.has(name)) {
      throw new AppError('REGISTRY_DUPLICATE_ALIAS', `Nama "${name}" sudah dipakai sebagai alias.`);
    }

    if (typeof manifest.execute !== 'function') {
      throw new AppError('REGISTRY_INVALID_EXECUTE', `Command "${name}" tidak punya fungsi execute.`);
    }

    const permission = String(manifest.permission || 'user').toLowerCase();
    if (permissionLevel(permission) < 0) {
      throw new AppError(
        'REGISTRY_INVALID_PERMISSION',
        `Permission command "${name}" tidak valid: "${manifest.permission}".`,
      );
    }

    const scope = String(manifest.scope || 'all').toLowerCase();
    if (!SCOPES.includes(scope)) {
      throw new AppError(
        'REGISTRY_INVALID_SCOPE',
        `Scope command "${name}" tidak valid: "${manifest.scope}".`,
      );
    }

    const aliases = [...new Set(
      (Array.isArray(manifest.aliases) ? manifest.aliases : [])
        .map(normalizeName)
        .filter(Boolean),
    )];

    for (const alias of aliases) {
      if (!NAME_PATTERN.test(alias)) {
        throw new AppError('REGISTRY_INVALID_ALIAS', `Alias "${alias}" untuk "${name}" tidak valid.`);
      }
      if (alias === name) {
        throw new AppError('REGISTRY_INVALID_ALIAS', `Alias "${alias}" tidak boleh sama dengan nama command.`);
      }
      if (this.commands.has(alias) || this.aliases.has(alias)) {
        throw new AppError('REGISTRY_DUPLICATE_ALIAS', `Alias "${alias}" untuk "${name}" sudah dipakai.`);
      }
    }

    const cooldown = manifest.cooldown === undefined ? null : Number(manifest.cooldown);
    if (cooldown !== null && (!Number.isFinite(cooldown) || cooldown < 0)) {
      throw new AppError('REGISTRY_INVALID_COOLDOWN', `Cooldown command "${name}" tidak valid.`);
    }

    const command = Object.freeze({
      name,
      aliases: Object.freeze(aliases),
      category: String(manifest.category || 'other').toLowerCase(),
      description: String(manifest.description || ''),
      descriptionKey: manifest.descriptionKey ? String(manifest.descriptionKey) : null,
      usage: String(manifest.usage || name),
      examples: Object.freeze(Array.isArray(manifest.examples) ? manifest.examples.map(String) : []),
      permission,
      scope,
      cooldown,
      maintenanceSafe: Boolean(manifest.maintenanceSafe),
      hidden: Boolean(manifest.hidden),
      execute: manifest.execute,
    });

    this.commands.set(name, command);
    for (const alias of aliases) {
      this.aliases.set(alias, name);
    }

    return command;
  }

  /**
   * @param {object[]} manifests
   */
  registerMany(manifests) {
    for (const manifest of manifests) this.register(manifest);
  }

  /**
   * @param {string} name
   * @returns {object|null}
   */
  get(name) {
    const key = normalizeName(name);
    if (!key) return null;

    const direct = this.commands.get(key);
    if (direct) return direct;

    const target = this.aliases.get(key);
    return target ? this.commands.get(target) || null : null;
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return Boolean(this.get(name));
  }

  /**
   * @returns {object[]}
   */
  getAll() {
    return [...this.commands.values()];
  }

  /**
   * @returns {string[]}
   */
  getCategories() {
    return [...new Set(this.getAll().map((command) => command.category))];
  }

  /**
   * @param {string} category
   * @returns {object[]}
   */
  getByCategory(category) {
    const target = String(category || '').toLowerCase();
    return this.getAll().filter((command) => command.category === target);
  }

  get size() {
    return this.commands.size;
  }
}

const DEFAULT_COMMANDS_DIR = path.resolve(__dirname, '..', 'commands');

/**
 * Memuat semua file command secara rekursif.
 * Modul boleh mengekspor satu manifest, array manifest, atau fungsi register(registry).
 *
 * @param {CommandRegistry} registry
 * @param {{directory?: string, logger?: object}} [options]
 */
function loadCommands(registry, { directory = DEFAULT_COMMANDS_DIR, logger } = {}) {
  const loaded = [];

  /**
   * @param {string} dir
   */
  function walk(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

      // File bantuan (mis. `_shared.js`) tidak dimuat sebagai command.
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

      let exported;
      try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        exported = require(fullPath);
      } catch (error) {
        throw new AppError(
          'COMMAND_LOAD_FAILED',
          `Gagal memuat command ${path.relative(directory, fullPath)}: ${error.message}`,
        );
      }

      if (typeof exported === 'function') {
        const result = exported(registry);
        if (Array.isArray(result)) loaded.push(...result);
        continue;
      }

      const manifests = Array.isArray(exported)
        ? exported
        : Array.isArray(exported?.commands)
          ? exported.commands
          : [exported];

      for (const manifest of manifests) {
        if (!manifest) continue;
        loaded.push(registry.register(manifest));
      }
    }
  }

  walk(directory);
  logger?.info?.({ count: loaded.length, directory }, 'Command dimuat');
  return loaded;
}

module.exports = {
  CommandRegistry,
  PERMISSION_LEVELS,
  SCOPES,
  NAME_PATTERN,
  permissionLevel,
  normalizeName,
  loadCommands,
  DEFAULT_COMMANDS_DIR,
};
