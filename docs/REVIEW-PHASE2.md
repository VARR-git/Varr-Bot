# Review Phase 2 — Varr-Bot

Dokumen audit internal untuk Phase 2: apa yang dibangun, kenapa begitu, dan di mana risikonya. Status: **Phase 2 selesai** (`v0.2.0`), **142 test hijau**.

---

## 1. Ringkasan yang Selesai

Phase 2 awalnya terlihat "tinggal command", tetapi audit menemukan empat hal yang membuat command yang sudah ada belum bisa dipakai:

1. **i18n belum lengkap** — 83+ key untuk grup, guard, media, doctor, dan event grup belum ada di `id.json`/`en.json`. Pengguna akan melihat teks mentah seperti `group.targetMissing`.
2. **Belum ada downloader** — `ytmp3`, `ytmp4`, `tiktok` belum ada sama sekali.
3. **Backup belum bisa diverifikasi/dipulihkan** — hanya ada pembuatan file backup.
4. **Belum ada ban/unban/stats** dan penegakan ban, padahal `groups.is_banned` sudah ada sejak skema v1 (kolom mati).

Selain itu `tests/registry.test.js` masih mengunci jumlah command ke 7 sehingga suite tidak hijau dengan 27 command.

Yang dikerjakan di Phase 2:

| Area | Hasil |
|---|---|
| i18n | `id.json` + `en.json` lengkap (305 key), test penjaga drift key |
| Grup | 14 command + service welcome/goodbye + target resolver LID/PN |
| Guard | antilink, antispam, setwarnlimit, guardstatus, eskalasi warning → kick |
| Media | sticker (gambar → WebP), toimg (sticker → PNG) |
| Downloader | `src/services/downloader.js` (yt-dlp), `.ytmp3`, `.ytmp4`, `.tiktok` |
| Backup | verifikasi integritas, daftar, restore in-place, backup pengaman |
| Owner | `.ban`, `.unban`, `.stats`, middleware `banned` |
| Doctor | cek FFmpeg, sharp, yt-dlp, backup, tmp |
| Database | migrasi **v2** (ban), helper statistik, API backup/restore |
| Test | 70 → **142** |

---

## 2. Alur Satu Pesan (v0.2.0)

```text
Baileys messages.upsert (type = notify)
  │
  ├─ core/handler.js
  │    ├─ tolak: fromMe, status, broadcast, newsletter, reaksi, pesan sistem
  │    ├─ dedup msg.key.id (LRU 1000)
  │    ├─ unwrap + extractText
  │    │
  │    ├─ services/guard.enforce  ← berjalan untuk pesan biasa juga
  │    │    ├─ grup? antilink/antispam aktif?
  │    │    ├─ admin/owner dikecualikan
  │    │    ├─ aksi delete/warn/kick + audit
  │    │    └─ handled? berhenti di sini
  │    │
  │    ├─ parseCommand (harus prefix)
  │    └─ queue per chat
  │         └─ middleware:
  │              normalize → banned → maintenance → mode → permission →
  │              scope → cooldown → rateLimit
  │
  ├─ command.execute(ctx) (timeout 30 detik)
  └─ reply / error boundary / statistik
```

Perbedaan penting dari Phase 1: guard berjalan **sebelum** parsing command, dan `banned` berjalan sebelum `maintenance` agar pengguna/grup yang diblokir tidak bisa memakai command darurat sekalipun.

---

## 3. Peta Modul Baru

| File | Tanggung jawab |
|---|---|
| `src/commands/group/*` | 14 command grup; validasi target lewat `utils/groupTarget` + `utils/groupModeration` |
| `src/commands/guard/*` | Saklar & status guard |
| `src/commands/media/*` | sticker, toimg |
| `src/commands/downloader/*` | ytmp3, ytmp4, tiktok; helper di `_shared.js` (dilewati loader) |
| `src/commands/owner/ban.js` | Ban pengguna/grup, proteksi owner & bot |
| `src/commands/owner/stats.js` | Statistik tanpa isi pesan |
| `src/commands/owner/backup.js` | Buat/list/verify backup |
| `src/commands/owner/restore.js` | Restore dengan konfirmasi + backup pengaman |
| `src/commands/tools/doctor.js` | Diagnosa sistem (diperluas) |
| `src/services/guard.js` | Deteksi tautan/spam, aksi delete/warn/kick |
| `src/services/warnings.js` | Warning + eskalasi kick |
| `src/services/groupEvents.js` | Welcome/goodbye |
| `src/services/media.js` | Download media, konversi sharp |
| `src/services/downloader.js` | Adapter yt-dlp, validasi URL, limit, queue, cleanup |
| `src/core/middleware/banned.js` | Penegakan ban |
| `src/utils/groupTarget.js` | Resolusi target dari mention/reply/nomor, proteksi target |
| `src/utils/groupModeration.js` | Aturan bersama command moderasi |
| `src/utils/groupMessages.js` | Logika bersama welcome/goodbye |
| `src/utils/guardSettings.js` | Logika bersama antilink/antispam |
| `src/utils/ban.js` | Resolusi target ban |
| `src/utils/backups.js` | Format hasil backup/restore |
| `tests/helpers/bot.js` | Bot + socket palsu untuk test integrasi |

---

## 4. Keputusan Desain & Trade-off

| Keputusan | Alasan | Trade-off yang diterima |
|---|---|---|
| Guard dijalankan untuk semua pesan teks | Pesan biasa tanpa prefix juga perlu dimoderasi | Satu query setting per pesan grup (murah, SQLite) |
| Guard butuh bot admin | Tanpa hak admin, bot tidak bisa menghapus/mengeluarkan | Grup tanpa bot admin hanya mendapat log debug |
| Eskalasi warning → kick (ADR-009) | WhatsApp tidak punya mute per anggota | Tidak ada "mute sementara" per orang |
| Downloader memakai yt-dlp (ADR-010) | Tidak ada API key, tahan perubahan situs | Deployment butuh binary eksternal + FFmpeg |
| Allowlist host downloader | Mitigasi SSRF tanpa DNS resolution sendiri | Link di luar daftar ditolak (termasuk shortener) |
| Judul file downloader disanitasi | Cegah path traversal & nama aneh | Karakter non-ASCII hilang dari nama file |
| Backup diverifikasi read-only | Menangkap file rusak sebelum dipakai | Biaya buka koneksi kedua saat backup |
| Restore in-place via ATTACH | Bisa dari dalam command tanpa restart | Hanya antar-skema sama; runtime state harus restart |
| Ban per varian JID | Cegah bypass lewat LID/PN | Bisa memblokir dua entri sekaligus |
| Grup ter-ban dibalas diam | Menghindari spam balasan | Pengguna grup tidak tahu kenapa bot diam |
| `now` diinjeksi di test | Test deterministik tanpa sleep | Sedikit kode ekstra di service |

---

## 5. Model Keamanan Tambahan

| Ancaman | Mitigasi | Sisa risiko |
|---|---|---|
| SSRF dari link chat | Skema http/https, tanpa userinfo, port 80/443, allowlist host, tolak IP literal/localhost/.local | Redirect internal di sisi yt-dlp di luar kendali (host tetap harus allowlist) |
| Command injection | `spawn` dengan argumen array, tanpa shell | — |
| Path traversal nama file | `safeFileName` menghapus `..`, `/`, karakter non-aman | — |
| Path traversal restore | Nama backup dicocokkan ke hasil `listBackups`, bukan digabung manual | — |
| File sementara menumpuk | Cleanup per unduhan + prune file > 6 jam | Proses mati saat menulis bisa menyisakan file sampai prune berikutnya |
| Disk penuh karena download | `DOWNLOAD_MAX_MB`, `--max-filesize`, batas durasi, cek ukuran setelah unduh | — |
| Ban diakali lewat LID | Ban diterapkan ke semua varian JID target | Akun LID-only yang belum terpetakan tetap tidak terdeteksi |
| Backup memblokir event loop | Backup async bawaan SQLite; restore disarankan saat sepi | Restore besar bisa memblokir singkat (sinkron) |
| Restore data berbahaya | Butuh konfirmasi `confirm`, backup pengaman otomatis, audit | Owner tetap bisa memulihkan data lama yang tidak diinginkan |
| URL pengguna bocor di log | Log downloader hanya host/kode error, bukan URL | — |

### Catatan Baileys: host `a.whatsapp.net`

Baileys `7.0.0-rc13` menyusun ulang URL unduhan dari `directPath`, tetapi memakai host dari field `url`:

```js
const fallbackHost = opts.host ?? extractHost(url);
const downloadUrl = directPath ? getUrlFromDirectPath(directPath, fallbackHost) : url;
```

Sebagian pesan — terutama **sticker yang dikirim dari WhatsApp Web/Desktop** — membawa `url` dengan host usang `a.whatsapp.net`, sehingga download gagal:

```text
TypeError: fetch failed
caused by: Error: getaddrinfo ENOTFOUND a.whatsapp.net
```

Perbaikan yang dipakai: `services/media.js` mengirim `{ host: DEF_MEDIA_HOST }` (`mmg.whatsapp.net`) pada setiap `downloadMediaMessage`, sehingga download dari `directPath` selalu memakai host media resmi. Ini juga cara yang diambil perbaikan upstream ([WhiskeySockets/Baileys#2778](https://github.com/WhiskeySockets/Baileys/pull/2778)). Regresi dijaga oleh test `media: download memakai host media default, bukan host usang dari url`.

---

## 6. Skema Database (v2)

| Tabel | Perubahan |
|---|---|
| `users` | + `is_banned`, `ban_reason`, `banned_at` (migrasi v2) |
| `groups` | + `ban_reason`, `banned_at` (kolom `is_banned` sudah ada di v1) |
| `settings`, `group_settings`, `warnings`, `stats`, `audit_logs` | tidak berubah |
| `migrations` | version 2 = `ban-control` |

- Migrasi memakai `user_version`; DB yang lebih baru dari kode menolak startup dengan pesan jelas.
- Restore memulihkan tabel data (bukan `migrations`) dan hanya menerima skema yang sama.
- Backup memakai nama `varr-YYYY-MM-DD_HH-MM-SS-mmm.db`; penjaga suffix mencegah tabrakan nama.
- Retensi default 14 file (`BACKUP_KEEP`).

---

## 7. Guard: Perilaku yang Diuji

- Deteksi `https://`, `www.`, `chat.whatsapp.com/`, `wa.me/`, `t.me/`.
- Admin grup dan owner bot tidak pernah terkena guard.
- Bot bukan admin → tidak menghapus apa pun (tidak ada aksi setengah jalan).
- Aksi `delete`, `warn`, `kick` dapat dipilih per fitur (`.antilink warn`).
- `warn_limit` 1–10; tercapai → kick + warning dibersihkan + audit `warning.kick`.
- Antispam: > 6 pesan dalam 5 detik atau 4 pesan identik dalam 10 detik.
- Semua aksi guard tercatat di `audit_logs` dan statistik `guard:handled`.

---

## 8. Downloader: Alur & Batas

```text
argumen → cari URL → validateMediaUrl (platform allowlist)
  → limiter (concurrency, queue)
    → yt-dlp -J (metadata: judul, durasi, live?)
      → cek durasi ≤ DOWNLOAD_MAX_DURATION_SEC
        → yt-dlp unduh ke data/tmp (max-filesize)
          → cek ukuran ≤ DOWNLOAD_MAX_MB
            → kirim audio/video
              → hapus file temporary selalu (finally)
```

- `ytmp3` memakai `-x --audio-format mp3` sehingga butuh FFmpeg.
- `ytmp4`/`tiktok` memakai `bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b`.
- Availability yt-dlp di-cache; jika tidak ada, command langsung menjawab tanpa memanggil proses.
- Error dipetakan ke pesan pengguna: URL invalid, host tidak didukung, terlalu besar, terlalu panjang, sibuk, FFmpeg hilang, gagal umum.

---

## 9. Peta Test (142)

| File | Jumlah | Fokus |
|---|---|---|
| `tests/config.test.js` | 7 | Default, parsing, validasi env, batas angka |
| `tests/database.test.js` | 7 | Settings, user/premium, grup, warning, audit, backup |
| `tests/registry.test.js` | 5 | Manifest, alias, 35 command bawaan |
| `tests/text.test.js` | 5 | Unwrap, extract, parse command |
| `tests/jid.test.js` | 4 | Normalisasi, masking, varian pengirim |
| `tests/group.test.js` | 4 | Admin detection, cache, anti-impersonasi LID |
| `tests/middleware.test.js` | 8 | Compose, normalize, permission, maintenance, mode, scope, cooldown, rate limit |
| `tests/handler.test.js` | 19 | Integrasi handler, queue, cache balasan |
| `tests/queue.test.js` | 7 | Urutan, paralelisme, batas antrean |
| `tests/messageCache.test.js` | 5 | TTL, eviction, recency |
| `tests/locales.test.js` | 3 | Semua key dipakai ada di id+en, struktur sama, descriptionKey valid |
| `tests/groupCommands.test.js` | 14 | kick/promote/demote/warn/warnings/mute/tagall/groupinfo/welcome/goodbye |
| `tests/guard.test.js` | 11 | Pola link, admin exemption, bot bukan admin, warn→kick, flood, toggle |
| `tests/media.test.js` | 12 | findMedia, sharp, sticker/toimg, batas ukuran, error |
| `tests/downloader.test.js` | 15 | Validasi URL, SSRF, limit, cleanup, limiter, command |
| `tests/backup.test.js` | 8 | Verifikasi, korup, restore, skema, retensi, command |
| `tests/ban.test.js` | 8 | Ban user/grup, throttle notifikasi, proteksi, middleware, stats |

Yang **tidak** diuji otomatis: koneksi Baileys asli, QR/pairing, `docker build`, unduhan jaringan nyata, konversi sharp nyata (dipakai fake pipeline).

---

## 10. Batasan yang Gw Sadari

1. **Belum ada test koneksi WhatsApp nyata.** Semua memakai socket palsu.
2. **`docker build` belum dijalankan** (butuh Docker). Dockerfile sudah ditambah FFmpeg + yt-dlp; `sharp` sekarang dependency eksplisit.
3. **Tidak ada unduhan nyata di test.** Perubahan ekstraktor YouTube/TikTok hanya akan terlihat saat dijalankan.
4. **yt-dlp di Debian bookworm bisa tertinggal.** Bila downloader tiba-tiba gagal, perbarui binary-nya.
5. **Restore tidak mengubah state runtime.** Nilai mode/maintenance di database benar, tetapi `state.mode` di memori tetap sampai restart.
6. **Backup belum terenkripsi** dan berisi JID; perlakukan file backup sebagai data sensitif.
7. **Anti-impersonasi LID tetap punya celah** untuk akun LID-only (sama seperti Phase 1).
8. **Guard memakai metadata cache.** Perubahan admin bisa terlambat dikenali maksimal 60 detik.
9. **Tidak ada cap global unduhan per pengguna.** Cooldown 20 detik per command adalah rem utamanya.
10. **Nama file downloader kehilangan karakter non-ASCII** (emoji/aksen) karena disanitasi.

---

## 11. Checklist Review untuk Kamu

1. `src/services/downloader.js` — `validateMediaUrl` + `downloadMedia`. Pastikan allowlist host sudah sesuai kebutuhan.
2. `src/core/middleware/banned.js` — kebijakan notifikasi (sekali per 10 menit) dan grup yang dibalas diam.
3. `src/core/database/sqlite.js` — `MIGRATIONS[1]`, `restoreBackup`, `verifyBackup`. Skema v2 sulit diubah setelah ada data produksi.
4. `src/services/guard.js` — ambang spam (6 pesan/5 detik, 4 duplikat/10 detik) dan aksi default `delete`.
5. `src/locales/id.json` + `en.json` — pastikan istilah dan nada pesan sesuai selera.
6. `src/commands/owner/restore.js` — alur konfirmasi `confirm` dan backup pengaman.

---

## 12. Rekomendasi Sebelum Phase 3

1. Jalankan bot dengan nomor uji di grup nyata: cek promote/demote/kick, guard dengan bot admin, welcome/goodbye, dan sticker.
2. Pasang yt-dlp terbaru, uji `ytmp3`/`ytmp4`/`tiktok` dengan beberapa link, lalu jalankan `.doctor`.
3. Uji `.backup` → ubah data → `.restore latest confirm` di environment bersih.
4. Pantau log `guard`, `Download media selesai`, dan `Backup database gagal` setelah dipakai beberapa hari.
5. Baru lanjut Phase 3 (AI) sesuai roadmap.
