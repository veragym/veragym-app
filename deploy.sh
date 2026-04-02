#!/bin/bash
# ============================================================
# VeraGym 배포 스크립트
# 사용법: ./deploy.sh
# 역할:  서비스 워커 버전 자동 증가 + 테스트 레포 동기화
# ============================================================

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(cd "$APP_DIR/../veragym-test-main" 2>/dev/null && pwd)"

APP_SW="$APP_DIR/service-worker.js"
TEST_SW="$TEST_DIR/service-worker.js"

# ── 현재 버전 읽기 ──────────────────────────────────────────
CURRENT_APP=$(grep -o "veragym-app-v[0-9]*" "$APP_SW" | head -1)
CURRENT_NUM=$(echo "$CURRENT_APP" | grep -o "[0-9]*$")
NEXT_NUM=$((CURRENT_NUM + 1))

CURRENT_TEST=$(grep -o "veragym-v[0-9]*" "$TEST_SW" | head -1)
CURRENT_TEST_NUM=$(echo "$CURRENT_TEST" | grep -o "[0-9]*$")
NEXT_TEST_NUM=$((CURRENT_TEST_NUM + 1))

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       VeraGym 배포 준비              ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "  운영 앱:  veragym-app-v$CURRENT_NUM  →  veragym-app-v$NEXT_NUM"
echo "  테스트:   veragym-v$CURRENT_TEST_NUM  →  veragym-v$NEXT_TEST_NUM"
echo ""

# ── 버전 업데이트 ────────────────────────────────────────────
sed -i '' "s/veragym-app-v$CURRENT_NUM/veragym-app-v$NEXT_NUM/" "$APP_SW" 2>/dev/null || \
sed -i "s/veragym-app-v$CURRENT_NUM/veragym-app-v$NEXT_NUM/" "$APP_SW"

if [ -f "$TEST_SW" ]; then
  sed -i '' "s/veragym-v$CURRENT_TEST_NUM/veragym-v$NEXT_TEST_NUM/" "$TEST_SW" 2>/dev/null || \
  sed -i "s/veragym-v$CURRENT_TEST_NUM/veragym-v$NEXT_TEST_NUM/" "$TEST_SW"
fi

# ── 테스트 레포 동기화 (변경된 파일만) ──────────────────────
if [ -d "$TEST_DIR" ]; then
  SYNC_FILES=("trainer-dash.html" "admin.html" "member-view.html" "session-write.html" "image-card.html" "exercise-library.html" "config.js" "routine-utils.js" "index.html" "trainer-login.html" "admin-login.html")
  SYNCED=0
  for f in "${SYNC_FILES[@]}"; do
    SRC="$APP_DIR/$f"
    DST="$TEST_DIR/$f"
    if [ -f "$SRC" ] && [ -f "$DST" ]; then
      if ! cmp -s "$SRC" "$DST"; then
        cp "$SRC" "$DST"
        echo "  ✓ 동기화: $f"
        SYNCED=$((SYNCED + 1))
      fi
    fi
  done
  if [ $SYNCED -eq 0 ]; then
    echo "  ✓ 동기화할 변경사항 없음"
  fi
else
  echo "  ⚠ 테스트 레포 경로를 찾을 수 없음: $TEST_DIR"
fi

# ── Git 커밋 & 푸시 ────────────────────────────────────────
BRANCH=$(git -C "$APP_DIR" branch --show-current 2>/dev/null || echo "main")

git -C "$APP_DIR" add \
  service-worker.js config.js \
  admin.html admin-login.html \
  trainer-dash.html trainer-login.html \
  member-view.html session-write.html \
  exercise-library.html image-card.html \
  index.html routine-utils.js \
  manifest.json manifest-admin.json manifest-member.json

COMMIT_MSG="deploy: veragym-app-v$NEXT_NUM ($(date '+%Y-%m-%d'))"
git -C "$APP_DIR" commit -m "$COMMIT_MSG" 2>/dev/null || echo "  ℹ 변경된 파일 없음 (커밋 스킵)"

echo ""
echo "  📤 GitHub 푸시 중..."
git -C "$APP_DIR" push origin "$BRANCH"
PUSH_CODE=$?

echo ""
echo "══════════════════════════════════════════"
if [ $PUSH_CODE -eq 0 ]; then
  echo "  ✅ 배포 완료! (veragym-app-v$NEXT_NUM)"
  echo "  🌐 https://veragym.github.io/veragym-app/"
else
  echo "  ❌ 푸시 실패 — 인증 또는 브랜치 확인 필요"
  echo "  수동 실행: git push origin $BRANCH"
fi
echo "══════════════════════════════════════════"
echo ""
