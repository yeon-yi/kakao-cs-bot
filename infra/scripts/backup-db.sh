#!/bin/bash
# PostgreSQL 자동 백업 스크립트
# 사용: crontab -e -> 0 3 * * * /home/kakao-cs-bot/infra/scripts/backup-db.sh
set -euo pipefail

# ===================== 설정 =====================
BACKUP_DIR="/home/kakao-cs-bot/backups/db"
DAILY_RETAIN=7    # 일간 백업 보존 일수
WEEKLY_RETAIN=28  # 주간 백업 보존 일수 (4주)
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)  # 1=월요일, 7=일요일

# .env에서 DATABASE_URL 읽기
ENV_FILE="/home/kakao-cs-bot/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "[ERROR] .env file not found: $ENV_FILE"
  exit 1
fi

DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d'=' -f2-)
if [ -z "$DATABASE_URL" ]; then
  echo "[ERROR] DATABASE_URL not found in .env"
  exit 1
fi

# Docker 내부 호스트명을 localhost로 변환 (호스트에서 실행 시)
DATABASE_URL=$(echo "$DATABASE_URL" | sed 's|@postgres:|@localhost:|g')

# ===================== 디렉토리 생성 =====================
mkdir -p "$BACKUP_DIR/daily"
mkdir -p "$BACKUP_DIR/weekly"

# ===================== 백업 실행 =====================
DAILY_FILE="$BACKUP_DIR/daily/backup_${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting database backup..."
PG_DUMP="pg_dump"
# PostgreSQL 16 클라이언트가 설치된 경우 우선 사용
if [ -x /usr/lib/postgresql/16/bin/pg_dump ]; then
  PG_DUMP=/usr/lib/postgresql/16/bin/pg_dump
fi
$PG_DUMP "$DATABASE_URL" --no-owner --no-privileges | gzip > "$DAILY_FILE"

FILE_SIZE=$(du -h "$DAILY_FILE" | cut -f1)
echo "[$(date)] Daily backup created: $DAILY_FILE ($FILE_SIZE)"

# 일요일이면 주간 백업으로 복사
if [ "$DAY_OF_WEEK" -eq 7 ]; then
  WEEKLY_FILE="$BACKUP_DIR/weekly/backup_weekly_${TIMESTAMP}.sql.gz"
  cp "$DAILY_FILE" "$WEEKLY_FILE"
  echo "[$(date)] Weekly backup created: $WEEKLY_FILE"
fi

# ===================== 오래된 백업 정리 =====================
# 일간 백업: N일 초과 삭제
find "$BACKUP_DIR/daily" -name "backup_*.sql.gz" -mtime +$DAILY_RETAIN -delete 2>/dev/null
echo "[$(date)] Cleaned daily backups older than $DAILY_RETAIN days"

# 주간 백업: N일 초과 삭제
find "$BACKUP_DIR/weekly" -name "backup_weekly_*.sql.gz" -mtime +$WEEKLY_RETAIN -delete 2>/dev/null
echo "[$(date)] Cleaned weekly backups older than $WEEKLY_RETAIN days"

# ===================== 요약 =====================
DAILY_COUNT=$(find "$BACKUP_DIR/daily" -name "*.sql.gz" | wc -l)
WEEKLY_COUNT=$(find "$BACKUP_DIR/weekly" -name "*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

echo "[$(date)] Backup complete. Daily: $DAILY_COUNT, Weekly: $WEEKLY_COUNT, Total: $TOTAL_SIZE"
