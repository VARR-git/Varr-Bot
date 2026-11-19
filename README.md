# <p align="center">Varr-Bot</p>

Bot WhatsApp modular berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) untuk kebutuhan grup, produktivitas, media, AI, dan otomasi. Varr-Bot dirancang agar mudah dirawat, aman dipakai, dan gampang ditambah fitur baru lewat sistem plugin.

> **Status:** Fondasi Phase 1–2 selesai. Source saat ini juga sudah memuat AI multi-provider, media suite, downloader multi-platform, dan economy (55 command).

## Kenapa Varr-Bot?

Banyak bot WhatsApp open source punya ratusan command, tapi sering terkendala oleh:

- kode monolitik dan sulit dirawat;
- command berbahaya tanpa kontrol permission;
- tidak ada cooldown, rate limit, atau audit log;
- data pengguna disimpan tanpa batas;
- API key ditulis langsung di source code;
- fitur banyak tetapi saling bertabrakan.

Varr-Bot mengambil **ide dan pola terbaik** dari bot-bot populer, lalu dibangun ulang dengan fokus pada:

- **Modular** — setiap fitur adalah plugin dengan manifest yang jelas.
- **Aman** — permission berlapis, validasi input, tanpa `eval`, dan rahasia tidak pernah di-log.
- **Privasi** — retensi data dibatasi dan bisa dikonfigurasi.
- **Observable** — log terstruktur, statistik command, dan health check.
- **Portable** — jalan di Windows, Linux, VPS, Docker, PM2, dan Termux.

## Fitur

Ringkasan kategori (detail lengkap ada di [docs/FEATURES.md](docs/FEATURES.md)). ✅ = sudah ada di source saat ini, ⏳ = fase berikutnya.

| Kategori | Contoh fitur | Status |
|---|---|---|
| Core & UX | Menu per kategori, help, ping, multi-bahasa, prefix fleksibel | ✅ |
| Manajemen grup | Welcome/goodbye, promote/demote, kick, mute, tagall, hidetag, group info, warning | ✅ |
| Varr Guard | Anti-link, anti-spam, batas warning, eskalasi warning → kick, guard status | ✅ |
| Sticker & media | Sticker maker, sticker → gambar, MP3, PDF, QR, baca QR | ✅ |
| Downloader | YouTube MP3/MP4, TikTok, Instagram, Facebook, X, Threads, Pinterest, Spotify, SoundCloud | ✅ |
| Owner & system | Ban/unban, mode, maintenance, stats, backup & restore, Varr Doctor | ✅ |
| AI | Multi-provider free-first (Gemini, Groq, OpenRouter), chatbot, ringkasan, translate | ✅ |
| Economy | Daily reward, balance, level, leaderboard | ✅ |
| AI vision & games | Vision, RPG, mini games | ⏳ Phase 4 |
| Utility lain | Cuaca, berita, Wikipedia, lyrics, kalkulator | ⏳ Phase 4 |
| Automation | Reminder, scheduler, broadcast, auto-reply | ⏳ Phase 4 |
| Scale (lanjutan) | Jadibot multi-session, REST API, web dashboard | ⏳ Phase 5 |

Beberapa fitur pembeda yang sudah ada atau akan ditambahkan:

- **Varr Doctor** ✅ — diagnosa kesehatan bot, session, database, disk, FFmpeg, sharp, yt-dlp.
- **Varr Guard** ✅ — moderasi berbasis severity (delete → warn → kick), bukan sekadar on/off.
- **Plugin manifest** ✅ — permission, cooldown, alias, scope, dan file bantuan `_*.js`.
- **Backup terverifikasi** ✅ — backup SQLite dicek integritasnya dan bisa dipulihkan tanpa restart.
- **Varr Memory**, **Varr Insights**, **Varr SafeMode**, **AI budget guard** — direncanakan di fase berikutnya.


## Command

### Umum & owner

| Command | Akses | Fungsi |
|---|---|---|
| `.menu` | semua | Daftar command sesuai role |
| `.help <command>` | semua | Detail penggunaan, alias, cooldown |
| `.ping` | semua | Latensi, uptime, memori, status database |
| `.alive` | semua | Status singkat bot |
| `.owner` | semua | Kontak owner |
| `.mode [public\|private\|self]` | owner | Ubah mode bot tanpa restart |
| `.maintenance [on\|off]` | owner | Blokir command non-darurat saat maintenance |
| `.ban <@user\|reply\|nomor\|group> [alasan]` | owner | Blokir pengguna/grup dari bot |
| `.unban <@user\|reply\|nomor\|group>` | owner | Buka kembali blokir |
| `.stats` | owner | Statistik command, pengguna, grup, warning, DB |
| `.backup [list\|verify <nama>]` | owner | Buat/daftar/verifikasi backup terverifikasi |
| `.restore <nama\|latest> confirm` | owner | Pulihkan database dari backup |
| `.doctor` | owner | Cek session, database, disk, FFmpeg, sharp, yt-dlp |

### Grup (admin grup atau owner)

| Command | Fungsi |
|---|---|
| `.welcome [on\|off\|set <teks>\|reset]` | Sambutan anggota baru; placeholder `{name}`, `{mention}`, `{group}`, `{desc}`, `{count}` |
| `.goodbye [on\|off\|set <teks>\|reset]` | Pesan perpisahan anggota keluar |
| `.promote` / `.demote` | Jadikan / cabut admin |
| `.kick` | Keluarkan anggota (bot harus admin) |
| `.mute` / `.unmute` | Tutup / buka grup |
| `.tagall` / `.hidetag` | Mention semua anggota / mention tersembunyi |
| `.groupinfo` | Info grup, admin, mode pesan |
| `.warn` / `.warnings` / `.unwarn` | Kelola warning dan lihat riwayatnya |

### Varr Guard (admin grup atau owner)

| Command | Fungsi |
|---|---|
| `.antilink [on\|off\|delete\|warn\|kick]` | Guard tautan |
| `.antispam [on\|off\|delete\|warn\|kick]` | Guard flood & pesan berulang |
| `.setwarnlimit <1-10>` | Batas warning sebelum anggota dikeluarkan |
| `.guardstatus` | Ringkasan aturan guard aktif |

Admin grup dan owner selalu dikecualikan dari guard. Eskalasi: warning → keluarkan saat batas tercapai (WhatsApp tidak punya mute per anggota; lihat ADR-009).

### Media & downloader

| Command | Fungsi |
|---|---|
| `.sticker` | Gambar/GIF → sticker WebP |
| `.toimg` | Sticker → gambar PNG |
| `.ytmp3 <url>` | Audio YouTube → MP3 |
| `.ytmp4 <url> [resolusi]` | Video YouTube → MP4 (144p–1080p, default 720p) |
| `.tiktok <url>` | Video TikTok tanpa watermark |

Downloader memakai **yt-dlp** + **FFmpeg**. Metadata dan media diambil dalam **satu** proses yt-dlp (`--print before_dl:`), jadi tidak ada panggilan probe terpisah — unduhan lebih cepat. Batas ukuran, durasi, timeout, jumlah unduhan paralel, dan antrean bisa diatur lewat `.env`. Command downloader punya timeout internal sendiri, jadi tidak terpotong `COMMAND_TIMEOUT_MS` yang lebih pendek. `.ytmp4` menerima resolusi (`144p`–`1080p`, default `720p`); di atas 720p yt-dlp menggabungkan video+audio karena YouTube tidak menyediakan MP4 progresif. Ukuran hasil tetap dibatasi `DOWNLOAD_MAX_MB`, jadi 1080p biasanya butuh nilai lebih tinggi (mis. 64). Hasilnya diverifikasi dengan ffprobe (durasi harus sesuai sumber dan audio tidak boleh hilang) lalu dinormalisasi ke **H.264 + AAC** dengan `faststart` supaya bisa diputar di WhatsApp; AV1/VP9/HEVC otomatis ditranscode bila perlu.

Urutan pencarian binary: `BIN_DIR` → `PATH` (atau path absolut di `YTDLP_PATH`). Jika `YTDLP_AUTO_INSTALL=true` dan yt-dlp belum ada, bot memasangnya sekali dari rilis resmi GitHub dengan verifikasi checksum SHA-256; fitur ini nonaktif secara default. `FFMPEG_PATH` bisa diisi path absolut bila FFmpeg tidak ada di `PATH`. Untuk video yang butuh login/usia, isi `YTDLP_COOKIES_FILE` dengan file cookies format Netscape. Jika dependensi tidak siap, command memberi tahu dan `.doctor` melaporkannya.

Mode: **public** = semua orang, **private** = owner + admin grup, **self** = owner saja.

## Menjalankan

Prasyarat:

- **Node.js 20+** (Docker memakai Node.js 22 LTS).
- **yt-dlp** di `PATH`, di `BIN_DIR`, atau lewat `YTDLP_PATH` untuk command downloader.
- **FFmpeg** untuk konversi audio/video (`ytmp3` butuh ini); bisa lewat `FFMPEG_PATH`.
- **sharp** terpasang otomatis lewat `npm install` (dipakai sticker/toimg).

> Di Windows, tutup dan buka ulang terminal setelah memasang yt-dlp/FFmpeg agar perubahan `PATH` terpakai. Alternatifnya isi `YTDLP_PATH`/`FFMPEG_PATH` dengan path absolut atau taruh binary di `BIN_DIR`.

```bash
npm install
copy .env.example .env     # Windows
# cp .env.example .env     # Linux/macOS
npm start
```

Isi minimal `OWNER_NUMBERS` di `.env`. Untuk login:

- **QR Code** — biarkan `LOGIN_METHOD` kosong dan `PAIRING_NUMBER` kosong, lalu scan QR di terminal.
- **Pairing Code** — isi `PAIRING_NUMBER=628xxxxxxxxxx` (dengan kode negara), jalankan bot, lalu masukkan kode 8 digit di WhatsApp → Perangkat tertaut.

Session disimpan di `auth_info_baileys/`, database di `data/varr.db`, backup di `data/backups/`, file sementara downloader di `data/tmp/`. Jangan commit semuanya.

```bash
npm test
```

### Backup & restore

Backup otomatis berjalan setiap 24 jam dan saat shutdown, dengan retensi `BACKUP_KEEP` (default 14).

```text
.backup                          # buat backup + verifikasi integritas
.backup list                     # daftar backup
.backup verify latest            # cek integritas + skema + jumlah baris
.restore latest confirm          # pulihkan (backup pengaman dibuat dulu)
```

Restore dilakukan **in-place** (tanpa restart) lewat `ATTACH DATABASE` di dalam satu transaksi, dan hanya menerima backup dengan versi skema yang sama.

### Docker

```bash
copy .env.example .env   # isi OWNER_NUMBERS dulu
docker compose up -d --build
docker logs -f varr-bot
```

Catatan:

- Container membaca config dari `.env` lewat `env_file`. Tanpa `.env`, bot tetap jalan tetapi tanpa owner.
- Image sudah berisi FFmpeg dan yt-dlp. Jika downloader tiba-tiba gagal setelah situs sumber berubah, perbarui yt-dlp di image lalu bangun ulang.
- `auth_info_baileys/` dan `data/` di-mount sebagai volume. Di Linux, pastikan folder host bisa ditulis user container (UID 1000): `sudo chown -R 1000:1000 auth_info_baileys data`.
- `restart: on-failure:5` mencegah crash-loop tanpa henti saat sesi logout. Jika session mati, hapus `auth_info_baileys/` lalu pairing ulang.
- `docker compose down` mengirim `SIGTERM`; bot menutup socket dan membuat backup sebelum keluar (`stop_grace_period: 30s`).

Untuk Pterodactyl, baca [docs/DECISIONS.md](docs/DECISIONS.md).

## Struktur Repo

```text
.
├── src/
│   ├── index.js              # bootstrap: config, DB, registry, connection, shutdown
│   ├── config/index.js       # loader & validasi environment
│   ├── core/
│   │   ├── connection.js     # Baileys: QR/pairing, reconnect, graceful shutdown
│   │   ├── handler.js        # messages.upsert → guard → pipeline command
│   │   ├── queue.js          # queue eksekusi per chat
│   │   ├── messageCache.js   # cache pesan untuk getMessage (retry)
│   │   ├── registry.js       # manifest command + auto-load src/commands
│   │   ├── middleware/       # normalize, banned, maintenance, mode, permission, scope, cooldown, rate limit
│   │   ├── database/         # interface + driver SQLite (skema v2, backup, restore)
│   │   ├── state.js          # mode & maintenance runtime
│   │   ├── health.js         # laporan kesehatan
│   │   ├── i18n.js           # translator id/en
│   │   ├── logger.js         # pino + redaksi rahasia
│   │   └── errors.js         # AppError, timeout
│   ├── commands/
│   │   ├── general/          # menu, help, ping, alive, owner
│   │   ├── group/            # welcome, goodbye, promote, demote, kick, mute, tagall, warn, ...
│   │   ├── guard/            # antilink, antispam, setwarnlimit, guardstatus
│   │   ├── media/            # sticker, toimg, tomp3, topdf, qr, readqr
│   │   ├── downloader/       # ytmp3, ytmp4, tiktok, ig, fb, x, threads, pinterest, spotify, soundcloud (+ _shared.js)
│   │   ├── ai/               # ai, chatbot, resetai, summary, translate (+ _shared.js)
│   │   ├── economy/          # balance, daily, level, leaderboard (+ _shared.js)
│   │   ├── owner/            # mode, maintenance, ban, unban, stats, backup, restore
│   │   └── tools/            # doctor
│   ├── services/             # guard, groupEvents, media, downloader, warnings, ai, aiMemory
│   ├── locales/              # id.json, en.json
│   └── utils/                # text, jid, group, groupTarget, groupModeration, economy, chatbot, backups, ...
├── tests/                    # node:test
├── docs/
├── data/                     # runtime DB, backup, tmp (tidak di-commit)
├── auth_info_baileys/        # session WhatsApp (tidak di-commit)
├── Dockerfile
├── docker-compose.yml
└── package.json
```


## Arsitektur & Alur

Bagian ini adalah peta cara kerja Varr-Bot dari proses start sampai pesan dibalas. Diagram mengikuti kode di `src/`; registry saat ini memuat 55 command.

Urutan baca yang disarankan: **siklus hidup (2) → pesan masuk (3) → pipeline middleware (4)**, lalu guard/event grup (5), alur layanan (6), dan data (7).

### 1. Peta komponen

```mermaid
flowchart LR
  WA["WhatsApp"]
  SOCK["Baileys socket"]
  CONN["core/connection.js"]
  CACHE["core/messageCache.js"]
  HANDLER["core/handler.js"]
  EVENTS["services/groupEvents.js"]
  QUEUE["core/queue.js"]
  PIPE["core/middleware/*"]
  REG["core/registry.js"]
  CMD["src/commands/*"]
  SERVICES["services/* + utils/*"]
  DB[("SQLite<br/>data/varr.db")]
  FS[("data/tmp<br/>data/backups<br/>auth_info_baileys")]
  EXT["yt-dlp<br/>FFmpeg / ffprobe<br/>sharp<br/>API AI"]

  WA <--> SOCK
  SOCK <--> CONN
  CONN -->|"messages.upsert"| HANDLER
  CONN -->|"group-participants.update"| EVENTS
  CONN <-->|"getMessage (retry)"| CACHE
  HANDLER --> QUEUE
  QUEUE --> PIPE
  PIPE --> REG
  REG --> CMD
  CMD --> SERVICES
  HANDLER -->|"chatbot / pesan biasa"| SERVICES
  SERVICES --> DB
  EVENTS --> DB
  SERVICES --> FS
  SERVICES --> EXT
```

| Lapisan | Modul | Tanggung jawab |
|---|---|---|
| Bootstrap | `index.js`, `src/index.js` | Merakit dependency, menjalankan koneksi, shutdown. |
| Konfigurasi | `src/config/index.js` | Membaca `.env`, validasi nilai, mengubah path relatif menjadi absolut. |
| Koneksi | `core/connection.js`, `core/messageCache.js` | Baileys, QR/pairing, reconnect, cache pesan untuk retry. |
| Masuk | `core/handler.js` | Filter pesan, deduplikasi, guard, parsing, queue, chatbot. |
| Eksekusi | `core/queue.js`, `core/middleware/*`, `core/registry.js` | Serialisasi per chat, pipeline izin, manifest command. |
| Fitur | `src/commands/*` | Command tipis: validasi argumen, panggil service, balas. |
| Domain | `src/services/*`, `src/utils/*` | Guard, warning, media, downloader, AI, ekonomi, format. |
| Data | `core/database/*` | SQLite, migrasi, setting, statistik, audit, backup/restore. |
| Observability | `core/logger.js`, `core/health.js`, `.doctor` | Log terstruktur, health report, diagnosa dependency. |

### 2. Siklus hidup proses

```mermaid
sequenceDiagram
  autonumber
  participant OP as Operator
  participant IDX as src/index.js
  participant CFG as config
  participant DB as SQLite
  participant REG as Registry
  participant CONN as connection
  participant WA as WhatsApp

  OP->>IDX: npm start
  IDX->>CFG: loadConfig()
  alt Konfigurasi tidak valid
    CFG-->>IDX: AppError
    IDX-->>OP: exit(1)
  end
  IDX->>IDX: buat logger + direktori data/auth/tmp
  IDX->>DB: createDatabase() + migrasi skema
  IDX->>DB: baca setting mode & maintenance
  IDX->>REG: loadCommands() rekursif dari src/commands
  IDX->>IDX: buat services, middleware, handler
  IDX->>CONN: createConnection(...)
  CONN->>CONN: useMultiFileAuthState(authDir)
  CONN->>WA: makeWASocket()
  alt Belum punya sesi
    WA-->>CONN: QR atau pairing code
    CONN-->>OP: tampilkan QR / kode 8 digit
  end
  WA-->>CONN: connection = open
  CONN->>IDX: onReady()
  IDX->>IDX: health report + cek yt-dlp (non-blocking)
  IDX->>IDX: setInterval backup 24 jam
```

Saat koneksi putus, `connection.js` membedakan gangguan sementara dan sesi permanen:

```mermaid
flowchart TD
  CLOSE["Koneksi tertutup"] --> STOPPING{"stopping?"}
  STOPPING -- ya --> END["berhenti"]
  STOPPING -- tidak --> FATAL{"status fatal?<br/>loggedOut, forbidden,<br/>multideviceMismatch,<br/>connectionReplaced"}
  FATAL -- ya --> ONSHUT["onFatal → shutdown(1)"]
  FATAL -- tidak --> BACKOFF["reconnect backoff<br/>0,5s sampai 30s + jitter"]
  BACKOFF --> START["connection.start()"]

  SIG["SIGINT / SIGTERM"] --> DRAIN["handler.drain(5s)"]
  DRAIN --> SOCKSTOP["connection.stop()"]
  SOCKSTOP --> DISPOSE["handler.dispose()"]
  DISPOSE --> BAK["backup 'shutdown'"]
  BAK --> DBC["db.close()"]
  DBC --> EXIT["process.exit()"]
```

`shutdown()` idempotent: pemanggilan berikutnya memakai promise yang sama. Backup terjadwal berjalan tiap 24 jam dan saat shutdown, dengan retensi `BACKUP_KEEP` (default 14).

### 3. Alur pesan masuk

```mermaid
flowchart TD
  A["messages.upsert"] --> B{"type = notify?"}
  B -- tidak --> STOP["abaikan"]
  B -- ya --> C["Promise.allSettled untuk setiap pesan"]
  C --> D{"remoteJid ada,<br/>bukan fromMe,<br/>message ada?"}
  D -- tidak --> STOP
  D -- ya --> E{"status, broadcast,<br/>atau newsletter?"}
  E -- ya --> STOP
  E -- tidak --> F{"ID pesan sudah diproses?"}
  F -- ya --> STOP
  F -- tidak --> G["unwrapMessage + extractText"]
  G --> H{"ada teks?"}
  H -- tidak --> STOP
  H -- ya --> I["guard.enforce() bila grup"]
  I --> J{"guard menangani pesan?"}
  J -- ya --> K["stat guard:handled"] --> STOP
  J -- tidak --> L["grantPassiveXp()"]
  L --> M["parseCommand(prefix)"]
  M --> N{"command dikenali?"}
  N -- ya --> O["queue per chat"]
  N -- tidak --> O
  O --> P{"alur"}
  P -- command --> Q["processCommand()"]
  P -- teks biasa --> R["maybeChatbot()"]
```

Semua pesan yang lolos filter masuk ke queue yang sama. Queue bersifat **per chat**: pesan dari chat yang sama diproses berurutan, sedangkan chat berbeda berjalan paralel. Batas default 50 pesan menunggu per chat dan 500 chat aktif; bila penuh, pesan dilewati dan dicatat di log.

**Cabang command:**

```mermaid
flowchart TD
  A["processCommand()"] --> B["buildContext()<br/>identitas, peran, db, services"]
  B --> C{"registry.get(nama)"}
  C -- tidak --> D["handleUnknownCommand()<br/>balas maksimal sekali per 15 detik"]
  C -- ya --> E["pipeline middleware"]
  E --> F["executeCommand()<br/>withTimeout(timeoutMs)"]
  F --> G{"return string?"}
  G -- ya --> H["ctx.reply()"]
  G -- tidak --> I["selesai"]
  F --> J["statistik command:total,<br/>per command, user, grup"]
  E -. error .-> K["handleError()<br/>log + pesan generik"]
```

Command tidak dikenal tidak dibalas di mode `private`/`self` bila pengirim bukan owner, supaya keberadaan bot tidak bocor. Command yang mengembalikan string otomatis dikirim sebagai balasan; command yang mengirim media mengembalikan `null`.

**Cabang chatbot:**

```mermaid
flowchart TD
  A["maybeChatbot()"] --> B{"AI aktif dan<br/>chatbot on di chat ini?"}
  B -- tidak --> STOP["berhenti"]
  B -- ya --> C{"maintenance atau<br/>pengirim/grup dibanned?"}
  C -- ya --> STOP
  C -- tidak --> D{"grup?"}
  D -- ya --> E{"mention bot atau<br/>reply pesan bot?"}
  E -- tidak --> STOP
  E -- ya --> F["ambil riwayat aiMemory"]
  D -- tidak --> F
  F --> G["ai.generate()"]
  G --> H["kirim balasan + simpan riwayat"]
```

Status chatbot disimpan di database: `group_settings.chatbot` untuk grup dan `settings.chatbot:<jid>` untuk chat pribadi. Riwayat AI hanya di memori (30 menit, maksimal 20 pesan per scope) dan di-reset lewat `.resetai`.

### 4. Pipeline middleware

Urutan ini hanya berjalan untuk command, bukan chatbot:

```mermaid
flowchart LR
  N["1 normalize<br/>identitas + role"] --> B["2 banned"]
  B --> M["3 maintenance"]
  M --> MO["4 mode"]
  MO --> P["5 permission"]
  P --> S["6 scope"]
  S --> C["7 cooldown"]
  C --> R["8 rate limit"]
  R --> X["execute command"]
```

| Middleware | Yang dicek | Pengecualian |
|---|---|---|
| `normalize` | Identitas pengirim, metadata grup, role, daftar user/grup di DB. | — |
| `banned` | User/grup yang diblokir owner. | Owner selalu lolos. Grup diblokir diabaikan tanpa balasan; user diblokir diberi tahu sekali per 10 menit. |
| `maintenance` | Status maintenance runtime. | Owner dan command `maintenanceSafe`. |
| `mode` | `public`, `private`, atau `self`. | Owner selalu lolos. `private` mengizinkan admin grup; `self` hanya owner. |
| `permission` | Hierarki `user < premium < admin < owner`. | — |
| `scope` | `all`, `group`, atau `private`. | — |
| `cooldown` | Cooldown per pengirim + command. | Owner. Default 3 detik bila manifest tidak mengisi. |
| `rate limit` | Sliding window per pengirim. | Owner. Default 20 command per 60 detik. |

Middleware yang tidak memanggil `next()` menghentikan pipeline. Error di command ditangkap `handleError`, dicatat, dan pengguna menerima pesan yang aman (detail internal tidak dikirim).

### 5. Guard dan event grup

**Guard** berjalan untuk seluruh pesan teks grup, termasuk pesan yang berisi command:

```mermaid
flowchart TD
  A["Pesan grup"] --> B{"antilink / antispam aktif?"}
  B -- tidak --> OK["lanjut ke command/chatbot"]
  B -- ya --> C["ambil metadata grup"]
  C --> D{"pengirim admin grup<br/>atau owner bot?"}
  D -- ya --> OK
  D -- tidak --> E{"melanggar link<br/>atau spam?"}
  E -- tidak --> OK
  E -- ya --> F{"bot admin grup?"}
  F -- tidak --> OK
  F -- ya --> G["hapus pesan"]
  G --> H{"aksi guard"}
  H -- delete --> OK2["selesai, pesan dihentikan"]
  H -- kick --> I["keluarkan anggota<br/>+ audit + notifikasi"] --> OK2
  H -- warn --> J["tambah warning"]
  J --> K{"warning mencapai batas?"}
  K -- belum --> OK2
  K -- ya --> L{"bot masih admin?"}
  L -- ya --> M["kick + audit + notifikasi"] --> OK2
  L -- tidak --> N["beri tahu bahwa bot butuh admin"] --> OK2
```

Deteksi spam memakai 6 pesan dalam 5 detik atau 3 pesan teks identik dalam 10 detik. Batas warning default 3 dan bisa diubah `.setwarnlimit` (1–10). Bila guard sudah menangani pesan, command di pesan tersebut tidak dieksekusi.

**Event grup** (welcome/goodbye) tidak lewat handler pesan:

```mermaid
sequenceDiagram
  participant WA as WhatsApp
  participant CONN as connection
  participant GE as groupEvents
  participant DB as SQLite

  WA->>CONN: group-participants.update
  CONN->>CONN: invalidate cache metadata grup
  CONN->>GE: handle(event)
  GE->>DB: getGroupSetting(welcome/goodbye)
  alt Nonaktif atau aksi bukan add/remove
    GE-->>CONN: selesai
  else Aktif
    GE->>CONN: getGroupMetadata()
    GE->>GE: render template {name}, {mention}, {group}, {desc}, {count}
    GE->>WA: sendMessage(teks + mentions)
  end
```

Promote/demote sengaja tidak mengirim pesan. Maksimal 10 peserta diproses per event dan template dibatasi 1.000 karakter.

### 6. Alur layanan domain

**Media dasar** (`.sticker`, `.toimg`, `.tomp3`, `.topdf`, `.qr`, `.readqr`):

```mermaid
flowchart LR
  A["Command media"] --> B["sumber input:<br/>media pesan/quoted atau teks argumen"]
  B --> C{"butuh media?"}
  C -- ya --> D["findMedia() + cek ukuran/durasi"]
  D --> E["downloadMediaMessage()"]
  E --> G{"jenis proses"}
  C -- tidak --> G
  G -- gambar --> H["sharp<br/>sticker / PNG"]
  G -- audio --> I["FFmpeg<br/>MP3"]
  G -- teks/gambar --> J["pdf-lib<br/>PDF"]
  G -- QR --> K["qrcode / jsqr"]
  H --> L["kirim hasil"]
  I --> L
  J --> L
  K --> L
```

Dependency opsional (`sharp`, `pdf-lib`, `qrcode`, `jsqr`) dimuat dengan aman; bila salah satu tidak ada, hanya fitur terkait yang dinonaktifkan dan command memberi tahu pengguna.

**Downloader** (`.ytmp3`, `.ytmp4`, `.tiktok`, `.ig`, `.fb`, `.x`, `.threads`, `.pinterest`, `.spotify`, `.soundcloud`):

```mermaid
flowchart TD
  A["Command downloader"] --> B["validasi URL<br/>http/https, port 80/443,<br/>host allowlist, tolak host internal"]
  B --> C{"platform"}
  C -- YouTube/TikTok/IG/X/Threads/SoundCloud --> D{"yt-dlp tersedia?"}
  D -- tidak --> E["balas dependency belum siap"]
  D -- ya --> F["limiter: maksimal 2 unduhan paralel"]
  F --> G["direktori temporary sendiri"]
  G --> H["satu proses yt-dlp:<br/>metadata + unduhan"]
  H --> I["ffprobe: cek durasi + audio"]
  I --> J["normalisasi H.264 + AAC<br/>atau audio MP3/M4A"]
  J --> K["kirim lewat path file"]
  C -- Spotify/Pinterest/Facebook --> L["scraper sumber<br/>tanpa yt-dlp"]
  L --> M["fetchFile()<br/>batas ukuran + timeout"]
  M --> K
  K --> N["cleanup file temporary"]
```

Downloader memakai allowlist platform, batas ukuran (`DOWNLOAD_MAX_MB`), durasi (`DOWNLOAD_MAX_DURATION_SEC`), timeout, dan antrean. Auto-install yt-dlp hanya dari rilis resmi GitHub dengan verifikasi checksum SHA-256 dan nonaktif secara default. File sementara selalu dibersihkan di blok `finally`.

**AI** (`.ai`, `.summary`, `.translate`, `.chatbot`, `.resetai`):

```mermaid
flowchart TD
  A["Command AI / chatbot"] --> B{"AI_ENABLED?"}
  B -- tidak --> X["balas fitur nonaktif"]
  B -- ya --> C{"kuota harian scope habis?"}
  C -- ya --> Y["balas kuota habis"]
  C -- tidak --> D["susun pesan/input + riwayat"]
  D --> E["coba provider berikutnya<br/>(utama → fallback)"]
  E --> F{"berhasil?"}
  F -- ya --> G["record quota + balas"]
  F -- tidak --> H["catat gagal, lanjut fallback"]
  H --> I{"masih ada provider?"}
  I -- ya --> E
  I -- tidak --> J["balas semua provider gagal"]
  F -. 429 .-> K["rotasi API key"]
  K --> E
```

`AiService` memakai key pool, rotasi key saat rate limit, retry ringan, circuit breaker (3 kegagalan → jeda 30 detik), kuota harian per user/chat, dan redaksi API key dari log/error.

**Ekonomi** — setiap pesan valid memberi XP pasif 10–20 dengan cooldown 45 detik. `.daily` memberi 500 koin + 150 XP sekali per 24 jam; level dihitung dari total XP `50 × n × (n − 1)`. `.balance`, `.level`, dan `.leaderboard` membaca data yang sama di tabel `users`.

### 7. Data dan persistensi

```mermaid
erDiagram
  SETTINGS {
    TEXT key PK
    TEXT value
    INTEGER updated_at
  }
  USERS {
    TEXT jid PK
    TEXT lid
    TEXT name
    INTEGER is_premium
    INTEGER is_banned
    INTEGER command_count
    INTEGER balance
    INTEGER xp
    INTEGER level
    INTEGER last_daily
    INTEGER last_xp_at
    INTEGER created_at
    INTEGER updated_at
  }
  GROUPS {
    TEXT jid PK
    TEXT name
    INTEGER is_banned
    INTEGER command_count
    INTEGER created_at
    INTEGER updated_at
  }
  GROUP_SETTINGS {
    TEXT group_jid FK
    TEXT key
    TEXT value
    INTEGER updated_at
  }
  WARNINGS {
    INTEGER id PK
    TEXT group_jid
    TEXT user_jid
    TEXT reason
    TEXT warned_by
    INTEGER created_at
  }
  STATS {
    TEXT key PK
    INTEGER value
    INTEGER updated_at
  }
  AUDIT_LOGS {
    INTEGER id PK
    TEXT actor_jid
    TEXT action
    TEXT target
    TEXT meta
    INTEGER created_at
  }
  MIGRATIONS {
    INTEGER version PK
    TEXT name
    INTEGER applied_at
  }

  GROUPS ||--o{ GROUP_SETTINGS : memiliki
  GROUPS ||--o{ WARNINGS : mencatat
  USERS ||--o{ WARNINGS : menerima
```

Database memakai `better-sqlite3` dengan prepared statement dan migrasi berurutan (skema awal, ban-control, economy). Nilai kompleks seperti metadata audit disimpan sebagai JSON di kolom `TEXT`.

Backup berjalan otomatis tiap 24 jam dan saat shutdown. `.backup` membuat backup + verifikasi, `.backup verify` mengecek integritas dan jumlah baris, dan `.restore` memulihkan in-place lewat `ATTACH DATABASE` dalam satu transaksi. Restore hanya menerima backup dengan versi skema yang sama, dan membuat backup pengaman sebelum menimpa data.

### 8. Batas dan aturan runtime

| Aturan | Nilai default | Sumber |
|---|---|---|
| Timeout command | 30 detik | `COMMAND_TIMEOUT_MS` |
| Timeout command berat | Diatur per manifest, mis. downloader 660 detik | `timeoutMs` command |
| Cooldown command | 3 detik | `COMMAND_COOLDOWN` |
| Rate limit | 20 command / 60 detik | `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` |
| Queue per chat | 50 pesan menunggu | `QUEUE_MAX_PENDING` |
| Deduplikasi pesan | 1.000 ID terakhir | `core/handler.js` |
| Batas media | 16 MB | `MEDIA_MAX_MB` |
| Batas unduhan | 16 MB / 900 detik | `DOWNLOAD_MAX_MB`, `DOWNLOAD_MAX_DURATION_SEC` |
| Retensi backup | 14 file | `BACKUP_KEEP` |

Mode bot disimpan di database sehingga bertahan setelah restart:

- **public** — semua orang boleh memakai command.
- **private** — owner dan admin grup.
- **self** — owner saja.

Perubahan mode dan maintenance dilakukan lewat command owner dan langsung berlaku tanpa restart. Semua akses database lewat `core/database`, sehingga command tidak menulis SQL sendiri.

Panduan menambah command ada di [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Dokumentasi

- [Riset & referensi](docs/RESEARCH.md)
- [Daftar fitur & prioritas](docs/FEATURES.md)
- [Roadmap & arsitektur](docs/ROADMAP.md)
- [Keputusan teknis (ADR)](docs/DECISIONS.md)
- [Panduan development](docs/DEVELOPMENT.md)
- [Review Phase 1](docs/REVIEW-PHASE1.md)
- [Review Phase 2](docs/REVIEW-PHASE2.md)

## Referensi Utama

Varr-Bot terinspirasi dari proyek open source berikut:

- [Baileys](https://github.com/WhiskeySockets/Baileys)
- [BotsApp](https://github.com/Prince-Mendiratta/BotsApp)
- [Knightbot-MD](https://github.com/mruniquehacker/Knightbot-MD)
- [neoxr-bot](https://github.com/neoxr/neoxr-bot)
- [Iris](https://github.com/KillovSky/Iris)
- [Atlas-MD](https://github.com/FantoX/Atlas-MD)
- [WhatsAsena / lyfe00011](https://github.com/lyfe00011/whatsapp-bot)
- [games-wabot](https://github.com/BochilGaming/games-wabot)
- [SUBZERO-MD](https://github.com/mrfrankofcc/SUBZERO-MD)
- [STAR-XD](https://github.com/mrxdking/star-xd)

Detail evaluasi, lisensi, dan pelajaran dari masing-masing repo ada di [docs/RESEARCH.md](docs/RESEARCH.md).

## Lisensi & Disclaimer

Varr-Bot memakai lisensi **MIT** — lihat [LICENSE](LICENSE). Kode dari repo MIT boleh dipakai dengan tetap mencantumkan copyright notice. Kode dari repo **GPL-3.0** seperti BotsApp dan games-wabot tidak boleh disalin mentah ke project ini. Referensi yang lisensinya tidak jelas hanya boleh diambil idenya.

Varr-Bot adalah software tidak resmi dan **tidak berafiliasi dengan WhatsApp/Meta**. Penggunaan bot otomatis berisiko membuat nomor dibatasi atau diblokir. Gunakan nomor sekunder, jangan kirim spam, dan patuhi hukum yang berlaku.
