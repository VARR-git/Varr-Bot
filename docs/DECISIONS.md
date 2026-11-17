# Keputusan Arsitektur Varr-Bot

**Tanggal:** 15 November 2026  
**Status:** Diterima untuk Phase 1 & Phase 2 (skema database v2)

Dokumen ini mencatat keputusan teknis yang sudah disepakati, alasan, dan konsekuensinya.

---

## ADR-001 — Lisensi MIT

**Keputusan:** Varr-Bot memakai lisensi **MIT**.

**Alasan:**

- Paling fleksibel untuk project pribadi maupun publik.
- Kompatibel dengan Baileys, neoxr-bot, Iris, dan Atlas-MD yang juga MIT.
- Tidak memaksa seluruh project mengikuti GPL-3.0.

**Konsekuensi:**

- Kode MIT boleh dipakai dengan tetap mencantumkan copyright notice.
- Kode dari **BotsApp** dan **games-wabot** (GPL-3.0) **tidak boleh** disalin mentah ke Varr-Bot.
- Referensi berlisensi tidak jelas hanya boleh diambil idenya, bukan kodenya.
- Kredit referensi tetap dicantumkan di README/NOTICE.

---

## ADR-002 — Deployment Docker + Pterodactyl

**Keputusan:** target utama adalah **Docker**, dengan Pterodactyl sebagai lingkungan server.

**Alasan:**

- Docker memberi environment yang konsisten antara lokal dan server.
- Pterodactyl memakai container; image/egg yang rapi memudahkan restart, resource limit, dan backup.
- FFmpeg dan dependency sistem bisa dibundel di image.

**Konsekuensi:**

- `Dockerfile` dan `docker-compose.yml` disediakan.
- Data persisten wajib berada di volume, bukan di filesystem container.
- Untuk Pterodactyl, gunakan **generic Node.js egg** atau **custom egg** yang menjalankan image ini.
- Jangan menyimpan session atau database di dalam image.
- Working directory Pterodactyl umumnya `/home/container`, sedangkan image Docker memakai `/app`; path data harus mengikuti `process.cwd()` atau `DATA_DIR`.

**Catatan Pterodactyl:**

1. Upload project ke server Pterodactyl.
2. Gunakan Node.js 22+.
3. Startup command: `npm install --omit=dev && node index.js`.
4. Pastikan file `auth_info_baileys/` dan `data/` berada di volume server yang persisten.
5. Aktifkan backup server di panel secara berkala.
6. Jika memakai custom image, admin node perlu melakukan `docker pull` image tersebut.

**Operasional Docker:**

- Config masuk ke container lewat `env_file: .env`; file `.env` tidak di-*bake* ke image.
- `restart: on-failure:5` membatasi crash-loop ketika sesi WhatsApp logout/forbidden. Bot sengaja berhenti (bukan reconnect tanpa henti) karena kredensial sudah tidak valid.
- Saat sesi mati: hentikan container, hapus `auth_info_baileys/`, lalu pairing ulang. Jangan menghapus `data/` karena berisi database dan backup.
- `stop_grace_period: 30s` memberi ruang untuk menutup socket dan menjalankan backup saat `SIGTERM`.
- Bind mount di Linux harus bisa ditulis UID container (default `1000`): `sudo chown -R 1000:1000 auth_info_baileys data`.

---

## ADR-003 — Database: SQLite dulu, MySQL/PostgreSQL saat scale

**Keputusan:** **SQLite** menjadi database default Phase 1–4. **MySQL/MariaDB dari panel Pterodactyl** atau **PostgreSQL terpisah** dipakai saat masuk fase multi-session/multi-instance.

### Perbandingan

| Opsi | Setup | RAM | Backup | Concurrency | Cocok untuk |
|---|---|---|---|---|---|
| **SQLite** | Sangat mudah | Sangat rendah | File `.db` + `db.backup()` | Satu writer, banyak reader (WAL) | Satu bot, puluhan–ratusan grup |
| **MySQL/MariaDB panel Pterodactyl** | Sedang; perlu dibuat admin | Shared DB server | Tergantung admin panel | Baik | Multi-session, beberapa instance |
| **PostgreSQL terpisah** | Tinggi; perlu container/VM sendiri | Sedang | Harus diatur sendiri | Sangat baik | Scale besar, butuh fitur lanjutan |
| **JSON file** | Tidak ada | Rendah | Copy file | Buruk; rawan korupsi | Prototipe/migrasi saja |

### Rekomendasi

**Phase 1–4: SQLite.**

- File: `data/varr.db` (atau `DATA_DIR/varr.db`).
- Aktifkan `PRAGMA journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`.
- Backup harian dengan `db.backup()` ke `data/backups/`, simpan 7–30 hari.
- Jangan letakkan file SQLite di network share/NFS.
- SQLite sangat cukup untuk beban bot WhatsApp: ratusan grup dan ribuan command/hari masih ringan.

**Phase 5: pindah ke MySQL/MariaDB panel** jika:

- ada beberapa proses/container bot;
- jadibot multi-session dengan banyak penulis;
- butuh dashboard yang membaca data dari beberapa server;
- butuh replikasi/backup terpusat.

**Jangan** menjalankan MySQL/PostgreSQL **di dalam container bot yang sama**. Alasannya: menambah RAM, proses supervision rumit, dan data bisa hilang saat reinstall/reset container. Gunakan database panel atau service terpisah.

### Kenapa bukan langsung database Pterodactyl?

- Database panel adalah MySQL/MariaDB yang dibuat oleh admin; bukan layanan terkelola penuh.
- Backup, limit koneksi, dan akses remote tergantung konfigurasi admin.
- Untuk satu bot, SQLite lebih sederhana dan tidak menambah titik gagal.
- Jika admin panel menyediakan database dan backup yang baik, MySQL panel adalah pilihan tepat saat scale.

### Abstraction

Varr-Bot akan memakai interface database sendiri:

```text
users, groups, settings, warnings, sessions, stats, audit_logs, migrations
```

Driver awal: `sqlite`. Driver lanjutan: `mysql`, `postgres`. Konfigurasi lewat `DATABASE_URL`; jika kosong, fallback ke SQLite.

---

## ADR-004 — AI gratis: Gemini utama, Groq/OpenRouter fallback

**Keputusan:** AI memakai pendekatan **multi-provider free-first**, bukan satu model.

### Susunan yang direkomendasikan

| Peran | Provider | Model | Kelebihan | Limit gratis (per riset) |
|---|---|---|---|---|
| **Primary** | Google AI Studio | `gemini-4-hydrogen` | 1M context, input teks/gambar/video/audio/PDF, function calling, structured output, thinking | Free input/output; limit detail di AI Studio |
| **Secondary** | Google AI Studio | `gemini-3.8-flash` | Free, kuat untuk coding/agentic, cepat | Free input/output; limit detail di AI Studio |
| **Fast fallback** | Groq | `openai/gpt-oss-120b` | Sangat cepat, cocok chat pendek | 30 RPM, 1.000 RPD, 8K TPM |
| **Fast fallback alternatif** | Groq | `qwen/qwen3.8-27b` | Multilingual, cepat | 30 RPM, 1.000 RPD, 8K TPM |
| **Long-context fallback** | OpenRouter | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M context, reasoning, tools | 20 RPM; 50 RPD (<$10 credit), 1.000 RPD (≥$10) |
| **Vision fallback** | OpenRouter | `google/gemma-4-31b-it:free` | Gambar/video, 262K context, tools | 20 RPM; 50/1.000 RPD |
| **Vision fallback alternatif** | OpenRouter | `nvidia/nemotron-3.5-super-vl:free` | Gambar/video, 1M context | 20 RPM; 50/1.000 RPD |
| **Speech-to-text** | Groq | `whisper-large-v3` | Transkripsi cepat | 20 RPM, 2.000 RPD, 7.200 audio detik/jam |

### Rekomendasi final

**Model utama: `gemini-4-hydrogen`.**

Alasannya:

- gratis untuk input/output;
- konteks 1 juta token;
- multimodal (teks, gambar, video, audio, PDF);
- mendukung function calling dan structured output;
- cocok untuk chatbot, ringkasan, terjemahan, OCR, dan vision.

**Fallback cepat: Groq `openai/gpt-oss-120b`.** Cocok saat Gemini kena rate limit atau butuh respons super cepat. Kekurangannya: TPM hanya 8K, jadi jangan kirim konteks panjang.

**Fallback konteks panjang: OpenRouter Nemotron 3 Ultra 550B (free).** Cocok untuk dokumen/chat panjang dan reasoning, tetapi antrean free tier bisa lambat.

**Fallback vision: OpenRouter Gemma 4 31B (free).** Alternatif saat Gemini multimodal tidak tersedia.

### Catatan penting free tier

1. **Rate limit bisa berubah kapan saja.** Jangan hardcode asumsi limit; baca header/error dan gunakan backoff.
2. **Free tier Gemini dapat memakai data untuk meningkatkan produk** (lihat terms). Jangan kirim data sensitif; beri tahu pengguna.
3. **OpenRouter free model** memakai pool bersama, bisa lambat atau tidak tersedia. Daily limit 50 request jika belum pernah membeli credit.
4. **Groq free** punya TPM rendah (8K), jadi riwayat chat harus dipangkas.
5. **Model bisa deprecated.** Simpan ID model di config, bukan di kode command.
6. **Untuk bot publik dengan trafik tinggi**, free tier tidak akan cukup. Rencanakan upgrade ke paid atau model lokal.

### Arsitektur AI

```text
command .ai
  → AI service
    → provider adapter (gemini | groq | openrouter)
      → key pool + timeout + retry/backoff
        → fallback chain
          → budget guard (token/user/hari)
            → response
```

Fitur yang menyertai:

- `AI_PRIMARY_PROVIDER` dan `AI_FALLBACKS` di config.
- Key pool untuk beberapa API key.
- Circuit breaker: provider yang sering gagal diistirahatkan sementara.
- Kuota per user/chat dan batas biaya harian (walau gratis, tetap dibatasi).
- Redaksi API key di log.
- Tanpa penyimpanan prompt/response secara default.
- `Varr Memory` opt-in dengan TTL.

### Rekomendasi model per kebutuhan

| Kebutuhan | Pilihan terbaik gratis |
|---|---|
| Chat umum bahasa Indonesia | Gemini 4 Hydrogen |
| Respons cepat / chat pendek | Groq gpt-oss-120b |
| Dokumen/chat sangat panjang | Gemini 4 Hydrogen atau Nemotron 3 Ultra free |
| Coding | Gemini 4 Hydrogen / Gemini 3.8 Flash |
| Vision (gambar/video) | Gemini 4 Hydrogen / Gemma 4 31B free |
| Speech-to-text | Groq Whisper large-v3 |
| Image generation | Belum diputuskan; opsi free seperti Pollinations/Cloudflare Workers AI perlu evaluasi terpisah |

**Cara memilih final:** jalankan eval kecil 30–50 prompt bahasa Indonesia (sapaan, FAQ, ringkasan, terjemahan, reasoning, coding, vision, safety). Pilih model dengan akurasi terbaik, bukan hanya benchmark publik.

---

## ADR-005 — Runtime dan bahasa

**Keputusan:**

- Node.js **22 LTS** di Docker.
- **CommonJS** untuk Phase 1 agar kompatibel dengan `index.js` saat ini.
- **JavaScript + JSDoc** dulu; TypeScript dipertimbangkan jika kompleksitas meningkat.
- Baileys di-pin dan dibungkus adapter `core/connection.js`.

**Konsekuensi:**

- Hindari fitur ESM-only pada dependency baru.
- Native module (mis. `better-sqlite3`) harus punya prebuild atau build tools di image.
- Migrasi ke ESM/TypeScript dilakukan lewat keputusan terpisah.

---

## ADR-006 — Penyimpanan dan backup

**Keputusan:**

- Semua data runtime di `DATA_DIR` (default `./data`).
- Session WhatsApp di `AUTH_DIR` (default `./auth_info_baileys`).
- Backup harian SQLite + backup panel Pterodactyl.
- Backup berisi data sensitif; enkripsi sebelum disimpan di luar server.

**Struktur:**

```text
data/
├── varr.db
├── varr.db-wal
├── varr.db-shm
├── backups/
│   └── varr-2026-11-15.db
├── cache/
└── tmp/
```

---

## ADR-007 — Keamanan dan privasi

**Keputusan:**

- Tidak ada `eval`/remote code execution dari chat.
- Permission berlapis: owner > admin grup > premium > user.
- Rate limit + cooldown per user/chat/command.
- Validasi URL downloader (blokir SSRF ke IP internal).
- Sanitasi nama file dan path.
- Redaksi token/API key di log.
- Retensi anti-delete/anti-view-once dibatasi TTL dan opt-in.
- Tidak menyimpan isi pesan secara default.

---

## ADR-008 — Queue per chat & cache pesan untuk `getMessage`

**Keputusan:**

- Setiap command dieksekusi lewat queue in-memory per chat (`src/core/queue.js`).
- Batas default: 50 pesan menunggu per chat (`QUEUE_MAX_PENDING`) dan 500 chat aktif.
- `getMessage` Baileys diisi cache in-memory (`src/core/messageCache.js`): 1.024 entri, TTL 15 menit, menyimpan pesan masuk dan balasan bot.

**Alasan:**

- Tanpa queue, dua command dari chat yang sama bisa balapan menulis `group_settings` dan balasannya bisa datang tidak berurutan.
- Chat berbeda tetap paralel, jadi satu grup ramai tidak memperlambat grup lain.
- Baileys memakai `getMessage` saat penerima meminta kirim ulang pesan (retry receipt). Tanpa implementasi, retry gagal dan pesan tidak pernah diterima.
- Baileys v7 sudah punya retry cache bawaan (512 pesan / 5 menit, hanya pesan keluar). Cache kita adalah lapisan kedua dengan TTL lebih panjang dan mencakup pesan masuk.

**Konsekuensi:**

- Antrean dan cache hilang saat restart; WhatsApp akan mengirim ulang pesan yang belum di-ack.
- Pesan yang melebihi batas antrean dilewati dan dicatat sebagai warning, bukan diproses terlambat.
- `getMessage` wajib mengembalikan `proto.IMessage` (yaitu `sendMessage().message`), bukan `AnyMessageContent` mentah.
- Isi pesan tidak pernah ditulis ke disk.

---

## ADR-009 — Eskalasi warning memakai kick, bukan mute per anggota

**Keputusan:** pelanggaran guard yang berulang dieskalasi dengan urutan **hapus pesan → warning → kick** saat `warn_limit` tercapai.

**Alasan:**

- API WhatsApp tidak menyediakan mute per anggota. `groupSettingUpdate` hanya bisa menutup seluruh grup (`announcement`), bukan membisukan satu nomor.
- Membuat "mute" palsu (menghapus setiap pesan anggota tertentu) berarti bot harus memproses dan menghapus semua pesan mereka; itu rapuh, mahal, dan tetap tidak mencegah anggota mengirim.
- Kick adalah satu-satunya aksi per anggota yang benar-benar didukung, dan mudah dijelaskan ke admin grup.

**Konsekuensi:**

- `.setwarnlimit` menentukan kapan kick dilakukan (default 3, rentang 1–10).
- `.mute`/`.unmute` tetap ada, tetapi berlaku untuk seluruh grup.
- Setelah kick, warning anggota tersebut dihapus agar data tidak menumpuk.
- Warning tetap bisa dipakai manual (`.warn`) tanpa memaksa kick bila `warn_limit` belum tercapai.

---

## ADR-010 — Downloader memakai yt-dlp, bukan API pihak ketiga

**Keputusan:** command `ytmp3`, `ytmp4`, dan `tiktok` memakai binary **yt-dlp** (plus FFmpeg untuk ekstraksi audio), dengan adapter di `src/services/downloader.js`.

**Alasan:**

- Tidak ada API key pihak ketiga yang harus disimpan atau bocor.
- Satu mesin menangani YouTube dan TikTok, dan siap dipakai untuk sumber lain di Phase 3.
- yt-dlp memperbaiki perubahan situs sumber jauh lebih cepat daripada scraper buatan sendiri.
- Perintah dijalankan dengan argumen array (tanpa shell), jadi URL dari chat tidak bisa menjadi command injection.

**Pengamanan:**

- Hanya `http`/`https`, tanpa kredensial di URL, dan port 80/443 saja.
- Host wajib masuk allowlist platform (`youtube.com`, `youtu.be`, `youtube-nocookie.com`, `tiktok.com` beserta subdomainnya).
- IP literal, `localhost`, `.local`, `.internal`, dan `.home.arpa` ditolak sebelum yt-dlp dipanggil (mitigasi SSRF).
- Batas ukuran (`DOWNLOAD_MAX_MB`), durasi (`DOWNLOAD_MAX_DURATION_SEC`), timeout proses, dan jumlah unduhan paralel.
- File temporary di `TMP_DIR` selalu dihapus; file sisa lebih dari 6 jam dibersihkan saat service dipakai.
- Setiap unduhan memakai direktori kerja `mkdtemp` sendiri dan yt-dlp dijalankan dengan `--ignore-config` + `--no-cache-dir`.
- Binary dicari di `BIN_DIR` lebih dulu, lalu `PATH`/path absolut. Auto-install **opt-in** (`YTDLP_AUTO_INSTALL=true`) hanya dari rilis resmi GitHub dengan verifikasi checksum SHA-256.
- Command downloader memakai `timeoutMs` per command (660 detik) agar tidak dipotong `COMMAND_TIMEOUT_MS` global.
- yt-dlp tidak tersedia → command menjawab dengan pesan jelas dan `.doctor` melaporkannya, bukan crash.

**Konsekuensi:**

- Deployment perlu memasang yt-dlp. Image Docker sudah menyertakannya (paket Debian), tetapi versi Debian bisa tertinggal; dokumentasikan cara memperbarui.
- Kegagalan situs sumber tetap mungkin; pesan error dibuat ramah dan tidak membocorkan URL ke log.
- URL awal di-allowlist, tetapi yt-dlp tetap dapat mengikuti redirect/URL internal milik platform. Ini risiko SSRF residual yang tidak sepenuhnya hilang; untuk jaminan lebih ketat, jalankan downloader dengan egress allowlist/container terpisah.
- Test otomatis memakai `runCommand` palsu dan memverifikasi argumen, batas, serta cleanup. Unduhan nyata (YouTube MP3/MP4, TikTok, auto-install rilis resmi) diverifikasi manual sekali dan tidak dijalankan di CI.

---

## ADR-011 — Backup terverifikasi dan restore in-place

**Keputusan:**

- Setiap backup diverifikasi dengan koneksi **read-only** ke file hasil backup: `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, versi skema, dan jumlah baris tiap tabel.
- Backup manual dan backup pengaman sebelum restore selalu `verify: true`.
- Restore dilakukan **in-place** lewat `ATTACH DATABASE` lalu menyalin isi tabel di dalam satu transaksi. Tidak perlu restart.

**Alasan:**

- Backup yang tidak pernah diuji restore adalah asumsi, bukan jaminan. Verifikasi menangkap file rusak/terpotong sebelum dipakai.
- Menutup database saat restore tidak mungkin dilakukan dari dalam command (handler masih memakai koneksi yang sama).
- `ATTACH` + transaksi memberi hasil atomik: bila gagal di tengah jalan, data lama tetap utuh.
- Restore hanya menerima skema yang sama persis; menurunkan/menaikkan skema di luar migrasi akan membuat data tidak konsisten.

**Konsekuensi:**

- Tabel `migrations` tidak ikut dipulihkan; skema aktif tidak boleh berubah karena file backup.
- Restore mengganti isi tabel, termasuk `audit_logs`, lalu mencatat aksi restore di atas data hasil restore.
- State runtime (mode/maintenance di memori) tidak ikut berubah sampai restart; nilai di database sudah benar.
- Backup masih belum terenkripsi (direncanakan di Phase 5).

---

## ADR-012 — Model ban: pengguna dan grup, terpisah dari premium

**Keputusan:**

- Ban disimpan di kolom `users.is_banned` dan `groups.is_banned` (kolom grup sudah ada sejak skema v1; skema v2 menambah alasan dan waktu ban).
- Middleware `banned` berjalan setelah `normalize` dan sebelum `maintenance`.
- Owner selalu lolos. Grup yang di-ban **diabaikan tanpa balasan**; pengguna yang di-ban dibalas sekali per 10 menit.
- `.ban`/`.unban` menerima mention, reply, nomor, atau kata kunci `group`/`grup`. Owner dan bot tidak bisa di-ban.

**Alasan:**

- Ban adalah kill switch kasar untuk penyalahgunaan; ia harus bekerja sebelum aturan lain agar tidak bisa diakali.
- Membalas grup yang di-ban setiap pesan akan menciptakan spam baru; diam lebih aman.
- Pengguna perlu tahu alasannya, tetapi notifikasi dibatasi agar tidak menjadi loop.
- Menyimpan ban di tabel yang sama dengan data pengguna membuat satu query murah per pesan dan ikut ter-backup.

**Konsekuensi:**

- Migrasi v2 melakukan `ALTER TABLE` pada `users` dan `groups`; database lama otomatis naik versi saat startup.
- Ban bersifat per varian JID: command memblokir semua varian yang terdeteksi (PN/LID) agar tidak bisa diakali dengan domain lain.
- Middleware fail-open: bila query DB gagal, bot tetap melayani (dengan log warning) daripada mati total.

---

## Ringkasan Keputusan

| Topik | Keputusan |
|---|---|
| Lisensi | MIT |
| Deploy | Docker + Pterodactyl |
| Database awal | SQLite (`data/varr.db`), skema **v2** |
| Database scale | MySQL panel Pterodactyl / PostgreSQL terpisah |
| AI utama | Gemini 4 Hydrogen (free tier) |
| AI fallback | Gemini 3.8 Flash, Groq gpt-oss-120b, OpenRouter Nemotron 3 Ultra free |
| Vision | Gemini 4 Hydrogen, Gemma 4 31B free |
| STT | Groq Whisper large-v3 |
| Runtime | Node.js 22 LTS, CommonJS |
| Session | Baileys multi-file di volume persisten |
| Eskalasi guard | warning → kick (ADR-009) |
| Mesin downloader | yt-dlp + FFmpeg (ADR-010) |
| Backup | terverifikasi + restore in-place (ADR-011) |
| Ban | tabel user & grup, middleware setelah normalize (ADR-012) |
