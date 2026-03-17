FROM node:22-bookworm-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-core fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/
RUN npm install

COPY . .
RUN npm run -w @rca/api db:generate && npm run -w @rca/api build

EXPOSE 8787
WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
