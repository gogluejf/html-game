#!/usr/bin/env python3
"""HTTP server for the sprite editor: static file serving + atomic PUT writes.

Serves the repo root (same as `python3 -m http.server`) but additionally accepts
PUT requests to write JSON files under `.squid-os/sprite-sheets/` atomically
(write to <file>.tmp then os.replace).

Usage: python3 server.py [port]   (default port 8766)
"""

import json
import os
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import unquote

# Repo root is 5 levels up from this script:
# .squid-os/skills/sprite-crop/scripts/server/server.py → repo root
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))

# record_tuning.py lives one level up from server/
RECORD_TUNING = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "record_tuning.py"))

# Only allow PUT writes under this path (relative to repo root).
ALLOWED_PREFIX = ".squid-os/sprite-sheets/"


class SpriteEditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    # Never let the browser cache ANYTHING — this is a dev tool where stale
    # JS or JSON silently breaks the editor (cached modules hide new code,
    # cached sheets hide saved tuning). Extension filtering was tried and
    # browsers still served stale copies; blanket no-store is the only
    # reliable behavior for a local editing server.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def do_PUT(self):
        # Read and parse the JSON body.
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._respond(400, {"ok": False, "error": f"invalid JSON body: {e}"})
            return

        sheet = body.get("sheet", "")
        name = body.get("name", "")
        anim = body.get("anim", "")
        data = body.get("data")

        # Security: only allow sheets under .squid-os/sprite-sheets/.
        if not sheet.startswith(ALLOWED_PREFIX):
            self._respond(403, {"ok": False, "error": "path not allowed"})
            return
        # Defense in depth: resolve and confirm we're still under the allowed dir.
        target = os.path.realpath(os.path.join(REPO_ROOT, sheet))
        allowed_dir = os.path.realpath(os.path.join(REPO_ROOT, ALLOWED_PREFIX))
        if not (target == allowed_dir or target.startswith(allowed_dir + os.sep)):
            self._respond(403, {"ok": False, "error": "path not allowed"})
            return

        # Delegate entirely to record_tuning.py — one write path for editor and agent.
        is_clear = body.get("clear", False)
        if is_clear:
            cmd = [sys.executable, RECORD_TUNING, "clear",
                   "--sheet", sheet, "--name", name, "--anim", anim]
        else:
            data_json = json.dumps(data) if isinstance(data, dict) else "{}"
            cmd = [sys.executable, RECORD_TUNING, "write",
                   "--sheet", sheet, "--name", name, "--anim", anim, "--data", data_json]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
        except Exception as e:
            self._respond(500, {"ok": False, "error": str(e)})
            return

        if result.returncode != 0:
            err = result.stderr.strip() or f"exit code {result.returncode}"
            self._respond(500, {"ok": False, "error": err})
            return

        self._respond(200, {"ok": True})

    def _respond(self, code, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    server = HTTPServer(("0.0.0.0", port), SpriteEditorHandler)
    print(f"Serving {REPO_ROOT} on port {port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
