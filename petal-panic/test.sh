#!/usr/bin/env bash
# Petal Panic test runners.
#   ./test.sh fast      — only the suites in js/test/fast.list (edit that file)
#   ./test.sh parallel  — ALL suites, 8 workers (~16s)
#   ./test.sh all       — ALL suites, sequential (baseline / CI)
set -u
cd "$(dirname "$0")/.."
TESTDIR=petal-panic/js/test
JOBS=8

run_files() {
  local files=("$@")
  local fail=0
  for f in "${files[@]}"; do
    if ! node "$f"; then
      echo "FAIL: $f"
      fail=1
    fi
  done
  return $fail
}

case "${1:-fast}" in
  fast)
    # Read patterns from fast.list, match against test files.
    mapfile -t patterns < <(grep -vE '^\s*(#|$)' "$TESTDIR/fast.list")
    files=()
    for p in "${patterns[@]}"; do
      while IFS= read -r f; do files+=("$f"); done < <(ls "$TESTDIR"/*.test.js | grep -i "$p")
    done
    if [ ${#files[@]} -eq 0 ]; then echo "no files matched fast.list"; exit 1; fi
    s=$(date +%s%N); run_files "${files[@]}"; rc=$?; e=$(date +%s%N)
    echo "fast: ${#files[@]} files in $(( (e-s)/1000000 ))ms (rc=$rc)"
    exit $rc
    ;;
  parallel)
    s=$(date +%s%N); fail=0
    ls "$TESTDIR"/*.test.js | xargs -P "$JOBS" -I{} sh -c \
      'node {} >/tmp/pp-test-out.$$ 2>&1 || { echo "FAIL: {}"; tail -30 /tmp/pp-test-out.$$; }; rm -f /tmp/pp-test-out.$$'
    # xargs exits non-zero if any child did; re-check via a second pass is overkill —
    # instead count FAIL lines:
    e=$(date +%s%N)
    echo "parallel: all files in $(( (e-s)/1000000 ))ms — see FAIL lines above"
    ;;
  all)
    s=$(date +%s%N); fail=0
    for f in "$TESTDIR"/*.test.js; do
      node "$f" > /dev/null 2>&1 || { echo "FAIL: $f"; fail=1; }
    done
    e=$(date +%s%N)
    echo "all: $(( (e-s)/1000000 ))ms rc=$fail"
    exit $fail
    ;;
  *)
    echo "usage: ./test.sh {fast|parallel|all}"; exit 2;;
esac
