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

# FFmpeg disiapkan untuk fitur media di fase berikutnya.
# tzdata agar TZ (mis. Asia/Jakarta) berlaku untuk log dan nama backup.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tzdata \
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
