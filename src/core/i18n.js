/**
 * Translator sederhana dengan fallback ke bahasa Indonesia.
 */

const fs = require('node:fs');
const path = require('node:path');

const LOCALES_DIR = path.resolve(__dirname, '..', 'locales');
const cache = new Map();

/**
 * @param {string} lang
 * @returns {object}
 */
function loadLocale(lang) {
  if (cache.has(lang)) return cache.get(lang);

  const file = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    cache.set(lang, parsed);
    return parsed;
  } catch {
    cache.set(lang, {});
    return {};
  }
}

/**
 * @param {object} object
 * @param {string} key
 * @returns {unknown}
 */
function getByPath(object, key) {
  return String(key)
    .split('.')
    .reduce((current, part) => (current && typeof current === 'object' ? current[part] : undefined), object);
}

/**
 * @param {string} lang
 */
function createTranslator(lang = 'id') {
  const primary = loadLocale(lang);
  const fallback = loadLocale('id');

  /**
   * @param {string} key
   * @param {Record<string, string|number>} [vars]
   * @returns {string}
   */
  return function translate(key, vars = {}) {
    const template = getByPath(primary, key) ?? getByPath(fallback, key) ?? key;
    if (typeof template !== 'string') return String(template);

    return template.replace(/\{(\w+)\}/g, (_, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`
    ));
  };
}

module.exports = {
  createTranslator,
  loadLocale,
};
