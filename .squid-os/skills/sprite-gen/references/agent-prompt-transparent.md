# Transparent-Regen Agent Prompt Template

Canonical prompt for the per-sheet transparent-regen sub-agent. Reuse verbatim, substituting `<SHEET>`, `<OUTNAME>`, `<TMP>`.

## Transparency is judged by ALPHA, never by how it looks

CRITICAL: A transparent PNG often LOOKS like it has a dark/warm/brown backdrop when previewed over a dark surface or in some viewers. That is VIEWER COMPOSITING, not a painted background. Do NOT reject a sheet because it "looks like it has a brown/red backdrop." Judge transparency ONLY by the alpha channel:

Run this deterministic check on the downloaded PNG:
```python
from PIL import Image
im = Image.open("<TMP>").convert("RGBA"); px = im.load(); w,h = im.size
# 1) corners + edges must be ~0 alpha
corners = [px[x,y][3] for x,y in [(2,2),(w-3,2),(2,h-3),(w-3,h-3)]]
# 2) sample the GUTTERS between sprites (midpoints of the grid) — these must be alpha 0
R,C = <ROWS>,<COLS>; cw,ch = w//C, h//R
gut = []
for r in range(R+1):
    for c in range(C+1):
        if 0<=r<R and 0<=c<C: continue
        x=min(w-1,max(0,c*cw)); y=min(h-1,max(0,r*ch))
        gut.append(px[x,y][3])
print("corners",corners,"gutters",gut)
```
- **PASS transparency** if all corners ≈ 0 AND the gutter samples are mostly 0 (a few non-zero where a sprite edge reaches is fine).
- **FAIL transparency** only if corners OR most gutters are opaque (>128) — that means a real painted fill.
- Ignore the rendered "look" entirely. A warm tint over transparency is normal and acceptable.

## Full agent prompt

Regenerate ONE sprite sheet as a clean, fully transparent PNG. Use @skill:sprite-gen.

CRITICAL BROWSER RULE: REUSE the already-open ChatGPT tab. Do NOT open a new browser tab each time. Navigate the EXISTING chatgpt.com tab to a fresh chat (goto_url https://chatgpt.com/ or click "New chat") so it's a new conversation, but keep working in that one tab. Be efficient — minimize tool calls. Do NOT loop.

IMPORTANT — RATE-LIMIT POPUP IS NON-BLOCKING: GPT often shows a "too many requests" popup BUT STILL GENERATES THE IMAGE underneath it. Do NOT treat the popup as a failure. After sending, poll for the image; if a new image appears in the chat, DOWNLOAD IT even if the popup is visible. Only wait 5 min and retry if NO new image appears after a reasonable time.

SHEET (upload this): <SHEET>
OUTPUT (save here if acceptable): /home/goglue/src/html-game/panic-petal/assets/transparent/<OUTNAME>
REGEN PROMPT SOURCE: /home/goglue/src/html-game/.squid-os/skills/sprite-gen/references/regen.md
CLI: python3 /home/goglue/src/html-game/.squid-os/skills/sprite-gen/scripts/sprite_gen.py

Steps:
1. Bootstrap browser-use. In the EXISTING ChatGPT tab, start a NEW chat. Verify logged in.
2. Upload the SHEET via the visible image file input (DOM.setFileInputFiles on the visible input[type=file][accept*=image]). Set ONCE only, sleep 3s, confirm exactly ONE attachment chip. Do NOT upload twice.
3. Read the regen prompt from REGEN PROMPT SOURCE (section after "## Prompt"). Send verbatim: sprite_gen.py send --prompt "<PROMPT>" --chat-url "https://chatgpt.com/"
4. Wait: sprite_gen.py wait --timeout 180 --expected-srcs 1. Ignore any "too many requests" popup — if an image appears, proceed. If genuinely no image after timeout, sleep 300s and retry send (max 2 waits).
5. Download: sprite_gen.py download --output <TMP>
6. Validate the DOWNLOADED new image:
   - TRANSPARENCY: run the alpha check above (corners + gutters). PASS if corners≈0 and gutters mostly 0. Do NOT fail based on how it looks in a preview.
   - CONTENT (inspect_media on the downloaded file, NOT the original): NO text/labels/numbers/grid lines; same row×col count as original; consistent scale+alignment. A thin colored edge halo is ACCEPTABLE. EXCEPTION: a wide attack/lunge pose may slightly overflow its cell — ACCEPT that and note it (trim on crop later); do not fail solely for that.
7. If acceptable -> copy <TMP> to OUTPUT named exactly "<OUTNAME>" (mkdir -p first). Do NOT overwrite the original.
8. If validation fails badly (wrong grid, labels, missing image, or a REAL painted bg per the alpha test) -> retry in a NEW chat (same tab). Max 2 retries total. After 2 failures report FAIL with reason.

If stuck, stop and report. Final report (SHORT): PASS or FAIL, output path if PASS, one-line reason if FAIL.
