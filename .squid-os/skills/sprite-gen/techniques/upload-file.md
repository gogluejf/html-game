# Upload a local file into ChatGPT's composer (CDP)

Proven technique (learned 2026-09-13, petal-panic transparent-regen batch).
Use when a prompt needs a **reference image** attached to the ChatGPT message
(e.g. "regenerate the sheet shown above", "match this style"). No drag-drop,
no UI clicking — push the file straight into the hidden file input via CDP.

## Recipe (browser-harness heredoc)

```bash
BU_CDP_WS="$(cat ~/.config/squid-os/browser-use.json | python3 -c 'import sys,json; print(json.load(sys.stdin)["cdp_ws"])')" \
timeout 90 browser-harness <<'PY'
import time
doc = cdp("DOM.getDocument")["root"]
r = cdp("DOM.querySelector", {
    "nodeId": doc["nodeId"],
    "selector": "input[type='file'][accept*='image']"   # ChatGPT composer's hidden input
})
ref = r.get("nodeId")
print("input nodeId:", ref)
assert ref, "No file input found — is the ChatGPT composer visible?"
cdp("DOM.setFileInputFiles", {"files": ["/ABS/PATH/to/image.png"], "nodeId": ref})
time.sleep(4)
info = js("""(() => {
  const chips = document.body.innerText.match(/platforms[_ ][^\\n]*/gi);  // adjust pattern to your filename
  return JSON.stringify({chips: chips ? chips.slice(0,3) : null});
})()""")
print("attachment check:", info)
PY
```

## Rules (learned the hard way)

1. **Set the file ONCE.** Calling `setFileInputFiles` twice attaches TWO chips — GPT then sees two images and gets confused. If you must retry, first clear the composer (select-all + delete in the input box) or start a fresh chat.
2. **SLEEP 3-5 SECONDS after setting the file — MANDATORY.** The ChatGPT engine needs time to process the upload (hash/preview/chip render). Only THEN verify **exactly ONE attachment chip** in the composer before sending. Sending too early = message goes out WITHOUT the image.
3. **NEVER kill, restart, or pkill Chrome.** If the browser or CDP session misbehaves, STOP and report — the user manages Chrome. Killing it destroys login state and all open tabs.
3. **Absolute path only** — CDP resolves it on the host, relative paths fail silently.
4. **Selector drift:** if `input[type='file'][accept*='image']` stops matching (ChatGPT UI change), enumerate candidates:
   ```python
   inputs = cdp("DOM.querySelectorAll", {"nodeId": doc["nodeId"], "selector": "input[type='file']"})
   ```
   and pick the one whose `accept` contains `image`.
5. **After upload**, send the prompt normally (`sprite_gen.py send`), wait, download — standard sprite-gen flow. The uploaded image stays in the conversation context for follow-up messages too.

## Verified working on

- Chrome via CDP port 9222 (browser-use bootstrap), ChatGPT web composer
- Files up to multi-MB PNGs (tested with 2MB+ sprite sheets)
