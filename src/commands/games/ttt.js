/**
 * `.ttt [@lawan]` — Tic-Tac-Toe 3x3.
 *
 * Tanpa lawan: melawan bot. Dengan mention/reply: PvP di grup.
 * Pemain mengetik angka 1-9 (tanpa prefix) atau `.ttt <1-9>`.
 */

const { normalizeJid } = require('../../utils/jid');
const { unwrapMessage } = require('../../utils/text');
const { getContextInfo } = require('../../utils/group');
const { getDefaultGameManager, REWARDS } = require('../../services/gameManager');

const MARK_X = '❌';
const MARK_O = '⭕';
const BOT = 'bot';
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function label(jid) {
  if (!jid || jid === BOT) return 'Bot';
  return String(jid).split('@')[0];
}

function render(board) {
  const rows = [];
  for (let row = 0; row < 3; row += 1) {
    rows.push([0, 1, 2]
      .map((col) => board[row * 3 + col] || String(row * 3 + col + 1))
      .join(' | '));
  }
  return rows.join('\n');
}

function verdictOf(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return board.every(Boolean) ? 'draw' : null;
}

function pickBotMove(board) {
  for (const mark of [MARK_O, MARK_X]) {
    for (const [a, b, c] of LINES) {
      const line = [a, b, c];
      const filled = line.filter((i) => board[i] === mark);
      const empty = line.filter((i) => !board[i]);
      if (filled.length === 2 && empty.length === 1) return empty[0];
    }
  }
  for (const i of [4, 0, 2, 6, 8, 1, 3, 5, 7]) {
    if (!board[i]) return i;
  }
  return -1;
}

function resolveTarget(ctx) {
  const fromArgs = String(ctx.rawArgs || '').match(/@?(\d{6,})/);
  if (fromArgs) return `${fromArgs[1]}@s.whatsapp.net`;

  try {
    const content = unwrapMessage(ctx.msg?.message);
    const info = getContextInfo(content || {});
    if (info?.mentionedJid?.length) return normalizeJid(info.mentionedJid[0]);
    if (info?.participant) return normalizeJid(info.participant);
  } catch {
    // Tanpa metadata mention, game tetap bisa dimulai melawan bot.
  }
  return null;
}

module.exports = {
  name: 'ttt',
  category: 'games',
  description: 'Tic-Tac-Toe melawan bot atau pemain lain',
  descriptionKey: 'commands.ttt.description',
  usage: 'ttt [@lawan]',
  examples: ['ttt', 'ttt @6281234567890', 'ttt 5'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,

  async execute(ctx) {
    const gm = ctx.services?.gameManager || getDefaultGameManager();
    const chatId = ctx.chatId;
    const t = ctx.t;
    const starter = normalizeJid(ctx.senderId) || ctx.senderId;
    const arg = String(ctx.args?.[0] || '').trim();
    const active = gm.get(chatId);

    // `.ttt <1-9>` saat sesi berjalan dihitung sebagai langkah.
    if (/^[1-9]$/.test(arg) && active?.type === 'ttt') {
      await gm.handleInput({
        chatId,
        senderId: starter,
        senderName: ctx.senderName,
        text: arg,
        reply: ctx.reply,
      });
      return;
    }

    if (gm.isActive(chatId)) return t('games.busy');

    const target = resolveTarget(ctx);
    const opponent = target && target !== starter ? target : null;
    const players = [starter, opponent || BOT];
    const names = new Map([[starter, ctx.senderName || label(starter)]]);
    if (opponent) names.set(opponent, label(opponent));

    function display(jid) {
      return names.get(jid) || label(jid);
    }

    const board = Array(9).fill('');
    let turn = 0;

    async function finishGame(result, reply, api) {
      if (result === 'draw') {
        for (const player of players) {
          api.reward(player, { coins: REWARDS.ttt.draw });
        }
        await reply(t('games.ttt.draw', { board: render(board), coins: REWARDS.ttt.draw }));
      } else {
        const winner = players[result === MARK_X ? 0 : 1];
        if (winner === BOT) {
          await reply(t('games.ttt.botWin', { board: render(board) }));
        } else {
          api.reward(winner, { coins: REWARDS.ttt.win, xp: REWARDS.ttt.xp });
          await reply(t('games.ttt.win', {
            board: render(board),
            player: display(winner),
            coins: REWARDS.ttt.win,
            xp: REWARDS.ttt.xp,
          }));
        }
      }
      api.finish();
    }

    async function playTurn(cell, mark, reply, api) {
      if (board[cell]) {
        await reply(t('games.ttt.invalid'));
        return;
      }
      board[cell] = mark;

      let result = verdictOf(board);
      if (!result && !opponent) {
        const botCell = pickBotMove(board);
        if (botCell >= 0) board[botCell] = MARK_O;
        result = verdictOf(board);
      }

      if (result) {
        await finishGame(result, reply, api);
        return;
      }

      if (opponent) turn = 1 - turn;
      await reply(t('games.ttt.board', {
        board: render(board),
        player: display(players[turn]),
      }));
    }

    const session = {
      type: 'ttt',
      db: ctx.db,
      t,
      players,
      accepts: (text) => /^[1-9]$/.test(text),

      async onTimeout() {
        await ctx.reply(t('games.timeout', { game: t('games.ttt.name') }));
      },

      async onInput(input, { senderId, senderName, reply }, api) {
        const from = normalizeJid(senderId) || senderId;
        const index = players.indexOf(from);

        if (index === -1) {
          await reply(t('games.ttt.notPlayer'));
          return;
        }
        if (senderName) names.set(from, senderName);
        if (index !== turn) {
          await reply(t('games.ttt.notTurn', { player: display(players[turn]) }));
          return;
        }

        await playTurn(Number(input) - 1, index === 0 ? MARK_X : MARK_O, reply, api);
      },
    };

    gm.start(chatId, session);

    await ctx.reply(t('games.ttt.started', {
      board: render(board),
      player: display(players[0]),
      mode: opponent ? t('games.ttt.modePvp') : t('games.ttt.modeBot'),
    }));
  },
};
