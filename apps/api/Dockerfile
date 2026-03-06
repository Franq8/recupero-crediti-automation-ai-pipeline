FROM node:22-bookworm-slim AS base
WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/
RUN npm install

COPY . .
RUN npm run -w @rca/api db:generate && npm run -w @rca/api build

EXPOSE 8787
WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
