FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build:client
RUN npm run build:server

FROM node:20-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y \
    tmux \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 zeus && \
    adduser --system --uid 1001 --gid 1001 zeus

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

RUN mkdir -p /app/data /app/tmux && \
    chown -R zeus:zeus /app

USER zeus

ENV NODE_ENV=production
ENV PORT=8096
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/zeus.db
ENV TMUX_SOCKET=/app/tmux/zeus.sock

EXPOSE 8096

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8096/api/health || exit 1

CMD ["node", "dist/server/index.js"]
