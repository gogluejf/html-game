#!/bin/bash
# server.sh — manage the sprite-engine sheet gallery without blocking the agent session.
#
# Usage:
#   ./server.sh start [port] [root]   Start the gallery in the background (idempotent).
#   ./server.sh stop                  Stop the tracked gallery cleanly.
#   ./server.sh status                Report running/stopped (exit 0 if running).
#   ./server.sh go [port] [root]      Start if needed, then print the ready URL.
# root defaults to the repo root inferred from this script's location.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
PIDFILE="/tmp/sprite-engine-gallery.pid"
LOGFILE="/tmp/sprite-engine-gallery.log"

# Port + root: non-command args (or 8799 / inferred root).
CMD="${1:-go}"
PORT=8799
ROOT=""
for a in "$@"; do
  case "$a" in start|stop|status|go) ;;
    *[!0-9]*) ROOT="$a" ;;
    *) [ "$PORT" = "8799" ] && PORT="$a" ;;
  esac
done
[ -z "$ROOT" ] && ROOT="$DIR"

is_running() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null || return 1
  curl -fsS -o /dev/null --max-time 3 "http://localhost:${PORT}/" 2>/dev/null || return 1
  return 0
}

cmd_start() {
  if is_running; then
    echo "already running pid=$(cat "$PIDFILE") url=http://localhost:${PORT}"
    return 0
  fi
  if [ -f "$PIDFILE" ]; then
    local old
    old="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
      kill "$old" 2>/dev/null || true
      sleep 1
      kill -9 "$old" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
  cd "$ROOT" || exit 1
  nohup setsid python3 "$SCRIPT_DIR/gallery.py" --root "$ROOT" "$PORT" > "$LOGFILE" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" > "$PIDFILE"
  for _ in $(seq 1 20); do
    if curl -fsS -o /dev/null --max-time 1 "http://localhost:${PORT}/" 2>/dev/null; then break; fi
    sleep 0.25
  done
  echo "started pid=$pid url=http://localhost:${PORT}"
}

cmd_stop() {
  if [ ! -f "$PIDFILE" ]; then echo "not running"; return 0; fi
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
    echo "stopped pid=$pid"
  else
    echo "stale pidfile, nothing to stop"
  fi
  rm -f "$PIDFILE"
}

cmd_status() {
  if is_running; then
    echo "running pid=$(cat "$PIDFILE") url=http://localhost:${PORT}"
    return 0
  fi
  echo "stopped"
  return 1
}

case "$CMD" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  go)     cmd_start >/dev/null; echo "http://localhost:${PORT}" ;;
  *) echo "usage: $0 {start|stop|status|go} [port]"; exit 1 ;;
esac
