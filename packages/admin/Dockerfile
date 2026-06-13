# Контекст сборки — корень репозитория (см. docker-compose.yml)
FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

# Манифесты воркспейсов
COPY package.json ./
COPY packages/db/package.json packages/db/
COPY packages/bot/package.json packages/bot/
COPY packages/admin/package.json packages/admin/

RUN npm install --workspace @hr/db --workspace @hr/admin

# Исходники
COPY packages/db packages/db
COPY packages/admin packages/admin
COPY content content

# Prisma Client + сборка Next
RUN npm -w @hr/db run generate
RUN npm -w @hr/admin run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "-w", "@hr/admin", "run", "start"]
