FROM node:20-alpine AS base
WORKDIR /app

# Build dependencies (devDeps 포함 - tsc 빌드에 필요)
FROM base AS builder
COPY package.json package-lock.json ./
COPY apps/bot/package.json apps/bot/
COPY packages/*/package.json packages/*/
RUN npm ci
COPY . .
RUN npm run build -w packages/config -w packages/database -w packages/ai -w apps/bot

# Production dependencies only
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/bot/package.json apps/bot/
COPY packages/*/package.json packages/*/
RUN npm ci --omit=dev

# Production
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 botuser

COPY --from=builder --chown=botuser:nodejs /app/apps/bot/dist ./dist
COPY --from=builder --chown=botuser:nodejs /app/packages ./packages
COPY --from=deps --chown=botuser:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=botuser:nodejs /app/package.json ./package.json

USER botuser

HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "process.exit(0)" || exit 1

CMD ["node", "dist/worker.js"]
