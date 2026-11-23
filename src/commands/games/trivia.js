/**
 * `.trivia` — kuis pilihan ganda dari bank soal lokal.
 * Penjawab benar pertama mendapat koin & XP.
 */

const { getDefaultGameManager, REWARDS } = require('../../services/gameManager');

const LETTERS = ['A', 'B', 'C', 'D'];

const BANK = [
  { q: 'Apa ibu kota Indonesia?', options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], answer: 0 },
  { q: 'Berapa hasil 2 + 2 x 3?', options: ['12', '8', '10', '6'], answer: 1 },
  { q: 'Planet terdekat dengan Matahari?', options: ['Venus', 'Bumi', 'Merkurius', 'Mars'], answer: 2 },
  { q: 'Hewan mamalia terbesar di dunia?', options: ['Gajah', 'Paus biru', 'Jerapah', 'Badak'], answer: 1 },
  { q: 'Proklamasi Kemerdekaan Indonesia dibacakan pada tanggal?', options: ['17 Agustus 1945', '1 Juni 1945', '28 Oktober 1928', '10 November 1945'], answer: 0 },
  { q: 'Air membeku pada suhu?', options: ['100°C', '0°C', '50°C', '-10°C'], answer: 1 },
  { q: 'Lambang kimia untuk emas?', options: ['Ag', 'Fe', 'Au', 'Cu'], answer: 2 },
  { q: 'Benua terluas di dunia?', options: ['Afrika', 'Asia', 'Eropa', 'Amerika'], answer: 1 },
  { q: 'Siapa penemu lampu pijar komersial?', options: ['Nikola Tesla', 'Thomas Edison', 'Alexander Bell', 'Isaac Newton'], answer: 1 },
  { q: 'Berapa jumlah sisi sebuah segitiga?', options: ['2', '3', '4', '5'], answer: 1 },
  { q: 'Gunung tertinggi di dunia?', options: ['Everest', 'K2', 'Kilimanjaro', 'Fuji'], answer: 0 },
  { q: 'Organ tubuh yang memompa darah?', options: ['Paru-paru', 'Hati', 'Jantung', 'Ginjal'], answer: 2 },
  { q: 'Mata uang Jepang?', options: ['Won', 'Yuan', 'Yen', 'Baht'], answer: 2 },
  { q: 'Sungai terpanjang di dunia?', options: ['Amazon', 'Nil', 'Yangtze', 'Mississippi'], answer: 1 },
  { q: 'Ibu kota Jepang?', options: ['Osaka', 'Kyoto', 'Tokyo', 'Nagoya'], answer: 2 },
  { q: '10 kilometer sama dengan berapa meter?', options: ['1.000', '10.000', '100.000', '100'], answer: 1 },
  { q: 'Planet terbesar di tata surya?', options: ['Jupiter', 'Saturnus', 'Neptunus', 'Bumi'], answer: 0 },
  { q: 'Gas yang dihirup manusia untuk bernapas?', options: ['Karbon dioksida', 'Nitrogen', 'Oksigen', 'Hidrogen'], answer: 2 },
  { q: 'Penulis novel "Laskar Pelangi"?', options: ['Andrea Hirata', 'Pramoedya Ananta Toer', 'Tere Liye', 'Dee Lestari'], answer: 0 },
  { q: 'Tahun kemerdekaan Indonesia?', options: ['1942', '1945', '1949', '1950'], answer: 1 },
  { q: 'Ibu kota Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], answer: 2 },
  { q: 'Satelit alami Bumi?', options: ['Matahari', 'Bulan', 'Mars', 'Venus'], answer: 1 },
  { q: 'Bahan utama pembuatan kertas?', options: ['Kayu', 'Besi', 'Plastik', 'Kaca'], answer: 0 },
  { q: 'Alat musik berdawai yang dimainkan dengan busur?', options: ['Gitar', 'Biola', 'Piano', 'Drum'], answer: 1 },
  { q: 'Warna hasil campuran biru dan kuning?', options: ['Ungu', 'Oranye', 'Hijau', 'Cokelat'], answer: 2 },
  { q: 'Jumlah pemain satu tim sepak bola di lapangan?', options: ['9', '10', '11', '12'], answer: 2 },
  { q: 'Planet yang dikenal sebagai planet merah?', options: ['Venus', 'Mars', 'Jupiter', 'Merkurius'], answer: 1 },
  { q: 'Berapa hasil 15 dikurangi 7?', options: ['6', '7', '8', '9'], answer: 2 },
  { q: 'Hewan yang dikenal sebagai raja hutan?', options: ['Harimau', 'Singa', 'Gajah', 'Serigala'], answer: 1 },
  { q: 'Berapa jumlah bulan dalam satu tahun?', options: ['10', '11', '12', '13'], answer: 2 },
];

function pickQuestion() {
  return BANK[Math.floor(Math.random() * BANK.length)];
}

module.exports = {
  name: 'trivia',
  category: 'games',
  description: 'Kuis pilihan ganda berhadiah koin dan XP',
  descriptionKey: 'commands.trivia.description',
  usage: 'trivia',
  examples: ['trivia'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,

  async execute(ctx) {
    const gm = ctx.services?.gameManager || getDefaultGameManager();
    const chatId = ctx.chatId;
    const t = ctx.t;

    if (gm.isActive(chatId)) return t('games.busy');

    const question = pickQuestion();

    const body = [
      t('games.trivia.title'),
      '',
      question.q,
      '',
      ...question.options.map((option, i) => `${LETTERS[i]}. ${option}`),
      '',
      t('games.trivia.prompt'),
    ].join('\n');

    const session = {
      type: 'trivia',
      db: ctx.db,
      t,
      accepts: (text) => /^[a-dA-D1-4]$/.test(text),

      async onTimeout() {
        await ctx.reply(t('games.timeout', { game: t('games.trivia.name') }));
      },

      async onInput(input, { senderId, senderName, reply }, api) {
        const value = input.toUpperCase();
        const index = LETTERS.includes(value) ? LETTERS.indexOf(value) : Number(value) - 1;

        if (index < 0 || index > 3) {
          await reply(t('games.trivia.invalid'));
          return;
        }

        if (index !== question.answer) {
          await reply(t('games.trivia.wrong', { answer: LETTERS[index] }));
          return;
        }

        api.reward(senderId, { coins: REWARDS.trivia.win, xp: REWARDS.trivia.xp });
        await reply(t('games.trivia.correct', {
          answer: LETTERS[question.answer],
          coins: REWARDS.trivia.win,
          xp: REWARDS.trivia.xp,
          player: senderName || 'Kak',
        }));
        api.finish();
      },
    };

    gm.start(chatId, session);

    await ctx.reply(body);
  },
};

module.exports.BANK = BANK;
