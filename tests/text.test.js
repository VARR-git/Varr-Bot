const test = require('node:test');
const assert = require('node:assert/strict');

const {
  unwrapMessage,
  extractText,
  parseCommand,
  sanitizeName,
  truncate,
} = require('../src/utils/text');

test('text: unwrap pesan ephemeral dan view once', () => {
  const message = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: {
            extendedTextMessage: { text: 'halo' },
          },
        },
      },
    },
  };

  assert.deepEqual(unwrapMessage(message), {
    extendedTextMessage: { text: 'halo' },
  });
  assert.equal(unwrapMessage(null), null);
});

test('text: extract dari berbagai tipe pesan', () => {
  assert.equal(extractText({ conversation: ' halo ' }), 'halo');
  assert.equal(extractText({ extendedTextMessage: { text: 'tes' } }), 'tes');
  assert.equal(extractText({ imageMessage: { caption: 'caption' } }), 'caption');
  assert.equal(extractText({ videoMessage: { caption: 'video' } }), 'video');
  assert.equal(extractText({ documentMessage: { caption: 'dokumen' } }), 'dokumen');
  assert.equal(extractText({ listResponseMessage: { singleSelectReply: { selectedRowId: 'row' } } }), 'row');
  assert.equal(extractText({ conversation: '   ' }), '');
  assert.equal(extractText(null), '');
});

test('text: parse command dengan prefix dan argumen', () => {
  assert.deepEqual(parseCommand('.ping', ['.']), {
    prefix: '.',
    commandName: 'ping',
    args: [],
    rawArgs: '',
  });

  assert.deepEqual(parseCommand('  .help   menu  ', ['.']), {
    prefix: '.',
    commandName: 'help',
    args: ['menu'],
    rawArgs: 'menu',
  });

  assert.deepEqual(parseCommand('!ping sekarang', ['!', '.']), {
    prefix: '!',
    commandName: 'ping',
    args: ['sekarang'],
    rawArgs: 'sekarang',
  });

  assert.equal(parseCommand('.PING', ['.']).commandName, 'ping');
});

test('text: parse command menolak input tidak valid', () => {
  assert.equal(parseCommand('halo', ['.']), null);
  assert.equal(parseCommand('.', ['.']), null);
  assert.equal(parseCommand('   ', ['.']), null);
  assert.equal(parseCommand('.ping', []), null);
  assert.equal(parseCommand('.ping@x', ['.']), null);
  assert.equal(parseCommand('/start', ['.']), null);
  assert.equal(parseCommand(null, ['.']), null);
});

test('text: sanitize dan truncate', () => {
  assert.equal(sanitizeName('*Nama* _keren_'), 'Nama keren');
  assert.equal(sanitizeName('   '), 'Kak');
  assert.equal(sanitizeName('a'.repeat(100)).length, 40);
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 10), 'abc');
});
