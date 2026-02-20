FROM node:20-alpine AS base
WORKDIR /app

# Build (esbuild로 단일 파일 번들)
FROM base AS builder
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/bot/package.json apps/bot/
COPY apps/cli/package.json apps/cli/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/ai/package.json packages/ai/
RUN npm ci
COPY . .
RUN npx esbuild apps/api/src/server.ts \
  --bundle --platform=node --target=node20 \
  --outfile=dist/server.js \
  --external:pg \
  --external:ioredis \
  --external:openai \
  --external:@anthropic-ai/sdk \
  --external:@google/generative-ai \
  --external:jsonwebtoken

# Production dependencies only
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/bot/package.json apps/bot/
COPY apps/cli/package.json apps/cli/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/ai/package.json packages/ai/
RUN npm ci --omit=dev

# Production
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 apiuser

COPY --from=builder --chown=apiuser:nodejs /app/dist/server.js ./server.js
COPY --from=deps --chown=apiuser:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=apiuser:nodejs /app/package.json ./package.json

USER apiuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1))" || exit 1

CMD ["node", "server.js"]
