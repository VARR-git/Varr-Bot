const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const LOCALES_DIR = path.join(SRC_DIR, 'locales');

/**
 * Namespace i18n yang dipakai Varr-Bot. Literal string di `src/` yang diawali
 * salah satu namespace ini dianggap key i18n dan wajib ada di locale.
 */
const NAMESPACES = new Set([
  'common',
  'roles',
  'categories',
  'errors',
  'commands',
  'menu',
  'help',
  'ping',
  'alive',
  'owner',
  'mode',
  'maintenance',
  'group',
  'guard',
  'media',
  'downloader',
  'backup',
  'ban',
  'stats',
  'doctor',
  'groupEvents',
]);

const KEY_PATTERN = /(['"])([a-zA-Z][A-Za-z0-9]*\.[A-Za-z0-9_.]+)\1/g;

/**
 * Sebagian literal bertitik bukan key i18n, misalnya nama aksi audit
 * (`action: 'group.kick'`). Literal setelah `action:` / `action =` dilewati.
 *
 * @param {string} content
 * @param {number} index
 * @returns {boolean}
 */
function isNonLocaleLiteral(content, index) {
  return /action\s*[:=]\s*$/.test(content.slice(Math.max(0, index - 40), index));
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectJsFiles(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales') continue;
      files.push(...collectJsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }

  return files;
}

/**
 * @param {object} object
 * @param {string} [prefix]
 * @param {Set<string>} [target]
 * @returns {Set<string>}
 */
function flattenKeys(object, prefix = '', target = new Set()) {
  for (const [key, value] of Object.entries(object || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenKeys(value, fullKey, target);
    } else {
      target.add(fullKey);
    }
  }
  return target;
}

/**
 * @returns {Map<string, string[]>} key → file yang memakainya
 */
function referencedKeys() {
  const found = new Map();

  for (const file of collectJsFiles(SRC_DIR)) {
    const content = fs.readFileSync(file, 'utf8');
    const relative = path.relative(SRC_DIR, file);

    for (const match of content.matchAll(KEY_PATTERN)) {
      if (isNonLocaleLiteral(content, match.index)) continue;

      const key = match[2];
      if (!NAMESPACES.has(key.split('.')[0])) continue;
      if (!found.has(key)) found.set(key, []);
      const users = found.get(key);
      if (!users.includes(relative)) users.push(relative);
    }
  }

  return found;
}

const id = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'id.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'en.json'), 'utf8'));
const idKeys = flattenKeys(id);
const enKeys = flattenKeys(en);

test('locale: semua key yang dipakai source tersedia di id.json dan en.json', () => {
  const referenced = referencedKeys();
  assert.ok(referenced.size > 100, 'jumlah key yang terdeteksi terlalu sedikit');

  const missingId = [];
  const missingEn = [];

  for (const [key, files] of referenced) {
    if (!idKeys.has(key)) missingId.push(`${key} (${files.join(', ')})`);
    if (!enKeys.has(key)) missingEn.push(`${key} (${files.join(', ')})`);
  }

  assert.deepEqual(missingId, [], `key tidak ada di id.json:\n${missingId.join('\n')}`);
  assert.deepEqual(missingEn, [], `key tidak ada di en.json:\n${missingEn.join('\n')}`);
});

test('locale: struktur id dan en sama', () => {
  const onlyId = [...idKeys].filter((key) => !enKeys.has(key)).sort();
  const onlyEn = [...enKeys].filter((key) => !idKeys.has(key)).sort();

  assert.deepEqual(onlyId, [], `key hanya ada di id.json: ${onlyId.join(', ')}`);
  assert.deepEqual(onlyEn, [], `key hanya ada di en.json: ${onlyEn.join(', ')}`);
});

test('locale: setiap command punya descriptionKey yang valid', () => {
  const { CommandRegistry, loadCommands } = require('../src/core/registry');
  const registry = new CommandRegistry();
  loadCommands(registry);

  assert.ok(registry.size >= 30, 'command bawaan kurang lengkap');

  for (const command of registry.getAll()) {
    if (!command.descriptionKey) continue;
    assert.ok(
      idKeys.has(command.descriptionKey),
      `${command.name}: ${command.descriptionKey} tidak ada di id.json`,
    );
    assert.ok(
      enKeys.has(command.descriptionKey),
      `${command.name}: ${command.descriptionKey} tidak ada di en.json`,
    );
  }
});
