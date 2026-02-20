FROM node:20-alpine AS base
WORKDIR /app

# Build (devDeps 포함 - next build에 필요)
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
RUN npm run build -w packages/config -w apps/admin

# Production
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/admin/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r=>r.ok?process.exit(0):process.exit(1))" || exit 1

CMD ["node", "apps/admin/server.js"]
