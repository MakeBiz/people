#!/usr/bin/env bash
# Ежедневный бэкап БД через pg_dump (раздел 10 ТЗ).
# Использование (на сервере): добавьте в crontab, например:
#   0 3 * * * /path/to/repo/scripts/backup.sh >> /var/log/hr-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
# Подхватываем POSTGRES_* из .env
set -a; [ -f .env ] && . ./.env; set +a

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/${POSTGRES_DB}_${STAMP}.sql.gz"

docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$FILE"

echo "✅ Бэкап: $FILE"

# Чистим бэкапы старше 14 дней
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +14 -delete
