#!/bin/bash
# PostgreSQL 백업 복원 스크립트
# 사용: ./restore-db.sh [백업파일.sql.gz]
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "사용법: $0 <backup_file.sql.gz>"
  echo ""
  echo "사용 가능한 백업 파일:"
  echo "--- 일간 ---"
  ls -lh /home/kakao-cs-bot/backups/db/daily/*.sql.gz 2>/dev/null || echo "  (없음)"
  echo "--- 주간 ---"
  ls -lh /home/kakao-cs-bot/backups/db/weekly/*.sql.gz 2>/dev/null || echo "  (없음)"
  exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "[ERROR] 백업 파일을 찾을 수 없습니다: $BACKUP_FILE"
  exit 1
fi

ENV_FILE="/home/kakao-cs-bot/.env"
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d'=' -f2-)

echo "================================================"
echo "  DB 복원 - 주의: 현재 데이터가 덮어씌워집니다!"
echo "  백업 파일: $BACKUP_FILE"
echo "================================================"
read -p "계속하시겠습니까? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "취소되었습니다."
  exit 0
fi

echo "[$(date)] Restoring database from $BACKUP_FILE..."
gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL"
echo "[$(date)] Database restored successfully."
