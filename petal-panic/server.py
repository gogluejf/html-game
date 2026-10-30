#!/usr/bin/env python3
"""Game dev server: HTTP/1.1 + automatic cache-busting for ALL assets.

- HTML: rewrites <script src> / <link href> with ?v=<md5-8>.
- JS:   rewrites static import/export-from specifiers with ?v=<md5-8>.
- CSS:  rewrites url() references (rare, but cheap).

This makes Chrome/Firefox module caches irrelevant: every file change
produces a new URL, so a plain reload ALWAYS serves fresh code.
No manual cache-clearing, ever. Drop-in replacement for `http.server`.
"""
import hashlib
import json
import os
import re
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))

# HTML: src="..." or href="..." (skip external + fragments)
HTML_TAG_RE = re.compile(r'((?:src|href)=")(?!https?://|#)([^"]+)(?=")')
# JS: import ... from '...' / import '...' / export ... from '...'
JS_IMPORT_RE = re.compile(r"""(from\s+|import\s+|export\s+\*\s+from\s+|import\()\s*(['"])(\.{1,2}/[^'"]+)\2""")
# CSS: url(...)
CSS_URL_RE = re.compile(r'url\(\s*([\'"]?)(\.{1,2}/[^\'")]+)\1\s*\)')


def file_hash(relpath):
    try:
        with open(os.path.join(ROOT, relpath), 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()[:8]
    except OSError:
        return '00000000'


class DevHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def _resolve(self, base_dir, ref):
        """Resolve a relative ref against base_dir, return path relative to ROOT."""
        full = os.path.normpath(os.path.join(base_dir, ref))
        return os.path.relpath(full, ROOT)

    def do_GET(self):
        path = self.path.split('?', 1)[0].lstrip('/')
        if not path:
            path = 'index.html'

        if path.endswith('.html'):
            self._serve_html(path)
        elif path.endswith('.js'):
            self._serve_js(path)
        elif path.endswith('.css'):
            self._serve_css(path)
        else:
            super().do_GET()

    def _send_bytes(self, data, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_html(self, rel):
        full = os.path.join(ROOT, rel)
        if not os.path.isfile(full):
            return self.send_error(404, 'File not found')
        with open(full, 'rb') as f:
            text = f.read().decode('utf-8', 'replace')

        def bust(m):
            attr, ref = m.group(1), m.group(2)
            if ref.endswith(('.js', '.css')):
                r = self._resolve(os.path.dirname(rel), ref)
                return f'{attr}{ref}?v={file_hash(r)}'
            return m.group(0)

        text = HTML_TAG_RE.sub(bust, text)
        self._send_bytes(text.encode('utf-8'), 'text/html; charset=utf-8')

    def _serve_js(self, rel):
        full = os.path.join(ROOT, rel)
        if not os.path.isfile(full):
            return self.send_error(404, 'File not found')
        with open(full, 'rb') as f:
            text = f.read().decode('utf-8', 'replace')

        base_dir = os.path.dirname(rel)

        def bust(m):
            prefix, quote, ref = m.group(1), m.group(2), m.group(3)
            # Only bust relative imports (./ or ../)
            if ref.startswith(('./', '../')):
                r = self._resolve(base_dir, ref)
                h = file_hash(r)
                return f"{prefix}{quote}{ref}?v={h}{quote}"
            return m.group(0)

        text = JS_IMPORT_RE.sub(bust, text)
        self._send_bytes(text.encode('utf-8'), 'application/javascript; charset=utf-8')

    def _serve_css(self, rel):
        full = os.path.join(ROOT, rel)
        if not os.path.isfile(full):
            return self.send_error(404, 'File not found')
        with open(full, 'rb') as f:
            text = f.read().decode('utf-8', 'replace')

        base_dir = os.path.dirname(rel)

        def bust(m):
            quote, ref = m.group(1), m.group(2)
            if ref.startswith(('./', '../')):
                r = self._resolve(base_dir, ref)
                h = file_hash(r)
                return f"url({quote}{ref}?v={h}{quote})"
            return m.group(0)

        text = CSS_URL_RE.sub(bust, text)
        self._send_bytes(text.encode('utf-8'), 'text/css; charset=utf-8')

    # ------------------------------------------------------------------
    # Macro write API (macro-editor/js/save.js contract):
    #   PUT    {name, data}            → write macros/levels/<name>.json
    #   PATCH  {old, new}              → rename macros/levels/<old>.json
    #   DELETE {name}                  → remove macros/levels/<name>.json
    # All writes are pretty-printed JSON + trailing newline (the format the
    # editor's fingerprint comparison expects). Paths are confined to
    # macros/levels — name is validated as a plain id (no separators).
    # ------------------------------------------------------------------
    MACRO_DIR = os.path.join(ROOT, 'macros', 'levels')
    _ID_RE = re.compile(r'^[A-Za-z0-9_\-]+$')

    def _read_body(self):
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length > 0 else b''
        return json.loads(raw.decode('utf-8')) if raw else {}

    def _macro_path(self, name):
        if not self._ID_RE.match(name or ''):
            raise ValueError(f'invalid macro id: {name!r}')
        return os.path.join(self.MACRO_DIR, f'{name}.json')

    def _write_json(self, path, obj):
        with open(path, 'w', encoding='utf-8') as f:
            f.write(json.dumps(obj, indent=2, ensure_ascii=False) + '\n')

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self):
        try:
            payload = self._read_body()
            path = self._macro_path(payload.get('name'))
            self._write_json(path, payload.get('data'))
            self._send_json(200, {'ok': True, 'name': payload.get('name')})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            self._send_json(400, {'error': str(e)})
        except OSError as e:
            self._send_json(500, {'error': f'write failed: {e}'})

    def do_PATCH(self):
        try:
            payload = self._read_body()
            old, new = payload.get('old'), payload.get('new')
            src = self._macro_path(old)
            dst = self._macro_path(new)
            if not os.path.isfile(src):
                self._send_json(404, {'error': f'not on disk: {old}'})
                return
            if os.path.exists(dst):
                self._send_json(409, {'error': f'target exists: {new}'})
                return
            os.replace(src, dst)
            self._send_json(200, {'ok': True, 'old': old, 'new': new})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            self._send_json(400, {'error': str(e)})
        except OSError as e:
            self._send_json(500, {'error': f'rename failed: {e}'})

    def do_DELETE(self):
        try:
            payload = self._read_body()
            path = self._macro_path(payload.get('name'))
            if not os.path.isfile(path):
                self._send_json(404, {'error': f'not on disk: {payload.get("name")}'})
                return
            os.remove(path)
            self._send_json(200, {'ok': True, 'name': payload.get('name')})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            self._send_json(400, {'error': str(e)})
        except OSError as e:
            self._send_json(500, {'error': f'delete failed: {e}'})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv[1:]) else 8765
    print(f'serving {ROOT} on :{port} (full cache-bust)', flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), DevHandler).serve_forever()
