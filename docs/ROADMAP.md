# Roadmap & Arsitektur Varr-Bot

Dokumen ini menjelaskan target arsitektur, tahapan implementasi, kriteria selesai, dan risiko. Fase riset sudah selesai; implementasi dimulai dari Phase 1 setelah blueprint disetujui.

---

## 1. Prinsip Pengembangan

1. **Fondasi dulu, fitur kemudian.** Jangan menambah 50 command sebelum handler, permission, dan database stabil.
2. **Satu command = satu tanggung jawab.** Command tipis; logika berat ada di `services/`.
3. **Aman secara default.** Permission minimum, validasi input, tanpa `eval`, rahasia di `.env`.
4. **Bisa dimatikan.** Fitur sensitif (anti-delete, AI memory, broadcast) opt-in.
5. **Observable.** Setiap error punya log dan konteks; setiap command punya statistik.
6. **Tidak menyalin kode berlisensi ketat.** Ide boleh, kode GPL-3.0 tidak, kecuali lisensi project berubah.
7. **Test untuk core, bukan semua fitur.** Prioritaskan middleware, permission, parser, dan database.

---

## 2. Struktur Phase 1

```text
.
├── src/
│   ├── index.js                 # bootstrap: config, DB, registry, connection
│   ├── config/
│   │   └── index.js             # load .env, validasi, default
│   ├── core/
│   │   ├── connection.js        # Baileys, QR/pairing, reconnect
│   │   ├── handler.js           # messages.upsert → pipeline
│   │   ├── registry.js          # manifest command + auto-load
│   │   ├── logger.js            # pino + redaksi
│   │   ├── errors.js            # error types & timeout
│   │   ├── health.js            # laporan kesehatan
│   │   ├── state.js             # mode & maintenance runtime
│   │   ├── i18n.js              # translator id/en
│   │   ├── middleware/
│   │   │   ├── index.js         # compose + urutan default
│   │   │   ├── normalize.js
│   │   │   ├── maintenance.js
│   │   │   ├── mode.js
│   │   │   ├── permission.js
│   │   │   ├── scope.js
│   │   │   ├── cooldown.js
│   │   │   └── rateLimit.js
│   │   └── database/
│   │       ├── index.js         # interface + pemilihan driver
│   │       └── sqlite.js        # default Phase 1
│   ├── commands/
│   │   ├── general/             # menu, help, ping, alive, owner
│   │   └── owner/               # mode, maintenance
│   ├── locales/
│   │   ├── id.json
│   │   └── en.json
│   └── utils/
│       ├── text.js
│       ├── jid.js
│       ├── group.js
│       └── format.js
├── data/                        # SQLite, backup, cache (runtime)
├── auth_info_baileys/           # session WhatsApp (runtime)
├── tests/
├── docs/
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

Folder `services/`, `events/`, `plugins/`, dan driver `mysql.js` akan ditambahkan saat fiturnya masuk. Phase 1 sengaja tidak membuat folder kosong.

**Keputusan teknis awal:**

- **CommonJS** dipertahankan agar kompatibel dengan `index.js` saat ini. Migrasi ke ESM bisa dilakukan setelah core stabil.
- **JavaScript + JSDoc** dulu; TypeScript dipertimbangkan jika kontributor dan kompleksitas bertambah.
- **Baileys di-pin** ke versi tertentu dan dibungkus adapter `core/connection.js` agar upgrade tidak menyebar ke seluruh kode.
- **SQLite** (`better-sqlite3`) untuk Phase 1–4; **MySQL/MariaDB panel Pterodactyl** atau **PostgreSQL** untuk scale.
- **`ffmpeg-static`** untuk media, dengan fallback ke FFmpeg sistem.
- **Node built-in test runner** (`node:test`) untuk mengurangi dependency.

---

## 3. Tahapan

### Phase 0 — Riset & Blueprint ✅

**Output:**

- `docs/RESEARCH.md` — evaluasi 10+ repo referensi.
- `docs/FEATURES.md` — daftar fitur & prioritas.
- `docs/ROADMAP.md` — dokumen ini.
- Identitas project: `varr-bot`, README, `.gitignore`.

**Definition of done:** arah project, referensi, dan cakupan fitur sudah jelas.

---

### Phase 1 — Fondasi (P0) ✅

**Tujuan:** mengubah prototipe satu file menjadi kerangka bot yang aman dan bisa dikembangkan.

**Deliverables (selesai):**

- Refactor entry point menjadi `src/index.js` + `core/connection.js`.
- Config loader + `.env.example` + validasi + path absolut.
- Logger pino dengan redaksi rahasia.
- Registry command + manifest + auto-load `src/commands/`.
- Middleware: normalize, maintenance, mode, permission, scope, cooldown, rate limit.
- Role: owner, admin grup, premium, user.
- SQLite + interface driver: settings, users, groups, group settings, warnings, stats, audit, migrations.
- Command awal: `.menu`, `.help`, `.ping`, `.alive`, `.owner`, `.mode`, `.maintenance`.
- Error boundary + timeout command.
- Queue per chat agar command dari chat yang sama tidak balapan.
- Cache pesan untuk `getMessage` (retry kirim ulang Baileys).
- Graceful shutdown (`SIGINT`/`SIGTERM`), reconnect backoff, backup harian.
- Test: config, database, registry, parser, JID, grup, middleware, handler, queue, cache pesan (70 test).
- Dokumentasi arsitektur & cara menambah command (`docs/DEVELOPMENT.md`).

**Definition of done:**

- ✅ Kode QR/pairing, session persisten, dan reconnect tersedia.
- ✅ `.menu` tampil per kategori dan menyesuaikan role.
- ✅ Command tidak dikenal ditangani dengan pesan jelas (di-throttle).
- ✅ Cooldown, rate limit, mode, dan permission terbukti lewat test.
- ⏳ Restart & koneksi WhatsApp perlu diverifikasi saat deployment dengan nomor asli.
- ✅ Token/API key diredaksi dari log.
- ✅ `npm test` hijau.

**Risiko utama:** scope creep. Jangan menambah downloader/AI di fase ini.

---

### Phase 2 — Grup, Guard, Media Dasar (P0/P1) ✅

**Tujuan:** fitur yang paling sering dipakai bot WhatsApp.

**Deliverables (selesai):**

- Grup: welcome, goodbye, promote, demote, kick, mute/unmute, tagall, hidetag, groupinfo, warn, warnings, unwarn.
- Guard: antilink, antispam, setwarnlimit, guardstatus, eskalasi warning → kick.
- Media: sticker (gambar → WebP), toimg (sticker → PNG).
- Downloader: ytmp3, ytmp4, tiktok memakai yt-dlp + FFmpeg, dengan allowlist host (anti-SSRF), batas ukuran/durasi, timeout, queue, dan cleanup file temporary.
- Database grup: settings, warnings, guard rules, plus migrasi skema v2 untuk ban.
- `.doctor` dasar diperluas: FFmpeg, sharp, yt-dlp, disk, session, DB, backup, tmp.
- Backup SQLite terverifikasi + restore in-place tanpa restart (`.backup`, `.restore`).
- `.ban` / `.unban` (pengguna & grup), `.stats`, middleware `banned`.
- i18n ID/EN lengkap untuk semua command Phase 2 + test penjaga drift key.
- Test: 159 hijau (grup, guard, media, downloader, backup, ban, locale, middleware, handler).

**Deviasi dari rencana awal:**

- Eskalasi guard memakai **warning → kick**, bukan warning → mute → kick. WhatsApp tidak menyediakan mute per anggota; lihat ADR-009. `.mute` tetap ada untuk menutup seluruh grup.
- Downloader memakai binary **yt-dlp** (bukan API pihak ketiga) supaya tidak ada API key dan tidak bergantung pada satu situs scraper; lihat ADR-010.

**Definition of done:**

- ✅ Semua command grup hanya bisa dipakai admin (kecuali owner).
- ✅ Guard tidak memicu false positive pada admin/owner.
- ✅ File temporary dibersihkan setelah konversi/download.
- ✅ Ada batas ukuran file, durasi, dan timeout.
- ⏳ `docker build` belum dijalankan di mesin dengan Docker (arsitektur image sudah disesuaikan: FFmpeg + yt-dlp + sharp).
- ✅ Backup bisa di-restore; prosedur dan verifikasi tercakup test.

---

### Phase 3 — AI & Media Suite (P1)

**Tujuan:** fitur bernilai tinggi yang membedakan Varr-Bot.

**Deliverables:**

- AI provider abstraction free-first: Gemini utama, Groq dan OpenRouter fallback.
- Key pool, timeout, retry, circuit breaker, fallback, budget guard.
- `.ai`, `.chatbot`, `.resetai`, `.summary`, `.translate`.
- Varr Memory: consent, TTL, hapus konteks.
- Media: tomp3, topdf, ocr, removebg, tts, qr, readqr, url.
- Downloader tambahan: ig, fb, x, threads, pinterest, spotify, soundcloud.
- Queue media + concurrency limit.
- Test provider dengan mock HTTP.

**Definition of done:**

- Provider gagal/rate limit → fallback bekerja.
- Tidak ada API key yang bocor ke log atau pesan error.
- Kuota AI per user/chat bekerja.
- Media berat tidak menghabiskan RAM (queue + limit).
- Semua command AI punya pesan error yang ramah.

---

### Phase 4 — Engagement & Automation (P1/P2)

**Tujuan:** retensi dan otomasi.

**Deliverables:**

- Economy: daily, balance, level, rank, leaderboard.
- Games: ttt, hangman, trivia.
- Automation: remind, poll, broadcast (rate-limited), autoread.
- Status: autostatus, statusreact, save (opt-in).
- `.schedule` dan `.autoreply` (opsional).
- Guard tambahan: antibadword, antitagall, antidelete (TTL), anticall.
- Locale ID/EN lengkap.

**Definition of done:**

- Broadcast punya kuota harian dan jeda.
- Anti-delete hanya menyimpan sesuai TTL dan bisa dimatikan.
- Game state tidak bocor antar grup.
- Semua fitur otomasi punya kill switch.

---

### Phase 5 — Scale & Integrasi (P2)

**Tujuan:** multi-session dan operasi skala besar.

**Deliverables:**

- Jadibot: session sendiri, QR/pairing, auto-reconnect, kuota.
- REST API + webhook.
- Web dashboard: login, session, logs, settings, plugin manager.
- Plugin store dengan allowlist dan checksum.
- Varr Insights: statistik command/grup/error.
- Metrics Prometheus.
- Backup terenkripsi.

**Definition of done:**

- Session user terisolasi; tidak bisa mengakses data session lain.
- API memakai autentikasi dan rate limit.
- Dashboard tidak menampilkan rahasia.
- Plugin dari URL divalidasi sebelum dijalankan.

---

### Phase 6 — Hardening & Release 1.0

**Deliverables:**

- Security review: SSRF, path traversal, command injection, secret handling.
- Load test: 100 grup aktif, 1000 command/hari (target internal).
- CI: lint + test + build Docker.
- Dokumentasi deployment lengkap.
- Changelog & semantic versioning.
- Audit lisensi dependency.
- Rilis `v1.0.0`.

**Definition of done:**

- Tidak ada temuan kritis/high.
- Crash-free session > 99% pada uji internal.
- Dokumentasi bisa diikuti dari nol oleh pengguna baru.
- Semua kredit referensi tercantum.

---

## 4. Prioritas Fitur per Fase

| Fase | Fokus | Contoh command |
|---|---|---|
| 1 | Fondasi | `.menu`, `.help`, `.ping`, `.alive`, `.mode` |
| 2 | Grup & media dasar | `.welcome`, `.kick`, `.antilink`, `.sticker`, `.ytmp3` |
| 3 | AI & media lanjutan | `.ai`, `.summary`, `.ocr`, `.ig` |
| 4 | Engagement | `.daily`, `.rank`, `.ttt`, `.remind`, `.broadcast` |
| 5 | Scale | `.jadibot`, API, dashboard |
| 6 | Stabilisasi | security, load test, rilis |

---

## 5. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Baileys API berubah | Bot rusak setelah update | Pin versi, adapter layer, test koneksi |
| Nomor diblokir WhatsApp | Bot tidak bisa dipakai | Nomor sekunder, rate limit, no spam, backoff |
| Sumber downloader berubah/break | Command gagal | Provider abstraction, fallback, pesan error jelas |
| Biaya AI membengkak | Tagihan tinggi | Budget guard, kuota, caching, default model murah |
| Media berat menghabiskan RAM | Proses OOM | Queue, limit ukuran, cleanup, ffmpeg-static |
| Kode GPL-3.0 tercampur | Masalah lisensi | Clean-room implementation, audit dependency |
| Data sensitif bocor | Masalah privasi | TTL, redaksi log, opt-in, enkripsi backup |
| SSRF/path traversal | Server compromise | Validasi URL, blokir IP internal, sanitasi filename |
| Plugin berbahaya | RCE | Allowlist, checksum, permission manifest, review |
| Scope creep | Project tidak selesai | Patuhi fase, tolak fitur di luar milestone |

---

## 6. Keputusan yang Sudah Ditetapkan

| Topik | Keputusan |
|---|---|
| Lisensi | **MIT** |
| Deployment | **Docker + Pterodactyl** |
| Database awal | **SQLite** (`data/varr.db`) |
| Database scale | MySQL/MariaDB panel Pterodactyl atau PostgreSQL terpisah |
| AI utama | **Gemini 4 Hydrogen** (free tier) |
| AI fallback | Gemini 3.8 Flash, Groq `gpt-oss-120b`, OpenRouter Nemotron 3 Ultra free |
| Vision | Gemini 4 Hydrogen, Gemma 4 31B free |
| STT | Groq Whisper large-v3 |
| Runtime | Node.js 22 LTS, CommonJS |

Detail alasan dan konsekuensi ada di [DECISIONS.md](DECISIONS.md).

**Default yang dipakai:**

1. **Bahasa** — Indonesia sebagai default; file `en.json` sudah disiapkan untuk ekspansi.
2. **Premium/limit** — ditunda sampai Phase 4 (economy & engagement).
3. **Jadibot** — Phase 5 (scale).
4. **Dashboard** — Phase 5, setelah API stabil.

---

## 7. Langkah Berikutnya

Phase 1 dan Phase 2 sudah selesai. Urutan berikutnya:

1. Jalankan sekali dengan nomor uji untuk memverifikasi QR/pairing, command grup, guard, dan downloader nyata (butuh nomor uji + yt-dlp).
2. Validasi `docker build` di mesin yang punya Docker.
3. Mulai **Phase 3**: AI multi-provider, Varr Memory, media lanjutan (tomp3, topdf, ocr, tts, qr), downloader tambahan (ig, fb, x, threads, pinterest, spotify).
4. Tambahkan test provider AI dengan mock HTTP dan budget guard.
