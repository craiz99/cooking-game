# syntax=docker/dockerfile:1
# Hardened multi-stage OCI image compatible with Apple Container (apple/container),
# Docker, Fly.io, Railway, and Render.
# Uses fully-qualified docker.io image reference as recommended for apple/container.

FROM docker.io/library/node:22-bookworm-slim AS builder
WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY shared ./shared
COPY server ./server
COPY client ./client

RUN npm run build
RUN npm prune --omit=dev

FROM docker.io/library/node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# Create writable SQLite save directory owned by non-root node user (UID 1000)
# while keeping /app owned by root with read-only permissions (0555/0444).
RUN mkdir -p /data && chown -R node:node /data

COPY --from=builder --chown=root:root /build/package.json ./package.json
COPY --from=builder --chown=root:root /build/node_modules ./node_modules
COPY --from=builder --chown=root:root /build/dist ./dist

RUN chmod -R a-w /app

USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/server/index.js"]
