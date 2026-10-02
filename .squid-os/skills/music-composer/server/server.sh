#!/bin/bash
# server.sh — manage a local HTTP server for the music jukebox without blocking
# the agent session. Mirrors the sprite editor's wrapper (pidfile + nohup setsid).
#
# Usage:
#   ./server.sh start [port]   Start the server in the background (idempotent).
#   ./server.sh stop           Stop the tracked server cleanly.
#   ./server.sh status         Report running/stopped (exit 0 if running).
#   ./server.sh go [port]      Start if needed, then print the ready URL.
#
# If the requested port is busy, server.py walks up to the next free port; the
# actual URL is printed by `go` and also logged to $LOGFILE.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="/tmp/jukebox-server.pid"
LOGFILE="/tmp/jukebox-server.log"

is_running() {
  # Returns 0 only if a live process owns the pidfile AND some port answers.
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null || return 1
  return 0
}

cmd_start() {
  if is_running; then
    echo "already running pid=$(cat "$PIDFILE") url=$(grep -o 'http://[^ ]*' "$LOGFILE" | tail -1)"
    return 0
  fi

  # Clean up a stale tracked instance before starting fresh. We only kill the
  # exact PID from our pidfile — never a broad pkill.
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

  : > "$LOGFILE"
  nohup setsid python3 "$SCRIPT_DIR/server.py" "${PORT:-8769}" > "$LOGFILE" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" > "$PIDFILE"

  # Wait for the "Serving ... on port N" line (Python buffers stdout when it's a
  # file, so flush=True in server.py makes this appear immediately).
  for _ in $(seq 1 40); do
    if grep -qE '^Serving .* on port [0-9]+' "$LOGFILE" 2>/dev/null; then break; fi
    sleep 0.25
  done

  if is_running; then
    echo "started pid=$pid log=$LOGFILE"
  else
    echo "FAILED to start — check $LOGFILE" >&2
    return 1
  fi
}

cmd_stop() {
  if [ ! -f "$PIDFILE" ]; then
    echo "not running (no pidfile)"
    return 0
  fi
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "stopped pid=$pid"
  else
    echo "not running (stale pidfile)"
  fi
  rm -f "$PIDFILE"
}

cmd_status() {
  if is_running; then
    local p
    p="$(actual_port)"
    echo "running pid=$(cat "$PIDFILE") port=${p:-?} url=http://localhost:${p:-?}/.squid-os/skills/music-composer/server/jukebox.html"
    return 0
  fi
  echo "stopped"
  return 1
}

actual_port() {
  # Authoritative: parse the port server.py printed ("Serving ... on port N").
  grep -oE '^Serving .* on port [0-9]+' "$LOGFILE" 2>/dev/null | grep -oE '[0-9]+$' | tail -1
}

cmd_go() {
  cmd_start >/dev/null
  if is_running; then
    local p
    p="$(actual_port)"
    if [ -n "$p" ]; then
      echo "http://localhost:$p/.squid-os/skills/music-composer/server/jukebox.html?game=petal-panic"
      return 0
    fi
    grep -o 'http://[^ ]*jukebox[^ ]*' "$LOGFILE" | tail -1
    return 0
  fi
  echo "server failed to start — see $LOGFILE" >&2
  return 1
}

CMD="${1:-}"
case "$CMD" in
  start)  PORT="${2:-8769}"; cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  go)     PORT="${2:-8769}"; cmd_go ;;
  *)
    echo "usage: $0 {start|stop|status|go} [port]" >&2
    exit 2
    ;;
esac
