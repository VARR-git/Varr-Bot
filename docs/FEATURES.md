# Daftar Fitur Varr-Bot

Dokumen ini adalah **blueprint fitur**. Prioritas ditentukan agar pengembangan tidak melebar. Status implementasi per `v0.2.0` ada di bagian berikut.

## Status Implementasi

| Fase | Status | Isi |
|---|---|---|
| Phase 1 | ✅ | Fondasi: config, logger, registry, middleware, SQLite, QR/pairing, command dasar |
| Phase 2 | ✅ | Grup, guard, media dasar, downloader (yt/tiktok), backup/restore, ban, stats, doctor |
| Phase 3 | ⏳ | AI multi-provider, memory, media lanjutan, downloader tambahan |
| Phase 4 | ⏳ | Economy, games, automation, guard tambahan |
| Phase 5 | ⏳ | Jadibot, REST API, dashboard, plugin store |

Yang **sudah** tersedia: `.menu`, `.help`, `.ping`, `.alive`, `.owner`, `.mode`, `.maintenance`, `.welcome`, `.goodbye`, `.promote`, `.demote`, `.kick`, `.mute`, `.unmute`, `.tagall`, `.hidetag`, `.groupinfo`, `.warn`, `.warnings`, `.unwarn`, `.antilink`, `.antispam`, `.setwarnlimit`, `.guardstatus`, `.sticker`, `.toimg`, `.ytmp3`, `.ytmp4`, `.tiktok`, `.ban`, `.unban`, `.stats`, `.backup`, `.restore`, `.doctor`.

Yang belum: kategori AI, utility/search, economy & games, automation, dan downloader tambahan (IG/FB/X/Threads/Pinterest/Spotify). Item berprioritas P0/P1 lain di bawah tetap menjadi target fase berikutnya.

## Legenda Prioritas

| Kode | Arti |
|---|---|
| **P0** | Wajib untuk MVP/fondasi |
| **P1** | Fitur utama setelah MVP |
| **P2** | Lanjutan / opsional |
| **🔥** | Diferensiasi khas Varr-Bot |

Prefix default: `.` (dapat diubah). Semua command mendukung alias yang dideklarasikan di plugin.

---

## 1. Fondasi & Platform

| Fitur | Detail | Prioritas |
|---|---|---|
| Connection manager | QR, pairing code, reconnect dengan exponential backoff, graceful shutdown, watchdog session | P0 |
| Config loader | `.env` + validasi skema, default aman, pesan error yang jelas | P0 |
| Structured logger | Pino, level per modul, redaksi API key/token/nomor sensitif | P0 |
| Plugin registry | Manifest (`name`, `category`, `aliases`, `permissions`, `cooldown`, `run`) | P0 |
| Hot reload plugin | Reload satu plugin tanpa restart bot | P1 |
| Middleware pipeline | Normalisasi → prefix → alias → cooldown → rate limit → permission → maintenance → handler → error boundary | P0 |
| Role & permission | Owner, admin grup, premium, user; command mendeklarasikan role minimum | P0 |
| Cooldown & rate limit | Per user, per chat, per command; flood detection | P0 |
| Storage abstraction | SQLite default; driver MySQL/PostgreSQL untuk scale | P1 |
| Migrasi & seed data | Versi skema, migrasi otomatis, data default | P1 |
| i18n | Bahasa Indonesia & Inggris, bisa diatur per chat | P1 |
| Audit log | Catatan command sensitif: siapa, kapan, aksi apa, hasilnya | P1 |
| Varr Doctor 🔥 | Cek koneksi, session, database, API key, FFmpeg, disk, RAM, versi dependency | P1 |
| Varr Insights 🔥 | Statistik command, grup aktif, error rate, tanpa menyimpan isi pesan | P1 |
| Backup/restore | Backup database & konfigurasi; enkripsi opsional | P1 |
| Health endpoint | `/health` dan `/metrics` untuk monitoring | P2 |
| REST API | Endpoint untuk session, command, settings, webhook | P2 |
| Web dashboard | Login owner, QR/pairing, logs, settings, plugin manager | P2 |
| Plugin store | Install plugin dari URL dengan allowlist, checksum, dan review | P2 |
| Jadibot multi-session | Session terpisah dengan kuota CPU/RAM/command | P2 |

---

## 2. General & UX

| Command | Fungsi | Prioritas |
|---|---|---|
| `.menu` | Menu per kategori, bukan satu pesan raksasa | P0 |
| `.help <command>` | Detail command, usage, permission, contoh | P0 |
| `.ping` | Latensi bot dan koneksi | P0 |
| `.alive` | Status bot, versi, uptime | P0 |
| `.runtime` | Uptime, RAM, CPU, platform | P1 |
| `.owner` | Kontak owner | P0 |
| `.profile` | Profil user: level, XP, limit, status premium | P1 |
| `.afk [alasan]` | AFK dengan auto-reply saat disebut | P1 |
| `.report <pesan>` | Laporan bug/masalah ke owner | P1 |
| `.lang id/en` | Ganti bahasa chat | P1 |
| `.mode self/private/public` | Batasi siapa yang boleh memakai bot | P0 |
| `.prefix <chars>` | Ganti prefix (owner) | P1 |
| `.donate` | Informasi dukungan (opsional) | P2 |

---

## 3. Manajemen Grup

| Command | Fungsi | Prioritas |
|---|---|---|
| `.welcome on/off` | Sambutan anggota baru, template bisa diatur | P0 |
| `.goodbye on/off` | Pesan perpisahan | P0 |
| `.promote @user` | Jadikan admin | P0 |
| `.demote @user` | Cabut admin | P0 |
| `.kick @user` | Keluarkan anggota | P0 |
| `.add <nomor>` | Tambah anggota | P1 |
| `.mute` / `.unmute` | Tutup/buka grup | P0 |
| `.tagall [pesan]` | Tag semua anggota dengan jeda aman | P0 |
| `.hidetag [pesan]` | Tag tersembunyi | P0 |
| `.groupinfo` | Info grup, admin, jumlah anggota, deskripsi | P0 |
| `.link` | Ambil link undangan | P1 |
| `.revoke` / `.resetlink` | Reset link undangan | P1 |
| `.warn @user [alasan]` | Beri peringatan | P0 |
| `.warnings @user` | Lihat daftar peringatan | P0 |
| `.delwarn @user` | Hapus peringatan | P1 |
| `.topmembers` | Anggota paling aktif | P2 |
| `.staff` | Daftar admin grup | P1 |
| `.approve` / `.reject` | Setujui/tolak permintaan join | P2 |
| `.cleanup` | Deteksi anggota tidak aktif (dry-run dulu) | P2 |
| `.join <link>` / `.leave` | Owner masuk/keluar grup | P1 |

---

## 4. Varr Guard 🔥

Suite moderasi dengan **severity engine**, bukan sekadar tombol on/off.

| Command | Fungsi | Prioritas |
|---|---|---|
| `.antilink on/off` | Deteksi link; whitelist domain resmi | P0 |
| `.antispam on/off` | Deteksi flood, pesan duplikat, mention berlebihan | P0 |
| `.antibadword on/off` | Filter kata kasar dengan daftar yang bisa dikustomisasi | P1 |
| `.antitagall on/off` | Cegah tag semua anggota | P1 |
| `.antibot on/off` | Deteksi pesan yang mirip bot lain | P2 |
| `.anticall on/off` | Tolak panggilan dengan pesan sopan | P2 |
| `.antidelete on/off` | Tampilkan pesan yang dihapus (opt-in, TTL) | P1 |
| `.antiviewonce on/off` | Simpan view-once (opt-in, TTL) | P2 |
| `.setwarnlimit <n>` | Jumlah warning sebelum aksi otomatis | P0 |
| `.whitelist` / `.blacklist` | Kelola domain, nomor, atau kata | P1 |
| `.guardstatus` | Ringkasan aturan aktif di grup | P0 |
| `.guardlog` | Audit aksi moderasi terakhir | P1 |

**Alur eskalasi default:**

```text
pelanggaran ringan → warning
pelanggaran berulang → mute sementara (5–30 menit)
pelanggaran berat → kick
```

Semua aksi dapat dikonfigurasi per grup. Admin dan owner selalu dikecualikan (dengan audit log).

---

## 5. Downloader

| Command | Fungsi | Prioritas |
|---|---|---|
| `.yt <query>` | Cari video YouTube | P1 |
| `.ytmp3 <url>` | Audio YouTube | P0 |
| `.ytmp4 <url>` | Video YouTube | P0 |
| `.play <judul>` | Cari lalu kirim audio | P1 |
| `.tiktok <url>` | Video/foto TikTok tanpa watermark | P0 |
| `.ig <url>` | Foto/video/reel Instagram | P1 |
| `.fb <url>` | Video Facebook | P1 |
| `.x <url>` | Video/gambar X/Twitter | P1 |
| `.threads <url>` | Media Threads | P2 |
| `.pinterest <url>` | Gambar/video Pinterest | P2 |
| `.spotify <query>` | Info/lagu Spotify (sesuai API yang tersedia) | P2 |
| `.soundcloud <url>` | Audio SoundCloud | P2 |
| `.mediafire <url>` | Unduh file MediaFire | P2 |
| `.gdrive <url>` | Unduh file Google Drive publik | P2 |
| `.capcut <url>` | Template CapCut | P2 |
| `.autodl on/off` | Auto-download saat link dikirim | P2 |

**Aturan teknis:** batas ukuran file, timeout, queue, validasi URL, blokir SSRF ke alamat internal, dan cleanup file temporary.

---

## 6. Sticker & Media

| Command | Fungsi | Prioritas |
|---|---|---|
| `.sticker` | Gambar/video/GIF → sticker | P0 |
| `.scrop` | Sticker crop | P1 |
| `.smeme` | Sticker dengan teks atas/bawah | P1 |
| `.brat` | Sticker gaya brat | P1 |
| `.emojimix` | Gabung dua emoji | P2 |
| `.take` | Ubah nama pack & author sticker | P1 |
| `.setpack` | Atur nama pack default | P2 |
| `.toimg` | Sticker → gambar | P0 |
| `.tovideo` | Sticker animasi → video | P2 |
| `.attp` | Teks → sticker bergerak | P2 |
| `.tomp3` | Video/voice → MP3 | P1 |
| `.tovid` | Audio/gambar → video | P2 |
| `.topdf` | Gambar → PDF | P1 |
| `.ocr` | Gambar → teks | P1 |
| `.removebg` | Hapus background | P1 |
| `.remini` | Enhance/resize gambar | P2 |
| `.blur` | Blur gambar | P2 |
| `.meme` | Template meme | P2 |
| `.qr <teks>` | Generate QR | P1 |
| `.readqr` | Baca QR dari gambar | P1 |
| `.ss <url>` | Screenshot halaman web | P2 |
| `.tts <teks>` | Text-to-speech | P1 |
| `.voicemaker` | Ubah voice note (efek dasar) | P2 |
| `.audiofx <efek>` | Pitch, bass, low, reverse, speed | P2 |
| `.merge` | Gabung video/audio | P2 |
| `.trim` | Potong media | P2 |
| `.compress` | Kompres video | P2 |
| `.url` | Ambil URL media yang dikirim | P1 |

---

## 7. Varr AI 🔥

| Command | Fungsi | Prioritas |
|---|---|---|
| `.ai <prompt>` | Chat dengan AI | P1 |
| `.chatbot on/off` | Aktifkan chatbot di DM/grup | P1 |
| `.persona <nama>` | Ganti karakter/gaya jawaban | P2 |
| `.resetai` | Hapus konteks percakapan | P1 |
| `.imagine <prompt>` | Text-to-image | P2 |
| `.vision` | Analisis gambar yang di-reply | P2 |
| `.summary` | Ringkas teks/chat yang di-reply | P1 |
| `.translate <bahasa>` | Terjemahkan pesan | P1 |
| `.rewrite` | Perbaiki/gaya ulang teks | P2 |
| `.caption` | Buat caption media sosial | P2 |
| `.code` | Bantu jelaskan/debug kode | P2 |
| `.stt` | Transkrip voice note | P2 |

**Ketentuan:**

- Provider free-first: Gemini utama, Groq dan OpenRouter sebagai fallback (model ID disimpan di config).
- Key pool + fallback otomatis saat rate limit.
- **AI budget guard** 🔥: kuota token per user/chat, batas biaya harian, dan peringatan owner.
- **Varr Memory** 🔥: memori per chat dengan consent, TTL, dan command untuk menghapus.
- Mode grup: hanya merespons mention atau saat diaktifkan admin.
- Tidak menyimpan prompt/response secara default; hanya metadata penggunaan.

---

## 8. Utility & Search

| Command | Fungsi | Prioritas |
|---|---|---|
| `.weather <kota>` | Cuaca | P1 |
| `.news [topik]` | Berita terkini | P1 |
| `.wiki <query>` | Ringkasan Wikipedia | P1 |
| `.google <query>` | Hasil pencarian | P2 |
| `.image <query>` | Cari gambar | P2 |
| `.lyrics <judul>` | Lirik lagu | P1 |
| `.github <user/repo>` | Info repo GitHub | P2 |
| `.npm <package>` | Info package NPM | P2 |
| `.ip <address>` | Info IP | P2 |
| `.domain <domain>` | Info domain/WHOIS | P2 |
| `.kurs` | Kurs mata uang | P2 |
| `.convert <nilai> <dari> <ke>` | Konversi satuan | P2 |
| `.calc <ekspresi>` | Kalkulator aman (tanpa `eval`) | P1 |
| `.dict <kata>` | Kamus | P2 |
| `.quote` | Kutipan acak | P2 |
| `.shortlink <url>` | Perpendek URL | P2 |
| `.color <hex>` | Info warna/palette | P2 |
| `.time <zona>` | Waktu di zona tertentu | P2 |
| `.holiday` | Hari libur nasional | P2 |
| `.prayer <kota>` | Jadwal sholat (opsional) | P2 |
| `.random` | Angka/nama/pilihan acak | P2 |
| `.joke` / `.fact` | Hiburan ringan | P2 |
| `.reaction <jenis>` | Anime reaction GIF | P2 |

---

## 9. Economy, Level & Games

| Command | Fungsi | Prioritas |
|---|---|---|
| `.daily` | Reward harian | P1 |
| `.balance` | Cek saldo | P1 |
| `.bank` | Simpan/tarik uang | P2 |
| `.pay @user <jumlah>` | Transfer | P2 |
| `.shop` / `.buy` | Toko & pembelian item | P2 |
| `.inventory` | Inventori | P2 |
| `.level` / `.rank` | Level & rank user | P1 |
| `.leaderboard` | Peringkat chat/grup | P1 |
| `.battle` | RPG battle | P2 |
| `.pet` | Pet system | P2 |
| `.clan` | Clan system | P2 |
| `.tournament` | Turnamen | P2 |
| `.ttt` | Tic-tac-toe | P1 |
| `.hangman` | Hangman | P1 |
| `.trivia` | Trivia | P1 |
| `.truth` / `.dare` | Truth or dare | P2 |
| `.8ball` | Bola 8 | P2 |
| `.chess` | Catur | P2 |
| `.giveaway` | Giveaway dengan syarat | P2 |
| `.mysterybox` | Mystery box | P2 |

Ekonomi dan game memakai data yang sama dengan level/XP, tetapi dapat dimatikan per grup.

---

## 10. Automation

| Command | Fungsi | Prioritas |
|---|---|---|
| `.remind <waktu> <pesan>` | Reminder | P1 |
| `.schedule` | Pesan terjadwal | P2 |
| `.broadcast` | Broadcast ke user/grup dengan rate limit | P1 |
| `.autoreply` | Aturan balasan otomatis | P2 |
| `.autosticker` | Gambar otomatis jadi sticker | P2 |
| `.autoread` | Tandai semua pesan dibaca | P1 |
| `.autotyping` | Indikator mengetik | P2 |
| `.autostatus` | Lihat status otomatis | P2 |
| `.statusreact` | Reaksi otomatis ke status | P2 |
| `.autoreact` | Reaksi otomatis ke pesan tertentu | P2 |
| `.poll` | Buat poll | P1 |
| `.rss <url>` | Pantau RSS | P2 |
| `.digest` | Ringkasan berkala | P2 |
| `.filter` | Filter kata/auto-response | P2 |
| `.autoforward` | Forward otomatis (dengan allowlist) | P2 |
| `.save` | Simpan status yang di-reply | P2 |

**Batasan:** broadcast dan auto-forward hanya untuk owner/admin, dengan kuota harian dan jeda acak agar tidak dianggap spam.

---

## 11. Owner & System

| Command | Fungsi | Prioritas |
|---|---|---|
| `.ban` / `.unban` | Blokir user/grup dari bot | P0 |
| `.premium` | Kelola user premium | P1 |
| `.limit` | Lihat/atur kuota | P1 |
| `.plugin list/enable/disable` | Kelola plugin | P1 |
| `.reload <plugin>` | Hot reload | P1 |
| `.restart` | Restart aman | P1 |
| `.update` | Cek update (tanpa auto-pull berbahaya) | P2 |
| `.backup` / `.restore` | Backup/restore data | P1 |
| `.setname` | Ubah nama bot | P2 |
| `.setbio` | Ubah bio bot | P2 |
| `.setpp` | Ubah foto profil bot | P2 |
| `.join` / `.leave` | Kelola keanggotaan bot | P1 |
| `.bc` | Broadcast owner | P1 |
| `.stats` | Statistik bot | P1 |
| `.hit` | Hit command | P2 |
| `.audit` | Audit log | P1 |
| `.doctor` 🔥 | Diagnosa sistem | P1 |
| `.mode` | Self/private/public | P0 |
| `.prefix` | Ganti prefix | P1 |
| `.lang` | Ganti bahasa | P1 |
| `.session` | Lihat/revoke session | P2 |
| `.apikey` | Set/test/rotate API key (masked) | P2 |

---

## 12. Scale & Integrasi (Fase Lanjut)

| Fitur | Detail | Prioritas |
|---|---|---|
| Jadibot | User membuat session bot sendiri dengan QR/pairing | P2 |
| Kuota jadibot | Batas command, RAM, dan durasi per session | P2 |
| Auto-reconnect jadibot | Reconnect terkontrol + notifikasi owner | P2 |
| REST API | `/api/sessions`, `/api/messages`, `/api/settings`, `/webhook` | P2 |
| Web dashboard | Monitoring, logs, settings, plugin manager | P2 |
| Webhook | Event `message.received`, `command.executed`, `session.status` | P2 |
| Prometheus metrics | Counter, gauge, histogram | P2 |
| Plugin store | Katalog plugin dengan versi & checksum | P2 |
| Backup terenkripsi | Backup ke storage eksternal | P2 |
| Multi-tenant | Pemisahan data per session | P2 |

---

## 13. Fitur Orisinal Varr-Bot 🔥

Ini yang membedakan Varr-Bot dari referensi:

| Fitur | Masalah yang diselesaikan | Cara kerja |
|---|---|---|
| **Varr Doctor** | Sulit tahu kenapa bot error | Cek session, DB, API key, FFmpeg, disk, RAM, dependency; beri rekomendasi |
| **Varr Guard** | Anti-feature biasanya cuma on/off | Rule engine dengan severity, warning bertingkat, audit log |
| **Varr Memory** | Chatbot lupa konteks atau menyimpan terlalu banyak | Memori per chat, consent, TTL, command hapus |
| **Varr Insights** | Owner tidak tahu fitur mana yang dipakai | Statistik command/grup/error tanpa menyimpan isi pesan |
| **Varr SafeMode** | Command berbahaya bisa salah eksekusi | Dry-run, konfirmasi ganda, allowlist owner |
| **Varr Sessions** | Jadibot sulit dikelola | Kuota, status, auto-reconnect, audit per session |
| **Plugin manifest** | Plugin liar tanpa kontrol | Permission, cooldown, alias, versi, dependency check |
| **AI budget guard** | Biaya API membengkak | Kuota token, batas harian, fallback provider |
| **Privacy-first retention** | Data sensitif tersimpan selamanya | TTL, opt-in, redaksi log, retention policy |
| **Bilingual** | Banyak bot hanya satu bahasa | ID/EN per chat, mudah tambah bahasa |
| **Deployment presets** | Setup ribet di tiap platform | Docker, PM2, Windows, Termux, Railway/Render |
| **Encrypted backup** | Backup berisi data sensitif | Enkripsi sebelum disimpan |

---

## 14. Non-Goals

Varr-Bot **tidak** akan menyediakan:

- `eval`/remote code execution dari chat.
- Mass add, mass tag tanpa jeda, atau spam broadcast.
- Auto-report, auto-kick-all, atau sabotase grup.
- Bypass DRM/proteksi platform.
- Penyimpanan isi pesan tanpa batas.
- Clone script yang menghapus kredit author.
- Fitur yang melanggar hukum atau ToS WhatsApp.

---

## 15. Cakupan MVP (P0)

MVP pertama berisi sekitar 30 command:

- Core: config, logger, plugin registry, middleware, permission, cooldown, SQLite.
- General: `.menu`, `.help`, `.ping`, `.alive`, `.owner`, `.mode`.
- Group: welcome, goodbye, promote, demote, kick, mute/unmute, tagall, hidetag, groupinfo, warn, warnings.
- Guard: antilink, antispam, setwarnlimit, guardstatus.
- Media: sticker, toimg.
- Downloader: ytmp3, ytmp4, tiktok.
- Owner: ban/unban, doctor (versi dasar), stats.

Target kualitas MVP:

- Tidak ada API key di source code.
- Tidak ada `eval`.
- Command error tidak mematikan bot.
- Cooldown dan permission bekerja.
- Data tersimpan dan bisa di-backup.
- Log tidak membocorkan token/nomor sensitif.
- Dokumentasi command tersedia di `.help`.
