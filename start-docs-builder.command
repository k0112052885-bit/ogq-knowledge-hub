#!/bin/bash
# OGQ Docs Builder를 터미널 사용 없이 더블클릭으로 실행하는 런처.
# - 프로젝트 폴더로 이동
# - 이미 서버가 떠 있으면 재실행하지 않고 브라우저만 엶
# - 떠 있지 않으면 npm run dev를 백그라운드로 실행한 뒤 브라우저를 엶

set -u

PORT="${PORT:-7777}"
URL="http://localhost:${PORT}/admin"

# 이 스크립트 파일이 있는 디렉토리(프로젝트 루트)로 이동
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || {
  osascript -e 'display alert "OGQ Docs Builder" message "프로젝트 폴더로 이동하지 못했습니다."'
  exit 1
}

echo "OGQ Docs Builder 실행 준비 중..."
echo "프로젝트 폴더: $SCRIPT_DIR"

is_server_running() {
  curl -s -o /dev/null -m 1 "http://localhost:${PORT}/api/docs"
}

if is_server_running; then
  echo "이미 서버가 실행 중입니다 (포트 ${PORT}). 새로 켜지 않고 브라우저만 엽니다."
else
  echo "서버가 꺼져 있어 새로 실행합니다: npm run dev (포트 ${PORT})"

  if [ ! -d node_modules ]; then
    echo "node_modules가 없어 먼저 npm install을 실행합니다..."
    npm install
  fi

  # 서버를 백그라운드로 실행하고, 터미널 창을 닫아도 유지되도록 nohup 사용.
  # 로그는 프로젝트 폴더의 .docs-builder.log에 남긴다.
  nohup env PORT="$PORT" npm run dev > .docs-builder.log 2>&1 &

  echo "서버가 준비될 때까지 대기 중..."
  for _ in $(seq 1 30); do
    if is_server_running; then
      break
    fi
    sleep 0.5
  done

  if ! is_server_running; then
    osascript -e 'display alert "OGQ Docs Builder" message "서버 시작에 실패했습니다. .docs-builder.log 파일을 확인해주세요."'
    exit 1
  fi

  echo "서버가 정상적으로 시작되었습니다."
fi

echo "브라우저에서 엽니다: ${URL}"
open "$URL"

echo ""
echo "작업이 끝나면 관리자 화면(${URL})의 '서버 종료' 버튼을 눌러 서버를 종료하세요."
echo "이 창은 몇 초 후 자동으로 닫힙니다."
sleep 3
