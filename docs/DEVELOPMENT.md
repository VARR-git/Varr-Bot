# Panduan Development Varr-Bot

Dokumen ini menjelaskan arsitektur Phase 1 dan cara menambah command, middleware, serta test.

---

## 1. Alur Pesan

```text
Baileys messages.upsert (type = notify)
  → core/handler.js
    → filter: fromMe, status, broadcast, newsletter, reaksi, pesan sistem
    → unwrap + extractText
    → parseCommand (prefix)
    → queue per chat (serial, chat lain paralel)
    → registry.get(command)
    → middleware pipeline
        normalize → maintenance → mode → permission → scope → cooldown → rate limit
    → command.execute(ctx)
  → reply / error boundary / statistik
```

Handler hanya memproses pesan yang diawali prefix. Chat biasa (tanpa prefix) diabaikan di Phase 1; fitur AI chat akan ditambahkan di Phase 3.

Pesan dari chat yang sama diproses berurutan lewat `src/core/queue.js`. Tujuannya agar balasan tidak saling mendahului dan command yang menulis state grup tidak balapan. Chat berbeda tetap paralel, dan antrean punya batas agar flood tidak menghabiskan memori.

---

## 2. Peran Modul

| Path | Tanggung jawab |
|---|---|
| `src/index.js` | Merakit dependency, start connection, backup, graceful shutdown |
| `src/config/index.js` | Baca `.env`, validasi, default, path absolut |
| `src/core/connection.js` | Semua API Baileys; QR/pairing, reconnect, event |
| `src/core/handler.js` | Filter pesan, context, pipeline, error boundary, statistik |
| `src/core/queue.js` | Queue eksekusi per chat + batas antrean |
| `src/core/messageCache.js` | Cache pesan untuk `getMessage` (retry Baileys) |
| `src/core/registry.js` | Validasi manifest, alias, auto-load command |
| `src/core/middleware/` | Aturan lintas command |
| `src/core/database/` | Interface database + driver SQLite (skema, backup, restore) |
| `src/core/state.js` | Mode & maintenance yang bisa berubah saat runtime |
| `src/services/` | Logika fitur: guard grup, event grup, media, downloader, warning |
| `src/commands/` | Implementasi command per kategori |
| `src/locales/` | String user-facing (`id.json`, `en.json`) |
| `src/utils/` | Helper murni: teks, JID, grup, target moderasi, backup, format |

---

## 3. Menambah Command

Buat file di `src/commands/<kategori>/<nama>.js`. File otomatis dimuat saat startup (tidak perlu registrasi manual). File yang namanya diawali `_` (mis. `_shared.js`) dilewati, jadi aman dipakai untuk helper internal kategori.

```js
module.exports = {
  name: 'hello',
  aliases: ['hi'],
  category: 'general',
  description: 'Sapa pengguna',
  descriptionKey: 'commands.hello.description',
  usage: 'hello [nama]',
  examples: ['hello', 'hello Varr'],
  permission: 'user',
  scope: 'all',
  cooldown: 3,
  maintenanceSafe: false,

  async execute(ctx) {
    const name = ctx.args[0] || ctx.senderName;
    return `Halo, ${name}!`;
  },
};
```

### Field manifest

| Field | Wajib | Keterangan |
|---|---|---|
| `name` | ya | Huruf kecil, angka, `-`, `_`; maksimal 32 karakter |
| `execute` | ya | `async (ctx) => void \| string`; string otomatis dikirim |
| `aliases` | tidak | Nama alternatif, tidak boleh bentrok |
| `category` | tidak | Default `other`; dipakai untuk grouping menu |
| `description` | tidak | Teks fallback (Indonesia) |
| `descriptionKey` | tidak | Key i18n; prioritaskan ini untuk command bawaan |
| `usage` | tidak | Ditulis tanpa prefix, mis. `help <command>` |
| `examples` | tidak | Juga tanpa prefix |
| `permission` | tidak | `user` (default), `premium`, `admin`, `owner` |
| `scope` | tidak | `all` (default), `group`, `private` |
| `cooldown` | tidak | Detik; kosong = `COMMAND_COOLDOWN` |
| `maintenanceSafe` | tidak | Tetap bisa dipakai saat maintenance |
| `hidden` | tidak | Sembunyikan dari menu/help |

### Context (`ctx`)

| Properti | Keterangan |
|---|---|
| `ctx.reply(text, options)` | Kirim teks, quote pesan asal secara default |
| `ctx.send(payload, options)` | Kirim payload Baileys mentah |
| `ctx.react(emoji)` | Reaksi ke pesan asal |
| `ctx.args`, `ctx.rawArgs` | Argumen setelah command |
| `ctx.chatId`, `ctx.isGroup` | Chat saat ini |
| `ctx.senderId`, `ctx.senderIds` | JID utama dan semua varian (PN/LID) |
| `ctx.senderName` | Nama aman untuk ditampilkan |
| `ctx.role`, `ctx.isOwner` | Role hasil normalize |
| `ctx.t(key, vars)` | Translator sesuai `DEFAULT_LANG` |
| `ctx.db` | Database (lihat bagian 6) |
| `ctx.state` | `mode`, `maintenance`, `uptime()` |
| `ctx.registry` | Registry command |
| `ctx.config`, `ctx.logger` | Config dan logger |
| `ctx.startedAt` | Waktu handler mulai (untuk latensi) |
| `ctx.getGroupMetadata()` | Metadata grup (cached) |

Command tidak boleh memanggil `process.exit`, menyimpan API key, atau memakai `eval`.

---

## 4. Menambah Middleware

Middleware berbentuk `async (ctx, next) => {}`. Jangan panggil `next()` jika ingin menghentikan pipeline.

```js
function createContohMiddleware() {
  return async function contoh(ctx, next) {
    if (ctx.command.name === 'ping') {
      await ctx.reply('ping diblokir');
      return;
    }
    await next();
  };
}
```

Daftarkan di `src/core/middleware/index.js` pada urutan yang tepat. Urutan saat ini:

1. `normalize` — identitas, role, data user/grup
2. `banned` — pengguna/grup yang diblokir owner (owner selalu lolos)
3. `maintenance`
4. `mode`
5. `permission`
6. `scope`
7. `cooldown`
8. `rateLimit`

`banned` sengaja setelah `normalize` (butuh identitas) dan sebelum aturan lain agar blokir tidak bisa diakali. Rate limit sengaja setelah cooldown agar command yang terkena cooldown tidak ikut memakan kuota menit.

Guard grup **bukan** middleware: ia dijalankan di handler sebelum parsing command agar pesan biasa (tanpa prefix) juga termoderasi.

---

## 5. Queue per Chat & Cache Pesan

### Queue

`src/core/queue.js` menyerialkan command per chat:

- Pesan dari chat yang sama dieksekusi satu per satu, sesuai urutan datang.
- Chat berbeda berjalan paralel.
- Maksimum `QUEUE_MAX_PENDING` pesan menunggu per chat (default 50); kelebihannya dilewati dan dicatat sebagai warning.
- Maksimum 500 chat aktif bersamaan; chat baru dilewati saat batas tercapai.
- Error pada satu command tidak memutus rantai chat.
- Saat shutdown, `handler.drain(5000)` menunggu antrean selesai (best-effort).

Queue tidak menyimpan state ke disk. Setelah restart, WhatsApp akan mengirim ulang pesan yang belum di-ack.

### Cache `getMessage`

`src/core/messageCache.js` menyimpan pesan masuk dan balasan bot:

- 1.024 entri, TTL 15 menit, LRU sederhana.
- Dipakai Baileys saat penerima meminta kirim ulang (retry receipt) dan saat memproses event.
- Balasan disimpan dari `sendMessage().message` (protobuf `IMessage`), bukan payload mentah.
- Tidak pernah ditulis ke disk.

Jangan menyimpan media berukuran besar ke cache ini; cache menyimpan struktur pesan, bukan buffer file.

---

## 6. Database

Interface ada di `src/core/database/index.js`, driver di `sqlite.js`.

```js
ctx.db.getSetting('mode', 'public');
ctx.db.setSetting('maintenance', true);

ctx.db.ensureUser(ctx.senderId, { name: ctx.senderName });
ctx.db.setPremium(ctx.senderId, true, Date.now() + 30 * 86400_000);
ctx.db.isPremium(ctx.senderId);

ctx.db.getGroupSetting(ctx.chatId, 'antilink', false);
ctx.db.setGroupSetting(ctx.chatId, 'antilink', true);

ctx.db.addWarning(ctx.chatId, targetJid, { reason: 'spam', warnedBy: ctx.senderId });
ctx.db.countWarnings(ctx.chatId, targetJid);

ctx.db.incrementStat('command:total');
ctx.db.audit({ actor: ctx.senderId, action: 'kick', target: targetJid });
```

Aturan:

- Jangan menyimpan isi pesan secara default.
- Jangan menaruh file SQLite di NFS/network share.
- Backup otomatis berjalan harian ke `BACKUP_DIR` (default `data/backups/`) dan saat shutdown.
- Skema saat ini **v2**. Menambah kolom/tabel wajib lewat `MIGRATIONS` baru di `sqlite.js`, jangan mengubah migrasi lama.
- Untuk multi-instance, tunggu driver MySQL/PostgreSQL (Phase 5).

### Ban, statistik, dan backup

```js
ctx.db.setUserBanned(jid, true, { reason: 'spam' });
ctx.db.isUserBanned(jid);
ctx.db.setGroupBanned(ctx.chatId, true, { reason: 'spam' });
ctx.db.isGroupBanned(ctx.chatId);

ctx.db.countUsers();
ctx.db.countGroups();
ctx.db.countAllWarnings();
ctx.db.topStats({ prefix: 'command:', limit: 5 });

const backup = await ctx.db.backup({
  directory: ctx.config.backupsDir,
  keep: ctx.config.backupKeep,
  verify: true,
});
ctx.db.listBackups({ directory: ctx.config.backupsDir });
ctx.db.verifyBackup(backup.path);
ctx.db.restoreBackup(backup.path);
```

`restoreBackup` menyalin isi tabel lewat `ATTACH DATABASE` di dalam satu transaksi dan menolak backup dengan versi skema berbeda. Tabel `migrations` tidak dipulihkan.

---

## 7. i18n

Semua teks yang dilihat pengguna sebaiknya ada di `src/locales/id.json` dan `en.json`.

```js
return ctx.t('commands.hello.description');
return ctx.t('errors.cooldown', { seconds: 5, command: 'ping' });
```

Jika key tidak ada, translator mengembalikan key itu sendiri. Jangan menaruh markup kompleks di locale; susun di command.

`tests/locales.test.js` memindai semua literal bertitik di `src/` yang memakai namespace i18n dan memastikan key-nya ada di kedua locale, serta memastikan struktur `id` dan `en` identik. Menambah key di satu bahasa saja akan membuat test gagal.

---

## 8. Test

Gunakan Node built-in test runner:

```bash
npm test
```

Pola yang dipakai:

- Unit test helper murni (`text`, `jid`, `group`, `config`, `downloader`, `media`).
- Database memakai `:memory:`; backup/restore memakai file di folder temporary.
- Handler diuji dengan fake socket yang menampung payload terkirim (`tests/helpers/bot.js`).
- Waktu cooldown/rate limit/guard diinjeksi lewat `now` agar tidak flaky.
- Queue diuji dengan gate promise + polling `waitFor`, bukan `sleep` tetap.
- Cache pesan memakai `now` yang diinjeksi agar TTL deterministik.
- Downloader diuji dengan `runCommand` palsu; tidak ada unduhan jaringan nyata.

Contoh test command baru:

```js
const bot = createTestBot();
t.after(() => bot.close());

await bot.handler.handleMessage(bot.sock, makeMessage({ text: '.hello' }));
assert.match(lastText(bot), /Halo/);
```

Test wajib untuk perubahan pada:

- parser / normalisasi JID;
- permission, mode, banned, cooldown, rate limit;
- database, migrasi, backup/restore;
- handler atau error boundary;
- key i18n.

Saat ini ada 164 test. Jika `node --test tests` gagal karena `spawn EPERM` (lingkungan sandbox yang melarang child process), jalankan per file: `node tests/nama.test.js`.

---

## 9. Konvensi

- **CommonJS**, JavaScript + JSDoc. Tidak ada TypeScript di Phase 1–2.
- Satu file command = satu tanggung jawab. Logika berat taruh di `services/`.
- Selalu validasi input dari chat.
- Jangan log token, API key, nomor lengkap, isi pesan, atau URL yang dikirim pengguna.
- Jangan menyalin kode GPL-3.0. Ide boleh; kode ditulis ulang.
- Semua command baru harus punya manifest lengkap, key i18n di `id` + `en`, dan test minimal.
- Downloader tidak boleh memanggil URL dari chat tanpa `validateMediaUrl` (allowlist host + anti-SSRF).
- Untuk mengunduh media WhatsApp, pakai `services/media` (`findMedia` + `download`). Jangan panggil `downloadMediaMessage` langsung tanpa `host: MEDIA_HOST`, karena Baileys rc13 bisa memakai host usang `a.whatsapp.net` dari field `url`.
- Hot reload plugin belum tersedia; restart bot setelah menambah command.

---

## 10. Deployment

- Docker: `docker compose up -d --build`.
- Pterodactyl: gunakan Node.js 22+ atau custom image, startup `node index.js`.
- Pastikan `auth_info_baileys/` dan `data/` berada di volume persisten.
- Downloader butuh `yt-dlp` di `PATH` (atau `YTDLP_PATH`) dan `ffmpeg` untuk `ytmp3`. Image Docker sudah menyertakan keduanya.
- Sinyal `SIGTERM`/`SIGINT` akan menutup socket dan membuat backup sebelum keluar.
