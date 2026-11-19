/**
 * `.hangman` — tebak kata. Input satu huruf atau kata utuh.
 */

const { getDefaultGameManager, REWARDS } = require('../../services/gameManager');

const WORDS = [
  'KOMPUTER', 'JAKARTA', 'SEPEDA', 'BUKU', 'KUCING',
  'MATAHARI', 'INDONESIA', 'MERDEKA', 'PANTAI', 'GUNUNG',
  'ANGIN', 'BURUNG', 'PISANG', 'KOPI', 'SEKOLAH',
  'DOKTER', 'PASAR', 'LANGIT', 'BINTANG', 'SAMUDRA',
  'KELUARGA', 'PELANGI', 'HUTAN', 'MOBIL', 'KERETA',
  'BUNGA', 'SENYUM', 'TANGAN', 'JENDELA', 'PULAU',
];
const MAX_LIVES = 6;

module.exports = {
  name: 'hangman',
  category: 'games',
  description: 'Tebak kata huruf demi huruf sebelum nyawa habis',
  descriptionKey: 'commands.hangman.description',
  usage: 'hangman',
  examples: ['hangman'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,

  async execute(ctx) {
    const gm = ctx.services?.gameManager || getDefaultGameManager();
    const chatId = ctx.chatId;
    const t = ctx.t;

    if (gm.isActive(chatId)) return t('games.busy');

    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const guessed = new Set();
    let lives = MAX_LIVES;

    function render() {
      return [
        t('games.hangman.title'),
        '',
        [...word].map((ch) => (guessed.has(ch) ? ch : '＿')).join(' '),
        '',
        t('games.hangman.status', {
          lives: '❤️'.repeat(lives) + '🖤'.repeat(MAX_LIVES - lives),
          guessed: [...guessed].sort().join(', ') || t('common.none'),
        }),
      ].join('\n');
    }

    function solved() {
      return [...word].every((ch) => guessed.has(ch));
    }

    const session = {
      type: 'hangman',
      db: ctx.db,
      t,
      accepts: (text) => /^[a-zA-Z]{1,15}$/.test(text),

      async onTimeout() {
        await ctx.reply(t('games.timeout', { game: t('games.hangman.name') }));
      },

      async onInput(input, { reply }, api) {
        const guess = input.toUpperCase();
        let note;

        if (guess.length === 1) {
          if (guessed.has(guess)) {
            await reply(t('games.hangman.already', { letter: guess }));
            return;
          }
          guessed.add(guess);
          note = word.includes(guess)
            ? t('games.hangman.correct')
            : t('games.hangman.wrong');
          if (!word.includes(guess)) lives -= 1;
        } else if (guess === word) {
          note = t('games.hangman.correct');
        } else {
          lives -= 1;
          note = t('games.hangman.wrongWord');
        }

        if (solved() || (guess.length > 1 && guess === word)) {
          api.reward(ctx.senderId, { coins: REWARDS.hangman.win, xp: REWARDS.hangman.xp });
          await reply(t('games.hangman.win', {
            word,
            coins: REWARDS.hangman.win,
            xp: REWARDS.hangman.xp,
          }));
          api.finish();
          return;
        }

        if (lives <= 0) {
          await reply(t('games.hangman.lose', { word }));
          api.finish();
          return;
        }

        await reply(`${note}\n\n${render()}`);
      },
    };

    gm.start(chatId, session);

    await ctx.reply([
      t('games.hangman.intro'),
      '',
      render(),
    ].join('\n'));
  },
};

module.exports.WORDS = WORDS;
module.exports.MAX_LIVES = MAX_LIVES;
