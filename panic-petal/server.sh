#!/bin/bash
# server.sh — manage a local HTTP server for browser testing without blocking the agent session.
#
# Usage:
#   ./server.sh start [port]   Start the server in the background (idempotent).
#   ./server.sh stop           Stop the tracked server cleanly.
#   ./server.sh status         Report running/stopped (exit 0 if running).
#   ./server.sh go [port]      Start if needed, then print the ready URL.
#
# Non-blocking: the server is launched detached via nohup + setsid + disown so the
# calling shell (and the agent session) never waits on it.
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="/tmp/panic-petal-server.pid"
LOGFILE="/tmp/panic-petal-server.log"

is_running() {
  # Returns 0 only if a live process owns the pidfile AND the port answers.
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

  # Clean up a stale tracked instance before starting fresh. We only kill the exact
  # PID from our pidfile — never a broad pkill, which can match unrelated processes
  # (including this script's own command line).
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

  cd "$DIR" || exit 1
  # Detach fully: new session (setsid), ignore HUP (nohup), redirect IO, then disown.
  nohup setsid python3 -m http.server "$PORT" > "$LOGFILE" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" > "$PIDFILE"

  # Wait briefly for the port to come up.
  for _ in $(seq 1 20); do
    if curl -fsS -o /dev/null --max-time 1 "http://localhost:${PORT}/" 2>/dev/null; then break; fi
    sleep 0.25
  done

  if is_running; then
    echo "started pid=$pid port=$PORT log=$LOGFILE"
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
    echo "running pid=$(cat "$PIDFILE") url=http://localhost:${PORT}"
    return 0
  fi
  echo "stopped"
  return 1
}

cmd_go() {
  cmd_start >/dev/null
  if is_running; then
    echo "http://localhost:${PORT}"
    return 0
  fi
  echo "server failed to start — see $LOGFILE" >&2
  return 1
}

CMD="${1:-}"
case "$CMD" in
  start)  PORT="${2:-8765}"; cmd_start ;;
  stop)   PORT="8765";       cmd_stop ;;
  status) PORT="8765";       cmd_status ;;
  go)     PORT="${2:-8765}"; cmd_go ;;
  *)
    echo "usage: $0 {start|stop|status|go} [port]" >&2
    exit 2
    ;;
esac
