# Full Screen Layout + Virtual Gamepad Option

Two new Options rows, always visible:

```
LAYOUT          FIT            ← / → cycles: FIT / FULL SCREEN   (default FIT)
VIRTUAL GAMEPAD ON  (MOBILE)   ← / → cycles: ON / OFF           (default ON)
```

## Settings shape (progressStore)

```js
settings.layout: 'fit' | 'fullscreen'   // default 'fit'
settings.virtualPad: true | false       // default true
```

Note: `layout` is a STRING setting — progressStore's settings loader currently
coerces every key as boolean; it must learn to pass strings through untouched.

## Behavior

### LAYOUT = FIT (today's behavior)
- `fitCanvas()`: contain-fit the 960×540 box into the window (letterbox bars).
- Everything renders exactly as now.

### LAYOUT = FULL SCREEN
- `fitCanvas()`: canvas fills the ENTIRE window (cover), any aspect ratio.
- The 960×540 logical box is CENTERED inside the canvas (`applyTransform`
  adds an x offset of `(canvasW - VIEW_W*s)/2`).
- Gameplay logic never changes: still 960×540 logical space, camera, collision
  all untouched. Only the display mapping differs.
- **Bleed background**: before the normal transform, paint the side strips so
  there are no black bars:
  - World/PLAY states: DECISION CHANGE (2026-10-25) — no level bg bleed. The
    level bg is gameplay scenery tied to the level, not a layout concern, and
    stretching it edge-to-edge looked wrong (esp. portrait). Gameplay keeps
    the flat `#101018` fill in both layouts; strips stay dark.
  - Menu/hub screens (HOME, MENU, SELECT, LEVEL_SELECT, BOSS_RUSH, MEDIA,
    OPTIONS, REMAP, AREA_ENTRY, REWARD, END_OF_GAME): their own gradient
    extended edge-to-edge instead of stopping at VIEW_W.
- On PC this is harmless (window ≈ 16:9 → almost no strips); on ultrawide
  monitors it just looks nicer.

### VIRTUAL GAMEPAD = ON / OFF
- ON (default): virtual pad overlay shows (touch devices only render it today;
  on PC it's inert — by design, the "(MOBILE)" label says so).
- OFF: overlay hidden everywhere.
- Independent of layout: in FULL SCREEN the pad simply floats over the bled
  background if ON. Edge-placed pad controls for full-screen mode are DEFERRED.

## Files touched

- `petal-panic/js/systems/progressStore.js` — string-typed settings support + defaults
- `petal-panic/js/main.js` — fitCanvas/applyTransform modes, bleed hook
- `petal-panic/js/systems/render.js` — world bg bleed + clip for PLAY states
- `petal-panic/js/ui/screens.js` — Options rows (cycle semantics for string row),
  menu gradients extended when in fullscreen mode
- `petal-panic/js/ui/touchControls.js` — respect settings.virtualPad
- tests: progressStore string coercion, options cycling

## Deferred (documented, not built)
- Pad re-placement for FULL SCREEN (edge anchors)
- Per-level bg parallax in the bleed strips (static cover for v1)
