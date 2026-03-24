#!/bin/bash
# Management CRM 배포 스크립트
# 사용법: bash deploy.sh [web|crawler|all]

set -e

SERVER="root@175.118.124.25"
REMOTE_PATH="/home/management-crm"
LOCAL_PATH="$(cd "$(dirname "$0")" && pwd)"

TARGET="${1:-all}"

echo "=== Management CRM 배포 시작 ==="
echo "대상: $TARGET"
echo ""

# 1. 파일 압축 (node_modules, .next 등 제외)
echo "[1/4] 파일 압축 중..."
tar czf /tmp/management-crm.tar.gz \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='src/generated' \
  --exclude='crawler/node_modules' \
  -C "$LOCAL_PATH" .
echo "  → $(ls -lh /tmp/management-crm.tar.gz | awk '{print $5}') 압축 완료"

# 2. 서버 전송
echo "[2/4] 서버 전송 중..."
scp -o StrictHostKeyChecking=no /tmp/management-crm.tar.gz "$SERVER:/tmp/"
echo "  → 전송 완료"

# 3. 서버에서 압축 해제
echo "[3/4] 서버에서 파일 업데이트 중..."
ssh "$SERVER" "cd $REMOTE_PATH && tar xzf /tmp/management-crm.tar.gz && rm /tmp/management-crm.tar.gz"
echo "  → 파일 업데이트 완료"

# 4. Docker 빌드 & 재시작
echo "[4/4] Docker 빌드 & 재시작 중..."
case "$TARGET" in
  web)
    ssh "$SERVER" "cd $REMOTE_PATH && docker compose build web && docker compose up -d web"
    ;;
  crawler)
    ssh "$SERVER" "cd $REMOTE_PATH && docker compose build crawler && docker compose up -d crawler"
    ;;
  all)
    ssh "$SERVER" "cd $REMOTE_PATH && docker compose build web crawler && docker compose up -d"
    ;;
  *)
    echo "사용법: bash deploy.sh [web|crawler|all]"
    exit 1
    ;;
esac

# 로컬 임시 파일 정리
rm -f /tmp/management-crm.tar.gz

echo ""
echo "=== 배포 완료! ==="
echo "웹: http://175.118.124.25"
ssh "$SERVER" "docker ps --filter 'name=crm-' --format 'table {{.Names}}\t{{.Status}}'"
