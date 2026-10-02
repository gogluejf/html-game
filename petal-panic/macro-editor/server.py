#!/usr/bin/env python3
"""HTTP server for the Macro Editor: static file serving + atomic PUT writes.

Serves the repo root (so the game modules, macros/ JSON, and assets are all
reachable) and additionally accepts PUT requests to write macro JSON files
under `petal-panic/macros/levels/` atomically (write <file>.tmp then os.replace).

Usage: python3 server.py [port]   (default port 8767)
"""

import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Repo root is 2 levels up from this script:
# petal-panic/macro-editor/server.py → repo root (~/src/html-game)
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Only allow PUT writes under this path (relative to repo root).
ALLOWED_PREFIX = "petal-panic/macros/levels/"


class MacroEditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    # Never let the browser cache anything — stale JS/JSON silently breaks a dev tool.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def do_PUT(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._respond(400, {"ok": False, "error": f"invalid JSON body: {e}"})
            return

        name = body.get("name", "")
        data = body.get("data")
        if not name or not isinstance(data, dict):
            self._respond(400, {"ok": False, "error": "missing 'name' or 'data' object"})
            return
        # The macro id must match the filename and be a safe identifier.
        if not name.replace("_", "").isalnum():
            self._respond(400, {"ok": False, "error": "invalid macro id"})
            return

        target = os.path.realpath(os.path.join(REPO_ROOT, ALLOWED_PREFIX, f"{name}.json"))
        allowed_dir = os.path.realpath(os.path.join(REPO_ROOT, ALLOWED_PREFIX))
        if not (target == allowed_dir or target.startswith(allowed_dir + os.sep)):
            self._respond(403, {"ok": False, "error": "path not allowed"})
            return

        # Atomic write: tmp + os.replace (atomic on POSIX).
        tmp = target + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
                f.write("\n")
            os.replace(tmp, target)
        except Exception as e:
            if os.path.exists(tmp):
                os.remove(tmp)
            self._respond(500, {"ok": False, "error": str(e)})
            return

        self._respond(200, {"ok": True, "path": f"{ALLOWED_PREFIX}{name}.json"})

    def _respond(self, code, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8767
    server = HTTPServer(("0.0.0.0", port), MacroEditorHandler)
    print(f"Serving {REPO_ROOT} on port {port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
