const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CommandRegistry,
  PERMISSION_LEVELS,
  permissionLevel,
  loadCommands,
} = require('../src/core/registry');

const execute = async () => {};

function manifest(overrides = {}) {
  return {
    name: 'contoh',
    category: 'general',
    description: 'Contoh command',
    permission: 'user',
    execute,
    ...overrides,
  };
}

test('registry: register, alias, dan lookup', () => {
  const registry = new CommandRegistry();
  const command = registry.register(manifest({ aliases: ['c', 'cth'] }));

  assert.equal(registry.size, 1);
  assert.equal(registry.get('contoh'), command);
  assert.equal(registry.get('C'), command);
  assert.equal(registry.get('cth'), command);
  assert.equal(registry.get('tidakada'), null);
  assert.equal(registry.has('contoh'), true);
  assert.deepEqual(command.aliases, ['c', 'cth']);
  assert.equal(permissionLevel('owner'), 3);
  assert.equal(permissionLevel('unknown'), -1);
  assert.deepEqual(PERMISSION_LEVELS, { user: 0, premium: 1, admin: 2, owner: 3 });
});

test('registry: nama dan alias duplikat ditolak', () => {
  const registry = new CommandRegistry();
  registry.register(manifest({ name: 'satu', aliases: ['s'] }));

  assert.throws(() => registry.register(manifest({ name: 'satu' })), /sudah terdaftar/);
  assert.throws(() => registry.register(manifest({ name: 'dua', aliases: ['s'] })), /sudah dipakai/);
  assert.throws(() => registry.register(manifest({ name: 's' })), /alias/);
  assert.throws(
    () => registry.register(manifest({ name: 'tiga', aliases: ['satu'] })),
    /sudah dipakai/,
  );
});

test('registry: manifest tidak valid ditolak', () => {
  const registry = new CommandRegistry();

  assert.throws(() => registry.register(null), /object/);
  assert.throws(() => registry.register(manifest({ name: 'Nama Salah' })), /tidak valid/);
  assert.throws(() => registry.register(manifest({ name: '' })), /tidak valid/);
  assert.throws(() => registry.register(manifest({ name: 'x', execute: null })), /execute/);
  assert.throws(() => registry.register(manifest({ name: 'x', permission: 'root' })), /Permission/);
  assert.throws(() => registry.register(manifest({ name: 'x', scope: 'global' })), /Scope/);
  assert.throws(() => registry.register(manifest({ name: 'x', cooldown: -1 })), /Cooldown/);
});

test('registry: kategori dan daftar command', () => {
  const registry = new CommandRegistry();
  registry.register(manifest({ name: 'ping', category: 'general' }));
  registry.register(manifest({ name: 'kick', category: 'group' }));
  registry.register(manifest({ name: 'ai', category: 'ai' }));
  registry.register(manifest({ name: 'ping2', category: 'general' }));

  assert.equal(registry.getCategories().length, 3);
  assert.deepEqual(
    registry.getByCategory('general').map((command) => command.name),
    ['ping', 'ping2'],
  );
  assert.equal(registry.getAll().length, 4);
});

test('registry: memuat command bawaan', () => {
  const registry = new CommandRegistry();
  const loaded = loadCommands(registry);

  assert.ok(loaded.length >= 30, `command bawaan kurang lengkap: ${loaded.length}`);
  assert.equal(registry.size, loaded.length);

  const expected = [
    'menu', 'help', 'ping', 'alive', 'owner', 'mode', 'maintenance',
    'welcome', 'goodbye', 'promote', 'demote', 'kick', 'mute', 'unmute',
    'tagall', 'hidetag', 'groupinfo', 'warn', 'warnings', 'unwarn',
    'antilink', 'antispam', 'setwarnlimit', 'guardstatus',
    'sticker', 'toimg', 'doctor', 'ytmp3', 'ytmp4', 'tiktok',
    'ban', 'unban', 'stats', 'backup', 'restore',
  ];

  for (const name of expected) {
    const command = registry.get(name);
    assert.ok(command, `command ${name} harus ada`);
    assert.equal(typeof command.execute, 'function');
  }

  assert.equal(registry.get('list').name, 'menu');
  assert.equal(registry.get('p').name, 'ping');
  assert.equal(registry.get('bantuan').name, 'help');
  assert.equal(registry.get('maint').name, 'maintenance');
  assert.equal(registry.get('tendang').name, 'kick');
  assert.equal(registry.get('mode').permission, 'owner');
  assert.equal(registry.get('maintenance').permission, 'owner');
  assert.equal(registry.get('kick').permission, 'admin');
  assert.equal(registry.get('kick').scope, 'group');
  assert.equal(registry.get('ytmp3').category, 'downloader');
  assert.equal(registry.get('ping').maintenanceSafe, true);
});
