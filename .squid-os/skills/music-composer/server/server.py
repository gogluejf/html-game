#!/usr/bin/env python3
"""HTTP server for the music jukebox: static file serving only.

Serves the repo root (same as `python3 -m http.server`) with blanket no-store
caching so edited JS/JSON never goes stale. Songs are plain JSON files under
.squid-os/music-composer/<game>/ — the browser fetches them directly, so there
is no custom API endpoint.

Deep link: /jukebox.html?game=<name>&track=<slug-or-name>

Usage: python3 server.py [port]   (default port 8769; auto-increments if taken)
"""

import os
import socket
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Repo root is 4 levels up from this script:
# ~/src/html-game/.squid-os/skills/music-composer/server/server.py → ~/src/html-game
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))


class JukeboxHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    # Never let the browser cache ANYTHING — dev tool where stale JS or JSON
    # silently breaks playback (same rationale as the sprite editor server).
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet; see server.sh log file if needed


def _port_free(port):
    """Check via /dev/tcp (real connect) — a bare bind() lies here because of
    TIME_WAIT sockets left by killed instances: the port shows 'busy' to bind
    but would actually accept connections."""
    import subprocess
    r = subprocess.run(
        ["bash", "-c", f"timeout 1 bash -c '</dev/tcp/127.0.0.1/{port}' 2>/dev/null"],
        capture_output=True)
    return r.returncode != 0


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8769
    # Port already in use (e.g. another jukebox or anything else) → walk up one
    # at a time until we find a free port. Never kill someone else's process.
    while not _port_free(port):
        print(f"port {port} busy — trying {port + 1}", file=sys.stderr)
        port += 1
    server = HTTPServer(("0.0.0.0", port), JukeboxHandler)
    print(f"Serving {REPO_ROOT} on port {port}", flush=True)
    print(f"Jukebox: http://localhost:{port}/.squid-os/skills/music-composer/server/jukebox.html?game=petal-panic", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
