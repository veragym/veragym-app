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

# ── 완료 ───────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  ✅ 배포 준비 완료"
echo "  다음 단계: git add . && git commit && git push"
echo "══════════════════════════════════════════"
echo ""
