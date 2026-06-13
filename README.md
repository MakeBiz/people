# Платформа психологического тестирования сотрудников

Telegram-бот (тесты кнопками) + веб-админка (Next.js) + PostgreSQL. Всё разворачивается на одном VPS через Docker Compose. Реализован **Этап 1 (MVP)** из ТЗ.

## Ключевой принцип: тесты — это данные

Код бота универсален и не знает ни одного теста. Тест целиком описан JSON-документом (вопросы, варианты, веса шкал, скоринг, интерпретации) в таблице `tests.content`. Новый тест добавляется загрузкой JSON — без изменения кода.

## Структура репозитория

```
.
├── docker-compose.yml        postgres + migrate + bot + admin + caddy
├── Caddyfile                 HTTPS и reverse proxy
├── .env.example              пример переменных окружения
├── content/                  JSON-контент тестов (источник для сида)
│   ├── uwes9.json  pss10.json  enps.json
│   └── gerchikov.json  rotter.json  disc.json
├── packages/
│   ├── db/                   Prisma-схема, клиент, сид (общие для бота и админки)
│   ├── bot/                  Telegram-бот (grammY + TypeScript)
│   └── admin/                Next.js 14 админка (App Router + Tailwind + recharts)
├── scripts/backup.sh         ежедневный pg_dump
└── .github/workflows/        деплой по push в main
```

## Что реализовано в Этапе 1

| Пункт ТЗ | Статус |
|---|---|
| Docker Compose: postgres + bot + admin + caddy | ✅ |
| Схема БД (Prisma) + сид тестов uwes9, pss10, enps, gerchikov, rotter, disc | ✅ |
| Бот: вход по токену, согласие ПДн, движок вопросов (likert, single_choice, forced_pair, most_least, numeric_scale, free_text), сохранение ответов, скоринг, `/continue` | ✅ |
| Антифрод-флаги (too_fast, uniform) | ✅ |
| Админка (NextAuth, роли owner/hr/manager, **shadcn/ui**): люди (CRUD), назначения со ссылками, профиль с результатами и графиками, дашборд | ✅ |
| Алерты **data-driven из `alert_rules` теста**: engagement_drop, stress_rise, invalid_session + уведомление в Telegram | ✅ |
| Анонимные назначения: `default_anonymous` теста → дефолт `is_anonymous` при назначении | ✅ |

Этапы 2–3 (кампании по расписанию, анонимные пульс-опросы, карточка «как с ним работать», редактор JSON в админке, роли manager, image_choice/таймеры, PDF, Bitrix24) — заложены в схеме и помечены в UI как «Этап 2».

## Быстрый старт (Docker)

```bash
cp .env.example .env
# отредактируйте .env: BOT_TOKEN, BOT_USERNAME, пароли, домены, NEXTAUTH_SECRET
docker compose up -d --build
```

Что произойдёт:
1. Поднимется PostgreSQL.
2. Сервис `migrate` создаст схему (`prisma db push`) и засидит тесты + владельца админки (`OWNER_EMAIL` / `OWNER_PASSWORD`).
3. Запустятся бот и админка, Caddy выдаст HTTPS на ваши домены.

Админка: `https://$ADMIN_DOMAIN` — войдите под `OWNER_EMAIL`.

Сгенерировать секреты:
```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
```

### Режим бота
- `BOT_MODE=polling` (по умолчанию) — проще всего, домен для бота не нужен.
- `BOT_MODE=webhook` — заполните `BOT_WEBHOOK_URL` (= `https://$BOT_DOMAIN`) и `BOT_WEBHOOK_SECRET`, Caddy проксирует на бот.

## Как это работает (поток)

1. HR в админке добавляет человека → назначает тест → получает ссылку `t.me/<bot>?start=<token>`.
2. Человек открывает ссылку → бот привязывает `telegram_id`, показывает **согласие на ПДн** → интро → вопросы кнопками (одно сообщение редактируется, прогресс «Вопрос N из M»).
3. По завершении бот считает результат, пишет в `results`, проверяет правила алертов.
4. При срабатывании алерта создаётся запись и руководителю/владельцу с привязанным Telegram приходит уведомление.
5. HR/руководитель видит результаты, динамику (UWES/PSS) и алерты в админке.

`/continue` — продолжить незавершённый тест с места остановки (состояние в `sessions.current_question`).

## Локальная разработка (без Docker)

Нужен запущенный PostgreSQL и `DATABASE_URL` в `.env`.

```bash
npm install
npm run db:generate
npm run db:migrate   # или: npm run db:push для dev
npm run db:seed
npm run bot:dev      # бот в polling
npm run admin:dev    # админка на http://localhost:3000
```

## Добавление нового теста

1. Положите JSON в `content/<code>.json` (формат — см. раздел 6 ТЗ и существующие файлы).
2. Перезапустите сид: `docker compose run --rm migrate` или `npm run db:seed`.

Сид делает upsert по `code` и повышает `version`. В Этапе 2 это же делается через загрузку JSON в админке с валидацией.

### Data-driven поля теста

Помимо вопросов и скоринга, JSON теста несёт правила алертов и анонимность — код их не хардкодит:

```json
{
  "default_anonymous": true,
  "alert_rules": [
    { "code": "engagement_drop", "level": "red", "metric": "total",
      "type": "drop_from_prev", "threshold": 1.5,
      "message": "🔴 Падение вовлечённости у {name}: {prev} → {current}…" }
  ]
}
```

- `default_anonymous` — дефолт чекбокса «анонимно» при назначении теста (для пульс-опросов/eNPS).
- `alert_rules[]` — правила, проверяемые после каждого завершения. Типы условий:
  - `drop_from_prev` — метрика упала на ≥ `threshold` относительно прошлого замера;
  - `rise_consecutive` — метрика растёт `periods` замеров подряд;
  - `threshold_high` — метрика ≥ `threshold`.
  - `message` поддерживает плейсхолдеры `{name} {prev} {current} {delta} {series}`.
- `invalid_session` (валидность/антифрод) — встроенная глобальная проверка, работает для любого теста.

## Безопасность и ПДн (раздел 10 ТЗ)

- Согласие на ПДн обязательно до первого теста; факт и дата в `people.consent_given_at`.
- БД не публикуется наружу — доступ только из docker-сети.
- Пароли админов — bcrypt. Сессии — JWT в httpOnly cookie (NextAuth).
- Анонимные кампании: результат пишется без `person_id` (Этап 2).
- В UI результатов — дисклеймер о том, что тесты не являются единственным основанием для кадровых решений.
- Бэкап: `scripts/backup.sh` (поставьте в cron).

## Деплой

Push в `main` → GitHub Actions по SSH делает `git pull && docker compose up -d --build`.
Секреты репозитория: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `DEPLOY_PATH` (и опц. `SSH_PORT`).

## Что нужно от заказчика

1. VPS с Docker и доменами (`admin.*`, при webhook — `bot.*`).
2. Токен бота от @BotFather и его username.
3. GitHub-репозиторий + секреты для Actions.
4. Текст согласия на ПДн (по умолчанию подставлен типовой — в `packages/bot/src/text.ts`).
5. Финальный JSON-контент тестов (стартовые версии в `content/` можно расширять/заменять).
