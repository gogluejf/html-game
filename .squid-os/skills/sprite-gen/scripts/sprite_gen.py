#!/usr/bin/env python3
"""
sprite-gen CLI — deterministic ChatGPT sprite generation driver.

Talks to the browser-harness daemon's IPC socket (already running, single
persistent CDP connection) so we never re-trigger Chrome's "Allow remote
debugging" popup.

Subcommands:
  send       --prompt "..." [--chat-url URL]
  wait       [--timeout 120] [--expected-srcs N]
  download   --output /path/file.png
  screenshot --output /tmp/shot.png
  state      --state PATH [--set k=v ...] [--add-sheet k=v ...] [--prompt-file F]
"""
import argparse, base64, json, os, socket, sys, time

# PIL is optional — used to auto-read sheet size from the source PNG.
try:
    from PIL import Image
except ImportError:
    Image = None


def _png_size(path):
    """Return 'WxH' for a PNG at path, or None if unreadable / no PIL."""
    if Image is None:
        return None
    try:
        with Image.open(path) as im:
            w, h = im.size
        return f"{w}x{h}"
    except Exception:
        return None

# ---------------------------------------------------------------------------
# IPC to the browser-harness daemon (preferred — no popups)
# ---------------------------------------------------------------------------

def _daemon_sock():
    d = os.path.expanduser("~/.config/browser-harness/runtime")
    try:
        for f in sorted(os.listdir(d)):
            if f.endswith(".sock"):
                return os.path.join(d, f)
    except OSError:
        pass
    return None


class Harness:
    """Thin client for the browser-harness daemon IPC socket."""

    def __init__(self):
        self.sock_path = _daemon_sock()
        if not self.sock_path:
            raise RuntimeError(
                "browser-harness daemon socket not found. "
                "Run the browser-use bootstrap first."
            )

    def cdp(self, method, params=None, session_id=None, timeout=15):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect(self.sock_path)
        req = {"method": method, "params": params or {}}
        if session_id:
            req["sessionId"] = session_id
        s.sendall((json.dumps(req) + "\n").encode())
        data = b""
        while not data.endswith(b"\n"):
            chunk = s.recv(1 << 16)
            if not chunk:
                break
            data += chunk
        s.close()
        resp = json.loads(data or b"{}")
        if "error" in resp:
            raise RuntimeError(f"{method}: {resp['error']}")
        return resp.get("result", {})

    def js(self, expression, session_id=None, timeout=30):
        r = self.cdp("Runtime.evaluate",
                     {"expression": expression, "returnByValue": True, "awaitPromise": True},
                     session_id=session_id, timeout=timeout)
        res = r.get("result", {})
        if "value" in res:
            return res["value"]
        if res.get("subtype") == "error":
            raise RuntimeError(f"JS error: {res.get('description')}")
        return None

    def attach_chatgpt(self, chat_url=None):
        """Attach to the ChatGPT page (or navigate there). Returns sessionId."""
        targets = self.cdp("Target.getTargets")["targetInfos"]
        pages = [t for t in targets if t.get("type") == "page"]

        if chat_url:
            short = chat_url.split("/c/")[-1][:8] if "/c/" in chat_url else ""
            target = next((p for p in pages if short in p.get("url", "")), None)
            if target is None and pages:
                target = next((p for p in pages if "chatgpt.com" in p.get("url", "")), pages[0])
            if target is None:
                target = self.cdp("Target.createTarget", {"url": chat_url})
                time.sleep(4)
            sid = self.cdp("Target.attachToTarget",
                           {"targetId": target["targetId"], "flatten": True})["sessionId"]
            if short and short not in target.get("url", ""):
                self.cdp("Page.navigate", {"url": chat_url}, session_id=sid)
                time.sleep(4)
            return sid

        target = next((p for p in pages if "chatgpt.com" in p.get("url", "")),
                      pages[-1] if pages else None)
        if target is None:
            raise RuntimeError("No page tab found.")
        return self.cdp("Target.attachToTarget",
                        {"targetId": target["targetId"], "flatten": True})["sessionId"]


# ---------------------------------------------------------------------------
# Page-side JS helpers
# ---------------------------------------------------------------------------

JS_FIND_COMPOSER = r"""
(() => {
  const cands = [...document.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')];
  const vis = cands.filter(el => el.getBoundingClientRect().width > 50);
  const el = vis[0] || cands[cands.length-1];
  if (!el) return 'NO_INPUT';
  el.focus();
  return el.tagName === 'TEXTAREA' ? 'TEXTAREA' : 'DIV_CE';
})()
"""

JS_TYPE = r"""
(async (text) => {
  const cands = [...document.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')];
  const vis = cands.filter(el => el.getBoundingClientRect().width > 50);
  const el = vis[0] || cands[cands.length-1];
  if (!el) return 'NO_INPUT';
  el.focus();
  if (el.tagName === 'TEXTAREA') { el.value = ''; }
  else { el.innerHTML = ''; }
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch (e) {}
  if (!ok) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
  }
  el.dispatchEvent(new Event('change', {bubbles:true}));
  return 'SET:' + ((el.innerText||el.value||'').length);
})
"""

JS_VERIFY = r"""
(() => {
  const cands = [...document.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')];
  const vis = cands.filter(el => el.getBoundingClientRect().width > 50);
  const el = vis[0] || cands[cands.length-1];
  return el ? (el.innerText||el.value||'').slice(0,80) : 'EMPTY';
})()
"""

JS_SEND = r"""
(() => {
  const b = document.querySelector('button[data-testid="send-button"]')
         || [...document.querySelectorAll('button')].find(x => /send/i.test(x.getAttribute('aria-label')||''));
  if (b && !b.disabled) { b.click(); return 'CLICKED_SEND'; }
  const cands = [...document.querySelectorAll('[contenteditable="true"],textarea')];
  const el = cands.find(e=>e.getBoundingClientRect().width>50) || cands[cands.length-1];
  if (el) {
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
    return 'ENTER_FALLBACK';
  }
  return 'NO_SEND_TARGET';
})()
"""

JS_SENT_STATE = r"""
(() => {
  const cands = [...document.querySelectorAll('[contenteditable="true"],textarea')];
  const el = cands.find(e=>e.getBoundingClientRect().width>50) || cands[cands.length-1];
  const txt = el ? (el.innerText||el.value||'').trim() : '';
  const generating = !!document.querySelector('.stop-button, [data-testid*="generating"], button[aria-label*="Stop"], [data-testid*="stop"]');
  return JSON.stringify({inputLen: txt.length, generating});
})()
"""

JS_IMG_COUNT = r"""
(() => {
  const imgs=[...document.querySelectorAll('img')].filter(i=>{const r=i.getBoundingClientRect();return r.width>80&&r.height>80;});
  const srcs=new Set(imgs.map(i=>i.src));
  const generating=!!document.querySelector('.stop-button, [data-testid*="generating"], button[aria-label*="Stop"], [data-testid*="stop"]');
  return JSON.stringify({count:imgs.length, uniqueSrcs:srcs.size, generating});
})()
"""

JS_NEWEST_SRC = r"""
(() => {
  const imgs=[...document.querySelectorAll('img')].filter(i=>{const r=i.getBoundingClientRect();return r.width>80&&r.height>80;});
  const srcs=[...new Set(imgs.map(i=>i.src))];
  return srcs[srcs.length-1] || '';
})()
"""

JS_FETCH_B64 = r"""
(async (url) => {
  try {
    const r = await fetch(url, {credentials:'include'});
    if (!r.ok) return 'HTTP:'+r.status;
    const b = await r.blob();
    return await new Promise(res => { const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.readAsDataURL(b); });
  } catch(e) { return 'ERR:'+e.message; }
})
"""


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def cmd_send(args):
    h = Harness()
    sid = h.attach_chatgpt(args.chat_url)
    kind = h.js(JS_FIND_COMPOSER, sid)
    print(f"COMPOSER: {kind}")
    if kind == "NO_INPUT":
        print("ERROR: No composer input found.", file=sys.stderr); sys.exit(1)
    time.sleep(0.5)
    typed = h.js(f"({JS_TYPE})({json.dumps(args.prompt)})", sid)
    print(f"TYPE: {typed}")
    if not typed or typed.startswith("NO"):
        print("ERROR: Could not type.", file=sys.stderr); sys.exit(1)
    time.sleep(1.5)
    verify = h.js(JS_VERIFY, sid)
    print(f"VERIFY: {verify}")
    if not verify or verify == "EMPTY":
        print("ERROR: Text did not land.", file=sys.stderr); sys.exit(1)
    send_res = h.js(JS_SEND, sid)
    print(f"SEND: {send_res}")
    time.sleep(3)
    state = json.loads(h.js(JS_SENT_STATE, sid))
    print(f"AFTER SEND: {state}")
    if state.get("inputLen", -1) > 0 and not state.get("generating"):
        print("WARNING: send may have failed.", file=sys.stderr); sys.exit(2)
    print("DONE: Prompt sent.")


def cmd_wait(args):
    expected = args.expected_srcs or 999
    h = Harness()
    sid = h.attach_chatgpt()
    start = time.time()
    poll = 0
    while time.time() - start < args.timeout:
        poll += 1
        info = h.js(JS_IMG_COUNT, sid)
        d = json.loads(info) if info else {}
        elapsed = int(time.time() - start)
        print(f"poll {poll} ({elapsed}s): {info}", flush=True)
        if not d.get("generating") and d.get("uniqueSrcs", 0) >= expected:
            print(f"DONE: Generation complete after {elapsed}s"); return
        if not d.get("generating"):
            print(f"Generation stopped at {elapsed}s (uniqueSrcs={d.get('uniqueSrcs')})."); return
        time.sleep(5)
    print(f"TIMEOUT after {args.timeout}s", file=sys.stderr); sys.exit(1)


def cmd_download(args):
    h = Harness()
    sid = h.attach_chatgpt()
    newest = h.js(JS_NEWEST_SRC, sid)
    if not newest:
        print("ERROR: No images on page", file=sys.stderr); sys.exit(1)
    print("Downloading newest image...")
    b64 = h.js(f"({JS_FETCH_B64})({json.dumps(newest)})", sid, timeout=60)
    if not b64 or not isinstance(b64, str) or not b64.startswith("data:"):
        print(f"ERROR: {str(b64)[:200]}", file=sys.stderr); sys.exit(1)
    raw = b64.split(",", 1)[1]
    data = base64.b64decode(raw)
    outdir = os.path.dirname(args.output)
    if outdir: os.makedirs(outdir, exist_ok=True)
    with open(args.output, "wb") as f:
        f.write(data)
    print(f"SAVED: {args.output} ({len(data)} bytes)")


def cmd_screenshot(args):
    h = Harness()
    sid = h.attach_chatgpt()
    r = h.cdp("Page.captureScreenshot", {"format": "png"}, session_id=sid)
    data = base64.b64decode(r["data"])
    outdir = os.path.dirname(args.output)
    if outdir: os.makedirs(outdir, exist_ok=True)
    with open(args.output, "wb") as f:
        f.write(data)
    print(f"SAVED: {args.output} ({len(data)} bytes)")


def _meta_path(state_dir):
    """Meta file sits at the sprite-sheets/ level, next to the project dir."""
    state_dir = os.path.normpath(state_dir)
    return os.path.join(os.path.dirname(state_dir),
                        os.path.basename(state_dir) + ".meta.json")


def cmd_state(args):
    # --state is now a PROJECT DIR under .squid-os/sprite-sheets/, e.g.
    #   .squid-os/sprite-sheets/petal-panic/
    # It holds <label>/<sheet>.json (one file per sheet) plus <project>.meta.json.
    state_dir = os.path.normpath(args.state)
    if not state_dir.endswith("/"):
        state_dir += "/"
    proj = os.path.basename(os.path.normpath(args.state))
    meta = _meta_path(state_dir)

    # --- init subcommand ---
    if args.init:
        if os.path.exists(meta):
            print(f"ERROR: {meta} already exists. Use --set to update.", file=sys.stderr)
            sys.exit(1)
        meta_data = {
            "project": proj,
            "chat_url": args.chat_url or None,
            "palette": [],
            "assets_dir": args.assets_dir or "",
            "updated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        # fall through: --add-sheet (if given) is processed below, then meta saved once
    else:
        if args.set and not os.path.exists(meta):
            print(f"ERROR: {meta} does not exist. Run 'state --init' first.", file=sys.stderr)
            sys.exit(1)
        meta_data = json.load(open(meta)) if os.path.exists(meta) else {"project": proj}

    # --- set meta fields ---
    if args.set:
        for kv in args.set:
            key, val = kv.split("=", 1)
            allowed = {"chat_url", "style_name", "palette", "assets_dir"}
            if key not in allowed:
                print(f"ERROR: cannot set '{key}'. Allowed meta fields: {allowed}", file=sys.stderr)
                sys.exit(1)
            if key == "palette":
                meta_data[key] = val.split(",")
            else:
                meta_data[key] = val
        meta_data["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    # --- add-sheet (strict schema) -> ONE file per sheet ---
    if args.add_sheet:
        parts = dict(kv.split("=", 1) for kv in args.add_sheet)
        name = parts.pop("name")

        # Required fields ('size' is auto-read from the PNG when possible).
        required = ["file", "rows", "cols", "description", "entities"]
        missing = [r for r in required if r not in parts]
        if missing:
            print(f"ERROR: missing required fields: {missing}", file=sys.stderr)
            print(f"  Usage: --add-sheet name=X file=X rows=N cols=N description=\"...\" entities='[{{\"name\":\"X\",\"anim\":\"...\"}},...]'", file=sys.stderr)
            print(f"  Note: 'row' (optional) may be an int (single row) or an array of ints (one animation spanning multiple grid rows, e.g. \"row\":[1,2]).", file=sys.stderr)
            sys.exit(1)

        # size: prefer auto-reading from the source PNG; fall back to --size arg.
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
        file_rel = parts["file"]
        png_path = file_rel if os.path.isabs(file_rel) else os.path.join(repo_root, file_rel)
        size = _png_size(png_path)
        if size is None and "size" in parts:
            size = parts["size"]
        if size is None:
            print(f"ERROR: could not determine sheet size. Auto-read failed for '{file_rel}' "
                  f"(PIL unavailable or PNG missing) and no --size was provided.", file=sys.stderr)
            sys.exit(1)

        sheet = {}
        sheet["file"] = parts["file"]
        sheet["size"] = size
        sheet["rows"] = int(parts["rows"])
        sheet["cols"] = int(parts["cols"])
        sheet["description"] = parts["description"]

        # Parse entities JSON array
        try:
            entities = json.loads(parts["entities"])
            if not isinstance(entities, list):
                raise ValueError("entities must be a JSON array")
            for i, e in enumerate(entities):
                if not isinstance(e, dict) or "name" not in e or "anim" not in e:
                    print(f"ERROR: entities[{i}] must have 'name' and 'anim' keys", file=sys.stderr)
                    sys.exit(1)
                # 'row' is OPTIONAL provenance. When present it may be a single
                # int OR an array of ints (one animation spanning multiple grid
                # rows, e.g. a long anim laid out 2xN).
                r = e.get("row")
                if r is not None and not (isinstance(r, int) or (isinstance(r, list) and all(isinstance(x, int) for x in r))):
                    print(f"ERROR: entities[{i}].row must be an int or an array of ints", file=sys.stderr)
                    sys.exit(1)
            sheet["entities"] = entities
        except json.JSONDecodeError as je:
            print(f"ERROR: entities must be valid JSON array: {je}", file=sys.stderr)
            sys.exit(1)

        # Optional: original_prompt from file
        if getattr(args, "prompt_file", None):
            with open(args.prompt_file) as pf:
                sheet["original_prompt"] = pf.read().strip()

        # Label = the subfolder this sheet lives in (also its editor group).
        label = parts.pop("label", None)
        if not label:
            print(f"ERROR: --add-sheet requires 'label=<name>' so the sheet lands in "
                  f"<project>/<label>/<sheet>.json (the structure render_editor.py reads).",
                  file=sys.stderr)
            sys.exit(1)

        # cropped_path: where cropped frames land (defaults to <proj>/assets/<label>).
        cropped = parts.pop("cropped_path", None) or f"{proj}/assets/{label}"
        sheet["cropped_path"] = cropped

        # Reject unknown fields
        allowed_sheet_fields = {"file", "size", "rows", "cols", "description",
                                "entities", "original_prompt", "crop"}
        extra = set(parts.keys()) - allowed_sheet_fields
        if extra:
            print(f"WARNING: ignoring unknown fields: {extra}", file=sys.stderr)

        # One file per sheet, IDEMPOTENT: overwrite any existing file with the same name.
        stem = os.path.splitext(os.path.basename(sheet["file"]))[0]
        out = os.path.join(state_dir, label, stem + ".json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        verb = "replaced" if os.path.exists(out) else "added"
        with open(out, "w") as f:
            json.dump(sheet, f, indent=2)
        print(f"  {verb} sheet '{out}'")

    # --- save meta (only when it was loaded/created) ---
    if args.init or args.set:
        os.makedirs(state_dir, exist_ok=True)
        with open(meta, "w") as f:
            json.dump(meta_data, f, indent=2)
        print(f"META SAVED: {meta}")


def main():
    parser = argparse.ArgumentParser(description="ChatGPT sprite generation CLI")
    sub = parser.add_subparsers(dest="cmd")
    p = sub.add_parser("send"); p.add_argument("--prompt", required=True); p.add_argument("--chat-url")
    p = sub.add_parser("wait"); p.add_argument("--timeout", type=int, default=120); p.add_argument("--expected-srcs", type=int)
    p = sub.add_parser("download"); p.add_argument("--output", required=True)
    p = sub.add_parser("screenshot"); p.add_argument("--output", required=True)
    p = sub.add_parser("state"); p.add_argument("--state", required=True); p.add_argument("--init", action="store_true"); p.add_argument("--chat-url"); p.add_argument("--style-name"); p.add_argument("--assets-dir"); p.add_argument("--set", nargs="+"); p.add_argument("--add-sheet", nargs="+"); p.add_argument("--prompt-file")
    args = parser.parse_args()
    if not args.cmd:
        parser.print_help(); sys.exit(1)
    {"send": cmd_send, "wait": cmd_wait, "download": cmd_download,
     "screenshot": cmd_screenshot, "state": cmd_state}[args.cmd](args)


if __name__ == "__main__":
    main()
