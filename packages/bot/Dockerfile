# Контекст сборки — корень репозитория (см. docker-compose.yml)
FROM node:20-slim AS base
WORKDIR /app
# openssl нужен Prisma engine
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Манифесты воркспейсов (для кеша зависимостей)
COPY package.json ./
COPY packages/db/package.json packages/db/
COPY packages/bot/package.json packages/bot/
COPY packages/admin/package.json packages/admin/

RUN npm install --workspace @hr/db --workspace @hr/bot

# Исходники
COPY packages/db packages/db
COPY packages/bot packages/bot
COPY content content

# Генерация Prisma Client
RUN npm -w @hr/db run generate

ENV NODE_ENV=production
CMD ["npm", "-w", "@hr/bot", "run", "start"]
