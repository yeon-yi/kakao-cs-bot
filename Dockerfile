FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/ai/package.json packages/ai/

RUN npm ci

COPY packages/ packages/
COPY apps/api/ apps/api/

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 apiuser
USER apiuser

EXPOSE 3000

CMD ["npx", "tsx", "apps/api/src/server.ts"]
