FROM node:22-bookworm-slim AS build
WORKDIR /app

ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/
RUN npm install

COPY . .
RUN npm run -w @rca/web build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
