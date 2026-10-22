#!/usr/bin/env python3
"""gallery.py — tmp sheet gallery server.

Serves a simple HTML gallery of every per-anim sheet PNG in the repo:
thumbnail grid, path under each, click → full-size view.
Filters: three dropdowns — game (project), category, kind.

Usage: python3 gallery.py [port]   (default 8799)
"""
import glob
import html
import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Repo root is 5 levels up from this script:
# .squid-os/skills/sprite-engine/scripts/server/gallery.py -> repo root
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))


def collect_sheets():
    out = []
    pats = ["*/assets/*/*/*_sheet.png", "*/assets/*/*/*/*_sheet.png"]
    for pat in pats:
        for p in glob.glob(os.path.join(ROOT, pat)):
            jf = p[:-4] + ".json"
            kind = "?"
            if os.path.exists(jf):
                try:
                    kind = json.load(open(jf)).get("kind", "?")
                except Exception:
                    pass
            rel = os.path.relpath(p, ROOT)
            parts = rel.split(os.sep)
            game = parts[0]                          # abyss-qwen | petal-panic
            cat = parts[2] if len(parts) > 4 else ""  # boss, enemies, levels...
            out.append((rel, kind, game, cat))
    return sorted(out)


def build_html(sheets):
    cards = []
    games = sorted({g for _, _, g, _ in sheets})
    cats = sorted({c for _, _, _, c in sheets if c})
    kinds = sorted({k for _, k, _, _ in sheets})
    for i, (rel, kind, game, cat) in enumerate(sheets):
        url = "/" + rel.replace(os.sep, "/")
        cards.append(f"""
      <div class="card" data-kind="{html.escape(kind)}" data-game="{html.escape(game)}" data-cat="{html.escape(cat)}" onclick="view({i})">
        <img loading="lazy" src="{html.escape(url)}" alt="">
        <div class="kind k-{html.escape(kind)}">{html.escape(kind)}</div>
        <div class="path">{html.escape(rel)}</div>
      </div>""")
    def opt_list(key_idx, values):
        return "".join(
            f'<option value="{html.escape(v)}">{html.escape(v)} ({sum(1 for s in sheets if s[key_idx] == v)})</option>'
            for v in values)
    js_data = json.dumps([s[0].replace(os.sep, "/") for s in sheets])
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>sheet gallery</title>
<style>
  body {{ background:#111; color:#ddd; font:13px/1.4 monospace; margin:0; padding:16px; }}
  h1 {{ font-size:16px; }}
  .filters {{ margin:10px 0; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }}
  .filters label {{ font-size:12px; color:#777; flex:1; min-width:130px; }}
  .filters select {{ background:#222; color:#ddd; border:1px solid #444; border-radius:6px;
    padding:8px 10px; font:14px monospace; width:100%; }}
  @media (min-width:700px) {{ .filters label {{ flex:0 0 auto; min-width:0; }} .filters select {{ width:auto; }} }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:8px; }}
  @media (min-width:700px) {{ .grid {{ grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:12px; }} }}
  .card {{ background:#1c1c1c; border:1px solid #333; border-radius:6px; padding:8px; cursor:pointer; }}
  .card:hover {{ border-color:#6af; }}
  .card.hidden {{ display:none; }}
  .card img {{ width:100%; height:100px; object-fit:contain; background:
    repeating-conic-gradient(#222 0% 25%, #1a1a1a 0% 50%) 0 0/16px 16px; }}
  @media (min-width:700px) {{ .card img {{ height:120px; }} }}
  .path {{ font-size:10px; color:#8ac; word-break:break-all; margin-top:6px; min-height:26px; }}
  .kind {{ font-size:10px; padding:1px 6px; border-radius:8px; display:inline-block; margin-top:6px; }}
  .k-animation {{ background:#243; color:#8f8; }}
  .k-tile_variant {{ background:#332; color:#fa8; }}
  .k-entity_variant {{ background:#323; color:#f8a; }}
  .k-\? {{ background:#333; color:#aaa; }}
  #overlay {{ position:fixed; inset:0; background:rgba(0,0,0,.92); display:none;
    flex-direction:column; align-items:center; justify-content:center; z-index:10; cursor:zoom-out; }}
  #overlay img {{ max-width:92vw; max-height:80vh; object-fit:contain;
    background:repeating-conic-gradient(#222 0% 25%, #1a1a1a 0% 50%) 0 0/16px 16px; }}
  #opath {{ color:#8ac; font:13px monospace; margin-top:12px; word-break:break-all; }}
</style></head><body>
<h1>sheets — <span id="count"></span> (click to enlarge)</h1>
<div class="filters">
  <label>game <select id="fGame" onchange="apply()">
    <option value="all">all</option>{opt_list(2, games)}</select></label>
  <label>category <select id="fCat" onchange="apply()">
    <option value="all">all</option>{opt_list(3, cats)}</select></label>
  <label>kind <select id="fKind" onchange="apply()">
    <option value="all">all</option>{opt_list(1, kinds)}</select></label>
</div>
<div class="grid">{''.join(cards)}</div>
<div id="overlay" onclick="this.style.display='none'">
  <img id="obig" src=""><div id="opath"></div>
</div>
<script>
const SHEETS = {js_data};
function apply(){{
  const G = document.getElementById('fGame').value,
        C = document.getElementById('fCat').value,
        K = document.getElementById('fKind').value;
  let n = 0;
  document.querySelectorAll('.card').forEach(c => {{
    const ok = (G==='all'||c.dataset.game===G) && (C==='all'||c.dataset.cat===C) && (K==='all'||c.dataset.kind===K);
    c.classList.toggle('hidden', !ok); if (ok) n++;
  }});
  document.getElementById('count').textContent = n + ' shown';
}}
function view(i){{
  document.getElementById('obig').src = SHEETS[i];
  document.getElementById('opath').textContent = SHEETS[i];
  document.getElementById('overlay').style.display = 'flex';
}}
document.addEventListener('keydown', e => {{ if (e.key === 'Escape')
  document.getElementById('overlay').style.display = 'none'; }});
apply();
</script></body></html>"""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            page = build_html(collect_sheets()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.end_headers()
            self.wfile.write(page)
        else:
            super().do_GET()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    print(f"gallery: {len(collect_sheets())} sheets on http://localhost:{port}")
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
