# Riset Referensi Bot WhatsApp untuk Varr-Bot

**Tanggal riset:** 15 November 2026  
**Status:** Selesai untuk fase blueprint  
**Tujuan:** Menemukan bot WhatsApp open source dengan fitur banyak dan bermanfaat, mengevaluasi arsitekturnya, lalu merumuskan fitur Varr-Bot tanpa menyalin kode secara mentah.

---

## 1. Metodologi

Riset dilakukan dengan:

1. Mencari repo WhatsApp bot populer di GitHub berdasarkan bintang, fork, dan aktivitas update.
2. Membaca README, daftar command/plugin, struktur folder, serta metadata lisensi.
3. Membandingkan cakupan fitur dan pola arsitektur.
4. Memisahkan mana yang layak **diadopsi sebagai ide** dan mana yang **tidak boleh/tidak perlu** diambil.
5. Menurunkan hasilnya menjadi daftar fitur dan roadmap Varr-Bot.

Catatan: jumlah bintang berubah setiap waktu. Angka di bawah adalah snapshot saat riset.

---

## 2. Ringkasan Eksekutif

Tidak ada satu bot pun yang sempurna. Pola yang paling kuat justru muncul saat beberapa pendekatan digabung:

- **BotsApp** — modul command yang rapi dan berorientasi asisten pribadi.
- **Knightbot-MD** — suite moderasi grup yang lengkap dan praktis.
- **neoxr-bot** — arsitektur produksi: database abstraction, limit, cooldown, premium, plugin ESM.
- **Iris** — kategori command yang jelas, ekonomi/game, dokumentasi, dan web/API.
- **Atlas-MD** — AI multi-provider dengan key pool, plugin store, dan deployment yang matang.
- **WhatsAsena** — variasi converter media/audio yang sangat luas.
- **games-wabot** — ekonomi, RPG, dan CLI flags yang berguna untuk operasional.
- **SUBZERO-MD / STAR-XD** — otomasi status, reaction, call rejecter, dan broadcast.

**Keputusan untuk Varr-Bot:** gunakan Baileys sebagai inti, buat arsitektur plugin + middleware sendiri, adopsi ide fitur di atas, lalu bedakan diri lewat keamanan, privasi, observability, dan kualitas kode.

---

## 3. Referensi Utama

| Repo | Stack | ★ | Fork | Lisensi | Kekuatan utama | Pelajaran untuk Varr-Bot |
|---|---|---:|---:|---|---|---|
| [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys) | TypeScript | 11.6k | 3.5k | MIT | Library inti WhatsApp Multi-Device, pairing code, media, event | Fondasi koneksi; bungkus dengan adapter agar mudah upgrade |
| [Prince-Mendiratta/BotsApp](https://github.com/Prince-Mendiratta/BotsApp) | TypeScript | 5.5k | 1.3k | GPL-3.0 | Asisten pribadi; modul command rapi; downloader, OCR, QR, TTS, cuaca, berita | Struktur modul, metadata command, UX help |
| [mruniquehacker/Knightbot-MD](https://github.com/mruniquehacker/Knightbot-MD) | JavaScript | 8.2k | 21k | Tidak terdeteksi* | Manajemen grup + anti-link, anti-badword, anti-delete, anti-call, warn | Suite moderasi grup dan penamaan command yang jelas |
| [neoxr/neoxr-bot](https://github.com/neoxr/neoxr-bot) | JavaScript (ESM) | 326 | 456 | MIT (base) | Arsitektur produksi; DB abstraction; limit/cooldown; premium; 700+ command di versi premium | Layer database, limit, cooldown, plugin ESM, statistik |
| [KillovSky/Iris](https://github.com/KillovSky/Iris) | JavaScript | 213 | 173 | MIT | Kategori command, bank/ekonomi, giveaway, web/API, dokumentasi | Struktur kategori, ekonomi, integrasi HTTP |
| [FantoX/Atlas-MD](https://github.com/FantoX/Atlas-MD) | JavaScript | 234 | 948 | MIT | Triple AI + key pool, 20 karakter, 26 anime reaction, plugin store, MongoDB | AI fallback, plugin store, mode self/private/public |
| [lyfe00011/whatsapp-bot](https://github.com/lyfe00011/whatsapp-bot) | JavaScript | 1.2k | 5.7k | Tidak terdeteksi* | Userbot berbasis WhatsAsena; converter audio/video/OCR/QR sangat banyak | Variasi media converter dan pengalaman plugin |
| [BochilGaming/games-wabot](https://github.com/BochilGaming/games-wabot) | JavaScript | 239 | 508 | GPL-3.0 | RPG, ekonomi, game, CLI flags, plugin system | CLI flags, konsep ekonomi/RPG, pemisahan plugin |
| [mrfrankofcc/SUBZERO-MD](https://github.com/mrfrankofcc/SUBZERO-MD) | JavaScript | 788 | 2.3k | Tidak terdeteksi* | AI, downloader, antidelete, view-once, status reaction, call rejecter, poll | Otomasi status dan fitur "quality of life" |
| [mrxdking/star-xd](https://github.com/mrxdking/star-xd) | JavaScript | 632 | 1.4k | Tidak terdeteksi* | AI, media tools, group management, save status, auto-react, broadcast | Kombinasi fitur dan deployment multi-platform |

\* GitHub tidak mendeteksi file lisensi standar. Jangan menyalin kode sebelum memeriksa lisensi di repo aslinya.

### Referensi stack alternatif

| Repo | ★ | Lisensi | Relevansi |
|---|---:|---|---|
| [wwebjs/whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js) | 22.9k | Apache-2.0 | Client berbasis Puppeteer/Chromium; ekosistem besar, tapi lebih berat |
| [wppconnect-team/wppconnect](https://github.com/wppconnect-team/wppconnect) | 3.5k | Tidak terdeteksi* | Otomasi TypeScript, multi-session |
| [open-wa/wa-automate-nodejs](https://github.com/open-wa/wa-automate-nodejs) | 3.7k | Tidak terdeteksi* | Framework otomasi dengan API yang ramah |
| [evolution-foundation/evolution-api](https://github.com/evolution-foundation/evolution-api) | 10.1k | Tidak terdeteksi* | REST API gateway multi-session; referensi arsitektur API |
| [devlikeapro/waha](https://github.com/devlikeapro/waha) | 7.8k | Apache-2.0 | HTTP API multi-engine; referensi dashboard & session management |
| [codigoencasa/builderbot](https://github.com/codigoencasa/builderbot) | 3.0k | MIT | Builder alur chatbot; referensi future no-code flow |

**Kenapa Baileys, bukan Puppeteer?** Baileys lebih ringan, tidak butuh Chromium, cocok untuk VPS kecil dan Termux, serta lebih dekat ke protokol WhatsApp Multi-Device. Konsekuensinya: library tidak resmi, API bisa berubah, dan risiko pembatasan nomor tetap ada. Varr-Bot akan mengunci versi Baileys dan membungkusnya di lapisan adapter.

---

## 4. Detail Referensi dan Fitur yang Diadopsi

### 4.1 BotsApp

BotsApp adalah userbot TypeScript dengan modul per command. Fitur yang terlihat dari struktur `modules/`: `yt`, `song`, `lyrics`, `news`, `weather`, `translate`, `tts`, `ocr`, `qr`, `sticker`, `github`, `group management`, `quote`, `carbon`, dan lain-lain.

**Yang diadopsi:**

- Satu file per command/modul dengan metadata yang jelas.
- Pemisahan command publik, admin grup, dan owner.
- Fitur produktivitas: OCR, QR, TTS, terjemahan, cuaca, berita, lyrics.
- Alur help yang ramah pengguna.

**Catatan lisensi:** GPL-3.0. Varr-Bot **tidak** akan menyalin kode BotsApp. Jika suatu saat ingin memakai kode GPL-3.0, seluruh project Varr-Bot harus memakai lisensi yang kompatibel.

### 4.2 Knightbot-MD

Fokus pada manajemen grup. Dari daftar command terlihat suite anti yang lengkap: `antilink`, `antibadword`, `antibot`, `anticall`, `antidelete`, `antitag`, `autoread`, `autostatus`, `autotyping`, `welcome`, `goodbye`, `warn`, `mute`, `kick`, `promote`, `demote`, `hidetag`, `tagall`, `groupinfo`, `resetlink`, serta game dan tool media.

**Yang diadopsi:**

- Konsep suite keamanan grup yang saling melengkapi.
- Warning bertingkat sebelum kick.
- Command admin yang mudah dipahami.
- Fitur "view once" dan "save status" sebagai quality-of-life.

**Yang diperbaiki Varr-Bot:** anti-feature tidak lagi sekadar boolean. Varr-Bot akan memakai **severity engine** (low/medium/high) dengan aksi otomatis: peringatan → mute sementara → kick, plus audit log.

### 4.3 neoxr-bot

Repo base MIT, dengan versi premium 5.1 yang menawarkan 700+ command, RPG, leveling, captcha/email verification, scheduler, store plugin, jadibot hosting, dan cloud database.

**Yang diadopsi:**

- **Database abstraction**: JSON lokal untuk development, MongoDB/PostgreSQL/MySQL/Redis untuk produksi.
- **Limit & cooldown** per user, plus konsep premium.
- **Plugin ESM** dan pemisahan `plugins/_events`, `plugins/admin`, `plugins/download`, `plugins/group`, `plugins/owner`, `plugins/userinfo`.
- **Statistik**: hit command, runtime, server info.
- **Scheduler** untuk pesan terjadwal dan reminder.

**Yang tidak diadopsi:** kompleksitas monetisasi/premium berlapis sejak awal. Varr-Bot akan menyiapkan hook limit/premium, tetapi fitur dasar tetap terbuka.

### 4.4 Iris

Iris sangat modular: `Commands/Bank`, `Chat`, `Games`, `Giveaway`, `Level`, `Manager`, `Ranking`, `Shopping`, `Stickers`, `YouTube`, dan seterusnya. Ada web/API `Indexer` untuk integrasi eksternal.

**Yang diadopsi:**

- Kategori command yang konsisten (`general`, `group`, `downloader`, `media`, `ai`, `tools`, `games`, `economy`, `owner`).
- Ekonomi ringan: bank, level, ranking, giveaway.
- Dokumentasi sebagai bagian dari produk.
- Gagasan dashboard/API untuk fase lanjut.

### 4.5 Atlas-MD

Repo ini paling padat fitur modern: triple AI (ChatGPT, Claude, Gemini) dengan key pool, grup chatbot + DM chatbot, 20 karakter bot, 26 anime reaction, universal downloader, sticker toolkit, media converter, search engine, live plugin store, MongoDB, `ffmpeg-static`, dan mode self/private/public.

**Yang diadopsi:**

- **AI provider abstraction** dengan key pool dan fallback saat rate limit.
- **Plugin store** dari URL (nanti dibuat dengan allowlist dan validasi).
- **Mode bot** self/private/public.
- **Anti-delete cache dengan TTL** — bukan menyimpan selamanya.
- **ffmpeg-static** agar tidak perlu install FFmpeg manual.
- **Karakter/persona** sebagai fitur opsional, bukan default yang mengganggu.

### 4.6 WhatsAsena / lyfe00011

Userbot plugin-based dengan variasi converter yang sangat luas: audio effects (pitch, bass, low, reverse, voice), merge video, trim, compress, OCR, remove background, screenshot web, QR, PDF, dan downloader multi-platform.

**Yang diadopsi:**

- Breadth converter media sebagai inspirasi kategori `media`.
- Plugin sebagai unit distribusi fitur.
- Command `alive`, `ping`, `whois`, `afk` sebagai kebutuhan dasar userbot.

**Yang diperbaiki:** Varr-Bot membatasi konversi berat dengan queue dan batas ukuran file agar RAM tidak habis.

### 4.7 games-wabot

Fokus RPG/ekonomi/game. Menyediakan flags operasional seperti `--self`, `--pconly`, `--gconly`, `--swonly`, `--prefix`, `--autoread`, `--restrict`, `--nyimak`.

**Yang diadopsi:**

- CLI flags untuk mode operasi dan debugging.
- Konsep RPG: battle, pet, clan, tournament, inventory, shop.
- Pemisahan plugin game dari command inti.

**Catatan lisensi:** GPL-3.0. Hanya ide, bukan kode.

### 4.8 SUBZERO-MD dan STAR-XD

Keduanya menonjolkan fitur "kehidupan sehari-hari" di WhatsApp: save status, status reply, status react, auto-react, call rejecter, antidelete, view-once, poll, broadcast, AI, dan downloader.

**Yang diadopsi:**

- Otomasi status dan reaction sebagai fitur opsional.
- Call rejecter dengan pesan sopan.
- Poll dan broadcast yang dibatasi rate limit.
- Save status dengan consent dan pembersihan berkala.

---

## 5. Matriks Cakupan Fitur

Legenda: **✓** tersedia, **~** terbatas/sebagian, **–** tidak ada.

| Referensi | Grup | Anti-abuse | Downloader | Sticker/Media | AI | Game/Ekonomi | Automation | DB/Scale |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| BotsApp | ✓ | – | ✓ | ✓ | – | – | ~ | ✓ |
| Knightbot-MD | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ |
| neoxr-bot | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Iris | ✓ | ~ | ✓ | ✓ | ~ | ✓ | ✓ | ✓ |
| Atlas-MD | ✓ | ~ | ✓ | ✓ | ✓ | – | ✓ | ✓ |
| WhatsAsena | ✓ | ~ | ✓ | ✓ | ~ | – | ~ | – |
| games-wabot | ~ | ~ | ✓ | ✓ | – | ✓ | ~ | ✓ |
| SUBZERO-MD | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ~ |
| STAR-XD | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ~ |

**Kesimpulan matriks:** tidak ada referensi yang unggul di semua kolom. Varr-Bot akan menggabungkan kekuatan tiap repo, tetapi dengan arsitektur dan standar kualitas sendiri.

---

## 6. Pola Arsitektur yang Diadopsi

| Pola | Inspirasi | Rencana implementasi di Varr-Bot |
|---|---|---|
| Plugin registry + manifest | BotsApp, neoxr, games-wabot, Iris | Setiap plugin mengekspor `name`, `category`, `aliases`, `permissions`, `cooldown`, `run` |
| Middleware pipeline | Atlas, BotsApp | Normalisasi → prefix/alias → cooldown → rate limit → permission → maintenance → handler → error boundary |
| Role hierarchy | Atlas, neoxr | `owner > admin grup > premium > user`; command mendeklarasikan role minimum |
| Database abstraction | neoxr, Iris | Interface `users`, `groups`, `settings`, `sessions`, `stats`; driver JSON/Mongo/Postgres |
| AI provider abstraction | Atlas | Adapter OpenAI/Gemini/Claude/DeepSeek/OpenRouter, key pool, timeout, fallback, budget |
| Guard suite | Knightbot, SUBZERO, STAR-XD | Rule engine dengan severity dan aksi berjenjang + audit log |
| Converter/media service | WhatsAsena, BotsApp | Queue, limit ukuran, cleanup file temporary, FFmpeg static |
| CLI flags | games-wabot | `--self`, `--pconly`, `--gconly`, `--prefix`, `--debug`, `--dry-run` |
| Web/API | Iris, WAHA, Evolution API | REST API + dashboard di fase lanjut, bukan inti |
| Plugin store | Atlas | Install dari URL dengan allowlist, signature/checksum, dan review manual |
| Session health | SUBZERO, Baileys community | Watchdog, exponential backoff, graceful shutdown, reconnect terkontrol |

---

## 7. Yang Tidak Diadopsi

Ini sama pentingnya dengan yang diadopsi:

1. **Copy-paste kode mentah**, terutama dari repo GPL-3.0 tanpa mengubah lisensi project.
2. **`eval` / remote code execution** untuk command owner. Varr-Bot tidak akan menyediakan `eval` yang bisa dieksekusi dari chat.
3. **API key hardcoded** di source code. Semua rahasia lewat `.env`.
4. **Mass tagging, mass messaging, dan spam broadcast tanpa batas** yang mempercepat banned.
5. **Fitur "auto report", "auto kick all", atau sabotase grup.**
6. **Scraping yang membutuhkan bypass proteksi/DRM.**
7. **Penyimpanan isi pesan tanpa batas** untuk anti-delete. Varr-Bot memakai TTL dan opt-in.
8. **Clone script yang menghapus kredit author.**
9. **Clone 700+ command tanpa kurasi.** Lebih baik 60 command yang benar-benar dipakai dan dirawat.
10. **Dependency yang tidak jelas asal-usulnya** atau package yang sudah tidak dimaintain.

---

## 8. Lisensi dan Etika

| Repo | Lisensi | Boleh menyalin kode? |
|---|---|---|
| Baileys | MIT | Boleh, sertakan copyright notice |
| BotsApp | GPL-3.0 | Boleh hanya jika Varr-Bot memakai GPL-3.0 yang kompatibel |
| games-wabot | GPL-3.0 | Sama seperti BotsApp |
| neoxr-bot (base) | MIT | Boleh, sertakan notice |
| Iris | MIT | Boleh, sertakan notice |
| Atlas-MD | MIT | Boleh, sertakan notice |
| Knightbot-MD | Tidak terdeteksi | Periksa repo; jangan asumsikan bebas |
| WhatsAsena/lyfe | Tidak terdeteksi | Periksa repo; jangan asumsikan bebas |
| SUBZERO / STAR-XD | Tidak terdeteksi | Periksa repo; jangan asumsikan bebas |

**Kebijakan Varr-Bot:**

- Implementasi ulang secara original berdasarkan ide, bukan copy-paste.
- Jika mengambil potongan kode MIT, simpan copyright notice di `NOTICE`/header file.
- Jika ingin memakai kode GPL-3.0, keputusan lisensi harus dibicarakan dulu karena akan memengaruhi seluruh project.
- Cantumkan kredit referensi di README dan dokumentasi.
- Jangan menghapus watermark/kredit author dari repo mana pun.

**Risiko WhatsApp:** semua bot berbasis WhatsApp Web tidak resmi. Pelanggaran ToS dapat menyebabkan nomor diblokir. Mitigasi: nomor sekunder, rate limit, tidak spam, tidak mass-add, dan tidak mengirim pesan ke nomor yang tidak dikenal.

---

## 9. Kesimpulan

Varr-Bot tidak perlu menjadi bot dengan command terbanyak. Target yang lebih realistis dan bernilai:

1. **Kualitas > kuantitas** — 60–100 command inti yang stabil, terdokumentasi, dan aman.
2. **Arsitektur yang bisa tumbuh** — plugin + middleware + database abstraction.
3. **Diferensiasi** — Varr Doctor, Varr Guard, Varr Memory, Varr Insights, Varr SafeMode, dan AI budget guard.
4. **Privasi & keamanan** — retensi terbatas, permission berlapis, tanpa `eval`, audit log.
5. **Dokumentasi** — command, konfigurasi, deployment, dan kontribusi.

Blueprint fitur lengkap ada di [FEATURES.md](FEATURES.md), sedangkan tahapan implementasi ada di [ROADMAP.md](ROADMAP.md).
