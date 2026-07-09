#!/bin/bash
# OGQ Docs Builder를 터미널 사용 없이 더블클릭으로 실행하는 런처.
# - 프로젝트 폴더로 이동
# - 이미 서버가 떠 있으면 재실행하지 않고 브라우저만 엶
# - 떠 있지 않으면 npm run dev를 완전한 백그라운드 프로세스로 실행한 뒤 브라우저를 엶
# - 스크립트가 끝나면 이 터미널 창을 닫아도 되는 상태가 된다(서버는 백그라운드에 남음).
#   Terminal 환경설정 > 프로필 > 셸 > "셸 종료 시:"가 "창 닫기"로 되어 있으면 창이
#   자동으로 닫히고, "창 유지"로 되어 있으면 사용자가 Cmd+W로 닫으면 된다.
#   (AppleScript로 다른 프로세스의 Terminal 창까지 강제로 닫는 방식은 사용자의
#   다른 작업 창을 잘못 닫을 위험이 있어 의도적으로 사용하지 않는다.)

set -u

PORT="${PORT:-7777}"
URL="http://localhost:${PORT}/admin"

# 이 스크립트 파일이 있는 디렉토리(프로젝트 루트)로 이동
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || {
  osascript -e 'display alert "OGQ Docs Builder" message "프로젝트 폴더로 이동하지 못했습니다."'
  exit 1
}

LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/docs-builder.log"
mkdir -p "$LOG_DIR"

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

  # 서버를 백그라운드 프로세스로 실행한다.
  # - stdin을 /dev/null로 분리해 터미널 입력에 영향받지 않게 한다.
  # - setsid(GNU coreutils, macOS 기본 설치 아님)가 있으면 새 세션으로 완전히
  #   분리해 터미널 종료 시 서버가 함께 죽지 않도록 하고, 없으면 nohup+disown으로
  #   SIGHUP만 무시하도록 한다.
  # - 로그는 logs/docs-builder.log에 남긴다.
  if command -v setsid >/dev/null 2>&1; then
    setsid env PORT="$PORT" npm run dev < /dev/null > "$LOG_FILE" 2>&1 &
  else
    nohup env PORT="$PORT" npm run dev < /dev/null > "$LOG_FILE" 2>&1 &
  fi
  disown

  echo "서버가 준비될 때까지 대기 중..."
  for _ in $(seq 1 30); do
    if is_server_running; then
      break
    fi
    sleep 0.5
  done

  if ! is_server_running; then
    osascript -e "display alert \"OGQ Docs Builder\" message \"서버 시작에 실패했습니다. ${LOG_FILE} 파일을 확인해주세요.\""
    exit 1
  fi

  echo "서버가 정상적으로 시작되었습니다."
fi

echo "브라우저에서 엽니다: ${URL}"
open "$URL"

osascript -e 'display notification "브라우저에서 Docs Builder가 열렸습니다." with title "OGQ Docs Builder"' >/dev/null 2>&1

echo ""
echo "서버가 백그라운드에서 실행 중입니다. 이제 이 창은 닫아도 안전합니다 (Cmd+W)."
echo "작업이 끝나면 관리자 화면(${URL})의 '서버 종료' 버튼을 눌러 서버를 종료하세요."
echo ""
echo "매번 이 창이 자동으로 닫히길 원하면:"
echo "  터미널 메뉴 > 설정(환경설정) > 프로필 > 셸 탭 > \"셸 종료 시:\" 를"
echo "  \"터미널 창 닫기\" 로 변경하세요."

exit 0
