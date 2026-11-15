# Varr-Bot

Bot WhatsApp modular berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) untuk kebutuhan grup, produktivitas, media, AI, dan otomasi. Varr-Bot dirancang agar mudah dirawat, aman dipakai, dan gampang ditambah fitur baru lewat sistem plugin.

> **Status:** **Phase 1 — fondasi selesai** (`v0.1.0`). Struktur `src/`, config, logger, registry command, middleware (permission/cooldown/rate limit/mode/maintenance), SQLite, QR & pairing, serta command dasar sudah tersedia. Fitur lain di bawah masih dalam rencana implementasi.

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

## Fitur yang Direncanakan

Ringkasan kategori (detail lengkap ada di [docs/FEATURES.md](docs/FEATURES.md)):

| Kategori | Contoh fitur |
|---|---|
| Core & UX | Menu per kategori, help, ping, runtime, AFK, multi-bahasa, prefix fleksibel |
| Manajemen grup | Welcome/goodbye, promote/demote, kick, mute, tagall, group info, warning |
| Varr Guard | Anti-link, anti-spam, anti-badword, anti-tagall, anti-bot, anti-call, anti-delete |
| Downloader | YouTube, TikTok, Instagram, Facebook, X/Twitter, Threads, Pinterest, Spotify, MediaFire |
| Sticker & media | Sticker maker, crop, meme, brat, emoji mix, to MP3/PDF/image, OCR, remove background |
| AI | Multi-provider free-first (Gemini, Groq, OpenRouter), chatbot, vision, TTS, image generation |
| Utility | Cuaca, berita, Wikipedia, lyrics, GitHub, kurs, kalkulator, QR, screenshot web |
| Economy & games | Daily reward, bank, level, rank, RPG, mini games, giveaway |
| Automation | Reminder, scheduler, broadcast, auto-download, auto-sticker, auto-reply, status reaction |
| Owner & system | Ban/unban, premium, limit, backup/restore, plugin manager, audit log, Varr Doctor |
| Scale (lanjutan) | Jadibot multi-session, REST API, web dashboard, plugin store |

Beberapa fitur pembeda yang akan ditambahkan:

- **Varr Doctor** — diagnosa kesehatan bot, session, API key, database, dan dependency.
- **Varr Guard** — moderasi berbasis severity (warn → mute → kick), bukan sekadar on/off.
- **Varr Memory** — memori AI per chat dengan consent dan TTL.
- **Varr Insights** — statistik pemakaian tanpa menyimpan isi pesan.
- **Varr SafeMode** — dry-run dan konfirmasi untuk command berbahaya.
- **Plugin manifest** — permission, cooldown, alias, dan hot reload tanpa restart.
- **AI budget guard** — kuota token per user/chat dan fallback provider otomatis.
- **Privacy-first retention** — cache anti-delete dan log dibatasi serta bisa dimatikan.

## Command Dasar

| Command | Akses | Fungsi |
|---|---|---|
| `.menu` | semua | Daftar command sesuai role |
| `.help <command>` | semua | Detail penggunaan, alias, cooldown |
| `.ping` | semua | Latensi, uptime, memori, status database |
| `.alive` | semua | Status singkat bot |
| `.owner` | semua | Kontak owner |
| `.mode [public\|private\|self]` | owner | Ubah mode bot tanpa restart |
| `.maintenance [on\|off]` | owner | Blokir command non-darurat saat maintenance |

Mode: **public** = semua orang, **private** = owner + admin grup, **self** = owner saja.

## Menjalankan

Prasyarat: **Node.js 20+** (Docker memakai Node.js 22 LTS).

```bash
npm install
copy .env.example .env     # Windows
# cp .env.example .env     # Linux/macOS
npm start
```

Isi minimal `OWNER_NUMBERS` di `.env`. Untuk login:

- **QR Code** — biarkan `LOGIN_METHOD` kosong dan `PAIRING_NUMBER` kosong, lalu scan QR di terminal.
- **Pairing Code** — isi `PAIRING_NUMBER=628xxxxxxxxxx` (dengan kode negara), jalankan bot, lalu masukkan kode 8 digit di WhatsApp → Perangkat tertaut.

Session disimpan di `auth_info_baileys/`, database di `data/varr.db`. Jangan commit keduanya.

```bash
npm test
```

### Docker

```bash
copy .env.example .env   # isi OWNER_NUMBERS dulu
docker compose up -d --build
docker logs -f varr-bot
```

Catatan:

- Container membaca config dari `.env` lewat `env_file`. Tanpa `.env`, bot tetap jalan tetapi tanpa owner.
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
│   │   ├── handler.js        # messages.upsert → pipeline command
│   │   ├── queue.js          # queue eksekusi per chat
│   │   ├── messageCache.js   # cache pesan untuk getMessage (retry)
│   │   ├── registry.js       # manifest command + auto-load src/commands
│   │   ├── middleware/       # normalize, mode, permission, cooldown, rate limit
│   │   ├── database/         # interface + driver SQLite
│   │   ├── state.js          # mode & maintenance runtime
│   │   ├── health.js         # laporan kesehatan
│   │   ├── i18n.js           # translator id/en
│   │   ├── logger.js         # pino + redaksi rahasia
│   │   └── errors.js         # AppError, timeout
│   ├── commands/
│   │   ├── general/          # menu, help, ping, alive, owner
│   │   └── owner/            # mode, maintenance
│   ├── locales/              # id.json, en.json
│   └── utils/                # text, jid, group, format
├── tests/                    # node:test (config, DB, registry, middleware, handler)
├── docs/
├── data/                     # runtime DB + backup (tidak di-commit)
├── auth_info_baileys/        # session WhatsApp (tidak di-commit)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

Panduan menambah command ada di [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Dokumentasi

- [Riset & referensi](docs/RESEARCH.md)
- [Daftar fitur & prioritas](docs/FEATURES.md)
- [Roadmap & arsitektur](docs/ROADMAP.md)
- [Keputusan teknis (ADR)](docs/DECISIONS.md)
- [Panduan development](docs/DEVELOPMENT.md)
- [Review Phase 1](docs/REVIEW-PHASE1.md)

## Referensi Utama

Varr-Bot terinspirasi oleh pola dan fitur dari proyek open source berikut (tanpa menyalin kode secara mentah):

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
