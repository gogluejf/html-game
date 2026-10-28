#!/usr/bin/env python3
"""gallery.py — tmp sheet gallery server.

Serves a simple HTML gallery of every per-anim sheet PNG in the repo:
thumbnail grid, path under each, click → full-size view.
Filters: three dropdowns — game (project), category, kind.

Usage: python3 gallery.py --root <repo-root> [port]   (default port 8799)
"""
import argparse
import html
import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


ROOT = None  # set in main() from --root


def main():
    ap = argparse.ArgumentParser(description="sheet gallery server")
    ap.add_argument("--root", required=True, help="repo root containing the project asset trees")
    ap.add_argument("port", nargs="?", default=8799, type=int)
    args = ap.parse_args()
    global ROOT
    ROOT = os.path.abspath(args.root)
    print(f"gallery: {len(collect_sheets())} sheets on http://localhost:{args.port}")
    HTTPServer(("0.0.0.0", args.port), Handler).serve_forever()


def collect_sheets():
    out = []
    seen = set()
    for dirpath, dirs, files in os.walk(ROOT):
        # Skip version-control noise and only consider assets subtrees.
        if "/.git" in dirpath or os.path.basename(dirpath) == ".git":
            continue
        # The sheet must live under an `assets/` folder of some project:
        # <root>/<project>/assets/<category>/<entity>/<anim>_sheet.png
        parts = os.path.relpath(dirpath, ROOT).split(os.sep)
        if "assets" not in parts:
            continue
        aidx = parts.index("assets")
        game = parts[0]                                  # abyss-qwen | petal-panic
        rel_assets = parts[aidx + 1:]                    # category/entity/...
        cat = rel_assets[0] if len(rel_assets) > 1 else ""   # boss, enemies, levels...
        entity = rel_assets[1] if len(rel_assets) > 2 else ""  # grim_vertigo, jester...
        for f in files:
            if not f.endswith("_sheet.png"):
                continue
            p = os.path.join(dirpath, f)
            rel = os.path.relpath(p, ROOT)
            if rel in seen:
                continue
            seen.add(rel)
            jf = p[:-4] + ".json"
            kind = "?"
            if os.path.exists(jf):
                try:
                    kind = json.load(open(jf)).get("kind", "?")
                except Exception:
                    pass
            out.append((rel, kind, game, cat, entity))
    return sorted(out)


def build_html(sheets):
    cards = []
    for i, (rel, kind, game, cat, entity) in enumerate(sheets):
        url = "/" + rel.replace(os.sep, "/")
        cards.append(f"""
      <div class="card" data-kind="{html.escape(kind)}" data-game="{html.escape(game)}" data-cat="{html.escape(cat)}" data-entity="{html.escape(entity)}" onclick="view({i})">
        <img loading="lazy" src="{html.escape(url)}" alt="">
        <div class="kind k-{html.escape(kind)}">{html.escape(kind)}</div>
        <div class="path">{html.escape(rel)}</div>
      </div>""")
    # Load frame lists from twin JSONs so the detail view can show individual frames.
    def load_frames(rel):
        jf = os.path.join(ROOT, rel[:-4] + ".json")
        if not os.path.exists(jf):
            return []
        try:
            doc = json.load(open(jf))
        except Exception:
            return []
        frames = []
        for ent in doc.get("entities", []):
            fdir = ent.get("frames_dir", "")
            for fr in ent.get("frames", []):
                fn = fr.get("file")
                if fn and fdir:
                    frames.append((fdir + "/" + fn).replace(os.sep, "/"))
        return frames

    js_sheets = json.dumps([
        {"rel": s[0].replace(os.sep, "/"), "kind": s[1], "game": s[2], "cat": s[3], "entity": s[4], "frames": load_frames(s[0])}
        for s in sheets
    ])
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>sheet gallery</title>
<style>
  body {{ background:#111; color:#ddd; font:13px/1.4 monospace; margin:0; padding:16px; }}
  h1 {{ font-size:16px; }}
  .filters {{ margin:10px 0; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }}
  .filters label {{ font-size:12px; color:#777; flex:1; min-width:130px; }}
  .filters select {{ background:#222; color:#ddd; border:1px solid #444; border-radius:6px;
    padding:8px 10px; font:14px monospace; width:100%; }}
  @media (min-width:900px) {{ .filters label {{ flex:0 0 auto; min-width:0; }} .filters select {{ width:auto; min-width:120px; }} }}
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
  #overlay {{ position:fixed; inset:0; background:rgba(0,0,0,.94); display:none;
    flex-direction:column; align-items:center; justify-content:flex-start; z-index:10; cursor:zoom-out;
    padding:20px 16px; overflow-y:auto; }}
  #opath {{ color:#8ac; font:13px monospace; margin-bottom:12px; word-break:break-all; text-align:center; }}
  #obig {{ max-width:92vw; max-height:52vh; object-fit:contain;
    background:repeating-conic-gradient(#222 0% 25%, #1a1a1a 0% 50%) 0 0/16px 16px; }}
  #frames {{ display:flex; gap:18px; flex-wrap:wrap; justify-content:center; margin-top:18px; }}
  #frames .fr {{ display:flex; flex-direction:column; align-items:center; gap:6px; }}
  #frames .fr img {{ max-width:200px; max-height:220px; object-fit:contain;
    background:repeating-conic-gradient(#222 0% 25%, #1a1a1a 0% 50%) 0 0/16px 16px; border:1px solid #333; border-radius:4px; }}
  #frames .fr span {{ font:11px monospace; color:#7c9; }}
</style></head><body>
<h1>sheets — <span id="count"></span> (click to enlarge)</h1>
<div class="filters">
  <label>game <select id="fGame" onchange="cascade()"><option value="all">all</option></select></label>
  <label>category <select id="fCat" onchange="cascade()"><option value="all">all</option></select></label>
  <label>entity <select id="fEntity" onchange="cascade()"><option value="all">all</option></select></label>
  <label>kind <select id="fKind" onchange="cascade()"><option value="all">all</option></select></label>
</div>
<div class="grid">{''.join(cards)}</div>
<div id="overlay" onclick="closeOverlay()">
  <div id="opath"></div>
  <img id="obig" src="">
  <div id="frames"></div>
</div>
<script>
const SHEETS = {js_sheets};
const FIELDS = ['game','cat','entity','kind'];

function populate(selectId, values) {{
  const sel = document.getElementById(selectId);
  const cur = sel.value;
  const counts = {{}};
  values.forEach(v => {{ counts[v] = (counts[v]||0)+1; }});
  const sorted = Object.keys(counts).sort();
  sel.innerHTML = '<option value="all">all ('+values.length+')</option>' +
    sorted.map(v => '<option value="'+v+'">'+v+' ('+counts[v]+')</option>').join('');
  if (sorted.includes(cur)) sel.value = cur; else sel.value = 'all';
}}

function cascade() {{
  const G = document.getElementById('fGame').value,
        C = document.getElementById('fCat').value,
        E = document.getElementById('fEntity').value,
        K = document.getElementById('fKind').value;

  // Build constrained option lists (each filter narrows the others)
  const gOpts = [...new Set(SHEETS.filter(s => (C==='all'||s.cat===C)&&(E==='all'||s.entity===E)&&(K==='all'||s.kind===K)).map(s=>s.game))];
  const cOpts = [...new Set(SHEETS.filter(s => (G==='all'||s.game===G)&&(E==='all'||s.entity===E)&&(K==='all'||s.kind===K)).map(s=>s.cat))];
  const eOpts = [...new Set(SHEETS.filter(s => (G==='all'||s.game===G)&&(C==='all'||s.cat===C)&&(K==='all'||s.kind===K)).map(s=>s.entity))];
  const kOpts = [...new Set(SHEETS.filter(s => (G==='all'||s.game===G)&&(C==='all'||s.cat===C)&&(E==='all'||s.entity===E)).map(s=>s.kind))];

  populate('fGame', gOpts);
  populate('fCat', cOpts);
  populate('fEntity', eOpts);
  populate('fKind', kOpts);

  // Apply visibility
  const g2 = document.getElementById('fGame').value,
        c2 = document.getElementById('fCat').value,
        e2 = document.getElementById('fEntity').value,
        k2 = document.getElementById('fKind').value;
  let n = 0;
  document.querySelectorAll('.card').forEach(c => {{
    const ok = (g2==='all'||c.dataset.game===g2) && (c2==='all'||c.dataset.cat===c2) &&
               (e2==='all'||c.dataset.entity===e2) && (k2==='all'||c.dataset.kind===k2);
    c.classList.toggle('hidden', !ok); if (ok) n++;
  }});
  document.getElementById('count').textContent = n + ' shown';
}}

function view(i){{
  const s = SHEETS[i];
  document.getElementById('obig').src = s.rel;
  document.getElementById('opath').textContent = s.rel;
  const fr = document.getElementById('frames');
  fr.innerHTML = (s.frames||[]).map(f =>
    '<div class="fr"><img src="'+f+'" alt=""><span>'+f.split('/').pop()+'</span></div>'
  ).join('');
  document.getElementById('overlay').style.display = 'flex';
  history.pushState({{view:i}}, '');
}}
window.addEventListener('popstate', () => {{
  document.getElementById('overlay').style.display = 'none';
}});
function closeOverlay(){{
  const ov = document.getElementById('overlay');
  if (ov.style.display === 'flex') {{
    // If we pushed a history entry for this view, go back; otherwise just hide.
    if (history.state && history.state.view !== undefined) history.back();
    else ov.style.display = 'none';
  }}
}}
document.addEventListener('keydown', e => {{ if (e.key === 'Escape') closeOverlay(); }});
cascade();
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
    main()
