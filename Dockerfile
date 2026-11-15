# Varr-Bot — image dasar untuk Docker / VPS / Pterodactyl (custom image)
# Node 22 LTS dipilih agar stabil untuk Baileys dan native module.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
# Build tools disiapkan untuk native module (mis. better-sqlite3) bila prebuild tidak tersedia.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim
WORKDIR /app

# FFmpeg untuk konversi audio/video dan yt-dlp untuk downloader Phase 2.
# Catatan: paket yt-dlp di Debian bookworm bisa tertinggal dari versi terbaru.
# Jika YouTube/TikTok berubah, perbarui yt-dlp di image:
#   pip3 install -U yt-dlp  (di dalam container) atau bangun ulang image ini.
# tzdata agar TZ (mis. Asia/Jakarta) berlaku untuk log dan nama backup.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tzdata yt-dlp ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV TZ=Asia/Jakarta

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data /app/auth_info_baileys \
    && chown -R node:node /app

USER node

VOLUME ["/app/auth_info_baileys", "/app/data"]
STOPSIGNAL SIGTERM

CMD ["node", "index.js"]
