# Review Phase 1 — Varr-Bot

Dokumen ini untuk audit internal: apa yang dibangun, kenapa begitu, dan di mana risikonya. Status: **Phase 1 selesai**, 70 test hijau, `npm audit` bersih.

---

## 1. Alur Satu Pesan

```text
Baileys messages.upsert (type = notify)
  │
  ├─ core/connection.js        pasang listener, teruskan ke handler
  │
  ├─ core/handler.js
  │    ├─ tolak: fromMe, status@broadcast, @broadcast, @newsletter
  │    ├─ dedup berdasarkan msg.key.id (LRU 1000)
  │    ├─ tolak: reaction, protocolMessage, pollUpdateMessage
  │    ├─ unwrapMessage  → buka ephemeral / viewOnce / edited
  │    ├─ extractText    → conversation, extendedText, caption, listResponse
  │    └─ parseCommand   → harus diawali prefix; selain itu diabaikan
  │
  ├─ core/queue.js      → serial per chat, paralel antar chat
  │    ├─ registry.get  → tidak ada? balas sekali per 15 detik
  │    └─ core/middleware (berurutan, boleh berhenti)
  │         normalize → maintenance → mode → permission → scope → cooldown → rateLimit
  │
  ├─ command.execute(ctx)  dengan timeout 30 detik
  │
  └─ reply / error boundary / statistik
```

Poin penting: handler **tidak** memproses chat tanpa prefix. Jadi bot tidak akan nyaut di grup sampai Phase 3 (AI) mengaktifkannya secara eksplisit.

---

## 2. Peta Modul

| File | Tanggung jawab | Catatan |
|---|---|---|
| `src/index.js` | Rakit dependency, start connection, backup, shutdown | Tidak ada logika bot |
| `src/config/index.js` | Baca env, validasi, resolve path | Satu-satunya tempat `process.env` |
| `src/core/connection.js` | Seluruh API Baileys | Isolasi agar upgrade tidak menyebar |
| `src/core/handler.js` | Filter pesan, ctx, pipeline, error boundary | Titik paling kritikal |
| `src/core/queue.js` | Serialisasi per chat + batas antrean | Antrean in-memory |
| `src/core/messageCache.js` | Cache `getMessage` untuk retry | TTL 15 menit, 1.024 entri |
| `src/core/registry.js` | Validasi manifest, alias, auto-load | Command = file, tidak perlu registrasi |
| `src/core/middleware/*` | Aturan lintas command | Satu file satu aturan |
| `src/core/database/sqlite.js` | Skema, migrasi, CRUD, backup | Driver-agnostic di `index.js` |
| `src/core/state.js` | Mode & maintenance runtime | Dipersist ke `settings` |
| `src/core/health.js` | Laporan kesehatan | Dipakai `.ping` dan log startup |
| `src/locales/*` | String user-facing | id + en |

---

## 3. Keputusan Desain & Trade-off

| Keputusan | Alasan | Trade-off yang diterima |
|---|---|---|
| Handler hanya `type: 'notify'` | Menghindari replay history saat reconnect | Pesan yang masuk saat offline ekstrem tidak diproses |
| Dedup LRU 1000 ID | Baileys bisa mengirim event ganda | Di luar 1000 pesan terakhir, duplikat bisa lolos |
| Unknown command di-throttle 15s | Mencegah bot jadi alat spam | Pengguna yang typo dua kali tidak dapat balasan kedua |
| `self`/`private` membisukan unknown command | Tidak membocorkan keberadaan bot | Debugging mode private lebih sepi |
| Owner = nomor di `OWNER_NUMBERS` | Tidak perlu tabel role khusus | Butuh restart/reload saat ganti owner |
| LID tidak boleh cocok dengan PN | Cegah impersonasi owner/admin | Akun yang hanya terlihat sebagai LID bisa gagal dikenali |
| Cooldown & rate limit in-memory | Cepat, tanpa I/O DB per pesan | Reset saat restart, tidak shared antar instance |
| SQLite sinkron | Sederhana, transaksional, tanpa server | Write besar memblok event loop |
| Mode disimpan di DB | Perubahan runtime bertahan setelah restart | Nilai `MODE` di `.env` hanya jadi default awal |
| Queue per chat | Balasan tidak saling mendahului, state grup tidak balapan | Pesan berlebih dilewati saat antrean penuh |
| Cache `getMessage` + TTL 15 menit | Retry kirim ulang lebih andal, termasuk pesan masuk | Memori bertambah; isi pesan tidak persisten |

---

## 4. Model Keamanan

| Ancaman | Mitigasi | Sisa risiko |
|---|---|---|
| Non-owner memakai command owner | Hierarki role + middleware permission | — |
| LID menyamar jadi owner | `isPhoneJid` + `sameIdentity` berbasis domain | Akun LID-only tidak terdeteksi sebagai owner |
| LID menyamar jadi admin grup | `toIdentity` mencocokkan domain, bukan hanya nomor | Sama seperti di atas |
| Spam command | Cooldown per user+command, rate limit sliding window | Tidak ada cap global lintas user |
| Command menggantung | `withTimeout` 30s | Command yang mengabaikan abort tetap jalan di background |
| Error command mematikan bot | `try/catch` per pesan + `Promise.allSettled` | — |
| Secret bocor di log | Pino redact (token, apiKey, password, ownerNumbers, databaseUrl) | Log Baileys di-silent-kan total |
| Session dicuri dari repo | `.gitignore` + `.dockerignore` | Tidak ada enkripsi at-rest |
| SQL injection | Semua query prepared statement | — |
| Path traversal | Tidak ada operasi file dari input chat di Phase 1 | Perlu diperhatikan saat downloader masuk |

Catatan: `public` mode berarti siapa pun yang tahu nomor bot bisa memakai command non-owner. Ini disengaja; rate limit per pengirim adalah satu-satunya rem.

---

## 5. Skema Database (versi 1)

| Tabel | Isi | Kunci |
|---|---|---|
| `settings` | mode, maintenance, flag global | `key` |
| `users` | JID, LID, nama, premium, hitungan command | `jid` |
| `groups` | JID, nama, banned, hitungan command | `jid` |
| `group_settings` | setting per grup (untuk Phase 2) | `(group_jid, key)` |
| `warnings` | riwayat warning per grup | `id`, index `(group_jid, user_jid)` |
| `stats` | counter command & error | `key` |
| `audit_logs` | aksi owner (mode, maintenance) | `id`, index `created_at` |
| `migrations` | versi skema yang sudah diterapkan | `version` |

- WAL + `synchronous = NORMAL` + `busy_timeout 5000`.
- Migrasi memakai `user_version`; kalau DB lebih baru dari kode, startup gagal dengan pesan jelas.
- Backup memakai online backup API SQLite, retensi 14 file, jalan harian dan saat shutdown.

---

## 6. Urutan Middleware & Alasannya

1. **normalize** — butuh identitas/role sebelum aturan lain.
2. **maintenance** — blokir paling awal, kecuali owner & command darurat.
3. **mode** — public/private/self setelah role diketahui.
4. **permission** — role vs permission command.
5. **scope** — grup vs private, dicek setelah permission agar pesan error tidak menyesatkan.
6. **cooldown** — per user+command.
7. **rateLimit** — sengaja terakhir supaya command yang kena cooldown tidak ikut memakan kuota.

---

## 7. Peta Test (70)

| File | Jumlah | Fokus |
|---|---|---|
| `tests/config.test.js` | 6 | Default, parsing owner/prefix/pairing, validasi |
| `tests/database.test.js` | 7 | Settings, user/premium, grup, warning, audit, backup |
| `tests/registry.test.js` | 5 | Validasi manifest, alias, auto-load 7 command |
| `tests/text.test.js` | 5 | Unwrap, extract, parse command, sanitasi |
| `tests/jid.test.js` | 4 | Normalisasi, masking, varian pengirim, `isPhoneJid` |
| `tests/group.test.js` | 4 | Admin detection, cache, anti-impersonasi LID |
| `tests/middleware.test.js` | 8 | Compose, normalize, permission, maintenance, mode, scope, cooldown, rate limit |
| `tests/handler.test.js` | 19 | Integrasi end-to-end, urutan per chat, paralel antar chat, cache balasan |
| `tests/queue.test.js` | 7 | Urutan, paralelisme, error isolation, batas antrean, drain |
| `tests/messageCache.test.js` | 5 | Simpan/ambil, TTL, eviction, recency, prune |

Yang **tidak** diuji otomatis: koneksi Baileys asli, QR/pairing, Docker, FFmpeg.

---

## 8. Batasan yang Gw Sadari

1. **Belum ada test koneksi nyata.** Semua test memakai socket palsu. Bug Baileys hanya muncul saat dijalankan dengan nomor asli.
2. **`docker build` belum dijalankan.** Sudah diaudit statis; `better-sqlite3` butuh glibc, karena itu base image `bookworm-slim`, bukan Alpine.
3. **Antrean dan cache bersifat in-memory.** Hilang saat restart. Pesan yang belum di-ack akan dikirim ulang WhatsApp, tetapi isi cache ikut reset.
4. **Pesan bisa dilewati saat antrean penuh.** Dengan `QUEUE_MAX_PENDING=50`, flood lebih dari 50 pesan menunggu di satu chat akan membuat pesan berikutnya diabaikan (dicatat sebagai warning).
5. **Owner LID-only tidak dikenali.** Kalau WhatsApp hanya mengirim LID tanpa `participantAlt`/`participantPn`, owner tidak match. Mitigasi sementara: pastikan nomor owner mengirim pesan dari akun yang punya PN.
6. **Cooldown hilang saat restart.** Diterima untuk single instance.
7. **Tidak ada cap global rate limit.** Satu orang dengan banyak nomor tetap bisa membebani bot.
8. **Audit log menyimpan JID lengkap.** Perlu kebijakan retensi sebelum dipakai jangka panjang.
9. **Backup belum diuji restore.** Sudah ada file backup, tapi prosedur restore belum jadi command.

---

## 9. Checklist Review untuk Kamu

Fokus ke lima tempat ini kalau mau audit cepat:

1. `src/core/handler.js` → `handleMessage` + `processCommand`. Pastikan filter pesan, queue, dan urutan statistik sesuai harapan.
2. `src/core/middleware/permission.js` + `src/utils/group.js` → `isParticipantAdmin`. Ini gerbang keamanan utama.
3. `src/core/middleware/mode.js`. Cek apakah definisi `private` sudah sesuai keinginanmu (owner + admin grup, DM owner saja).
4. `src/core/database/sqlite.js` → `MIGRATIONS`. Skema ini akan sulit diubah setelah ada data produksi.
5. `src/core/connection.js` → `handleConnectionUpdate` + konfigurasi `getMessage`. Cek daftar status fatal dan kebijakan reconnect.

Keputusan yang sudah diambil:

- Mode `private` tetap **admin-only** di grup, DM owner saja.
- Owner tetap lewat `OWNER_NUMBERS` (tanpa `.addowner`), konsisten dengan model keamanan saat ini.
- Queue per chat dan cache `getMessage` sudah diimplementasikan.

---

## 10. Rekomendasi Sebelum Phase 2

1. Jalankan sekali dengan nomor uji di server untuk memastikan QR/pairing dan persistensi session.
2. Pantau log `Antrean chat penuh` setelah bot dipakai di grup ramai; naikkan `QUEUE_MAX_PENDING` bila perlu.
3. Setelah itu baru welcome/goodbye, kick/promote/demote, warning, guard, sticker.
