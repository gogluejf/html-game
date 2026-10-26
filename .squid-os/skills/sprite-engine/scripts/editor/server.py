#!/usr/bin/env python3
"""HTTP server for the sprite editor: static file serving + atomic PUT writes.

Serves the repo root (same as `python3 -m http.server`) but additionally accepts
PUT requests that delegate to record_tuning.py, which atomically updates the
tuning fields of sheet JSON twins in the assets tree.

Usage: python3 server.py [port]   (default port 8766)
"""

import json
import os
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import unquote

# Repo root is 5 levels up from this script:
# .squid-os/skills/sprite-engine/scripts/editor/server.py → repo root
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))

# record_tuning.py lives one level up from editor/ (in sprite-engine/scripts/)
RECORD_TUNING = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "record_tuning.py"))

# Registry dir holding <project>.meta.json files (one per project).
SHEETS_REGISTRY = os.path.join(REPO_ROOT, ".squid-os", "sprite-sheets")


def _allowed_prefixes():
    """Derive the writable prefixes at runtime.

    Sheet JSONs are TWINS next to their PNGs in each project's assets tree; the
    registry meta files (.squid-os/sprite-sheets/<project>.meta.json) carry the
    authoritative assets_dir for every project. We also keep the legacy
    `.squid-os/sprite-sheets/` prefix so old saves still land somewhere sane.
    Re-read on every call so a newly added project is picked up without restart.
    """
    prefixes = [".squid-os/sprite-sheets/"]
    try:
        for fn in sorted(os.listdir(SHEETS_REGISTRY)):
            if not fn.endswith(".meta.json"):
                continue
            with open(os.path.join(SHEETS_REGISTRY, fn)) as f:
                adir = json.load(f).get("assets_dir", "")
            if adir:
                prefixes.append(adir.rstrip("/") + "/")
    except OSError:
        pass
    return tuple(prefixes)


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

        # Security: only allow sheets under the allowed prefixes (derived from
        # every project's meta.json assets_dir + the legacy registry dir).
        allowed = _allowed_prefixes()
        if not sheet.startswith(allowed):
            self._respond(403, {"ok": False, "error": "path not allowed"})
            return
        # Defense in depth: resolve and confirm we're still under an allowed dir.
        target = os.path.realpath(os.path.join(REPO_ROOT, sheet))
        allowed_dirs = [os.path.realpath(os.path.join(REPO_ROOT, pfx)) for pfx in allowed]
        if not any(target == ad or target.startswith(ad + os.sep) for ad in allowed_dirs):
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
