// Petal Panic — Console mirror (debug package).
//
// Wraps console.* so every call does TWO things:
//   1. posts the line to the dev server (POST /console-log) → appended to a
//      single shared tmp file (~/.tmp/petal-panic-console.log) that can be
//      tailed from anywhere without browser access (mobile testing)
//   2. calls the REAL console method — the normal console keeps working
//      exactly as before.
//
// The server truncates the tmp file on every page load/hard refresh by itself
// (it detects top-level navigation via the Sec-Fetch-Site header), so one
// fixed file is reused forever — no accumulation, no JS-side flush call.
//
// Design notes:
//   - install() is idempotent and safe to call multiple times; it only wraps
//     each console method ONCE (guarded by a symbol flag).
//   - Posting is fire-and-forget: fetch failures (server down, offline) are
//     swallowed silently — the real console is the source of truth, the file
//     is a convenience mirror. No retries, no queue: a dropped line while the
//     server is unreachable is acceptable for a debug mirror.
//   - Objects are stringified client-side (JSON where possible) so the server
//     stays dumb and the log lines stay readable when tailed.
//   - Node/headless: install() is a no-op there (no fetch), so unit tests that
//     import modules using clog() pay zero cost.

const _WRAPPED = Symbol('clog-wrapped');
let _enabled = false;

/** Serialize one console arg into a readable string. */
function _fmt(a) {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
  if (typeof a === 'function') return `[fn ${a.name ?? 'anonymous'}]`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/**
 * Mirror one console call to the dev server. Fire-and-forget: never throws,
 * never blocks. Silently skipped when disabled or fetch is unavailable.
 */
function _post(level, args) {
  if (!_enabled || typeof fetch !== 'function') return;
  const payload = { level, args: args.map(_fmt) };
  // keepalive lets the request survive a page unload mid-flight.
  fetch('/console-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => { /* mirror is best-effort — swallow */ });
}

/**
 * Wrap console[level] so it mirrors to the server AND still runs the real
 * console method. Idempotent: already-wrapped methods are left alone.
 */
function _wrap(level) {
  const orig = console[level];
  if (!orig || orig[_WRAPPED]) return;
  const wrapped = function (...args) {
    _post(level, args);
    return orig.apply(console, args);
  };
  wrapped[_WRAPPED] = true;
  console[level] = wrapped;
}

/**
 * Install the mirror for all standard console levels. Call once at boot.
 * Safe in node (no-op): without fetch, _post short-circuits.
 */
export function installConsoleMirror() {
  _enabled = true;
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) _wrap(level);
}
