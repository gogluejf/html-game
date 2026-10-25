# Fullscreen layout — concept, rules, and decisions

**Status:** agreed presentation rules, 2026-10-25. This is the authoritative guide; the original `.squid-os/plans/fullscreen-layout/` document is historical.

## 1. Fullscreen is a presentation mode

Options → **LAYOUT** chooses `FIT` (default) or `FULL SCREEN`. This means filling the browser viewport with the canvas, not invoking the browser Fullscreen API.

The normal logical gameplay view remains **960 × 540**, centered with uniform scaling. Fullscreen does **not** enlarge the playable world, move spawn points, change collision, extend floors, or alter camera follow/clamp rules. Extra visible space is presentation space, not permission to walk beyond authored bounds.

- **FIT:** contain-fit the canvas to the normal aspect ratio; page margins remain outside it.
- **FULL SCREEN:** canvas fills the viewport; the same logical gameplay box is centered inside it. Wide displays have extra horizontal space; portrait displays have extra vertical space.
- Rotating or changing layout changes display mapping only.
- The virtual-gamepad ON/OFF setting is independent of layout. A separate pad re-placement redesign is not part of this change.

## 2. Different layers have different rules

| Layer | Fullscreen behavior |
|---|---|
| Flat gameplay background | Fill the entire canvas. Currently `#101018`; no level background image is loaded by the layout system. |
| Gameplay geometry and world effects | Keep their original world coordinates, sizes, camera behavior, and collision. No artificial floor continuation. |
| Gameplay HUD | Anchor energy/super/weapons to the visible top-left; coins/lives/portrait to top-right. Keep widget sizes and internal spacing. |
| Menu gradients / solid backgrounds | Fill the visible surface in both orientations. Menu content remains centered in its normal logical layout. |
| Pause, credits, media dimming | Dim the entire visible surface; content remains centered. |
| Screen-space vignette, flash, screen overlay | Cover the entire visible surface, using its dimensions at draw time. |
| Death / area-clear / area-entry fades | Cover the entire visible surface. No uncovered strips during transitions. |
| Area-entry, reward, game-over, end screens | Extend background surfaces; keep titles, cards, and navigation in their normal layout. This includes entry to subsequent areas such as 1-2. |
| Boss intro | Extend the backdrop; title and foreground animation retain authored coordinates. |
| Home and its intro | Special artwork rule below: horizontally expandable scene, vertically capped. |

World-space particles, hit effects, sprite flashes, and similar entity effects must **not** be treated as screen overlays.

## 3. Home: preserve the composed scene

The Home scene has a normal **540-logical-pixel height**. In portrait it stays vertically centered, with black margins above and below. Both the scenic artwork clip and Home gradient are capped to that height.

- Do not enlarge the stage/bigtop/crowd to fill portrait height.
- Do not expose PNG pixels above/below the authored crop simply because the canvas is taller.
- Portrait retains the original artwork size and placement.
- Landscape permits horizontal coverage. Current Home scenic layers use uniform, width-driven scaling and the 540-high clip; no nonuniform image stretching.
- The logo, character foreground, and text retain their authored layout.
- PNG dimensions/transparency limit available scenery. Scaling/cropping does not generate new art; do not tile the crowd or distort it to invent missing coverage.

This deliberately differs from menus and screen effects, which can fill portrait height naturally.

## 4. Future real gameplay backgrounds — agreed, not implemented

A real level background belongs to the **level/scenery system**, not the fullscreen setting. It should exist consistently in FIT and FULL SCREEN.

Preserve its intended height, aspect ratio, and vertical crop. Reveal additional horizontal scenery when the asset supports it; do not zoom to fill portrait height. Extra vertical space may remain dark. Asset-width limits need an explicit art/scenery policy, not arbitrary stretching.

Screen-wide flashes, fades, and vignette may still cover the whole display independently of the scenic crop.

## 5. Drawing implementation

`js/core/layout.js` owns the mode, uniform fit scale, centered offsets, and shared presentation helpers:

- `surfaceBounds()` returns visible bounds in centered logical coordinates. Extra space appears as negative x/y and increased width/height.
- `fillSurface(ctx)` fills those bounds with the caller's current style and alpha, without changing the transform.
- `drawOnSurface(ctx, draw)` temporarily shifts to the full surface's top-left, supplies its width/height, and restores the context even if drawing throws. Screen effects use this path.

These helpers are for screen-space rendering after the camera transform has been restored. Never apply them inside world-space drawing just to hide a layout defect.

`main.js` clears **every canvas device pixel** under an identity transform before applying the centered logical transform each frame. This is required: clearing only the central 960×540 box leaves old objects/effects in the margins, producing persistent ghost trails. Clearing and background painting are separate responsibilities.

Current world rendering is not artificially clipped to the logical box; existing off-view geometry may be visible in the extra canvas space. This does not change world bounds or grant new movement space. Dark gaps beyond authored floor ends are accepted; do not extend collision slabs or invent decorative floor bands to conceal them.

Implementation ownership:

- `main.js`: canvas sizing, frame clear, centered transform.
- `core/layout.js`: presentation geometry and surface helpers.
- `systems/render.js`: flat background, screen effects, transition backdrops/fades.
- `systems/hud.js`: edge-anchored gameplay HUD.
- `ui/screens.js`: menu/transition backgrounds and Home's special scene crop.
- `core/remap.js`: Controls background coverage.

## 6. Regression checklist

Check FIT, wide landscape, and portrait, plus rotation and layout toggling:

1. No persistent trails in extra canvas space while moving or shaking.
2. Same gameplay camera bounds, spawn, movement, and floor geometry in both layouts.
3. Full-surface backgrounds, vignette, flash, and fades; no uncovered transition strips.
4. HUD groups at the visible top corners, unchanged widget proportions.
5. Home portrait stays 540-high with its original PNG crop; landscape retains wider coverage.
6. Menu/Controls/pause/reward/area-entry surfaces fill the canvas while content stays centered.
7. FIT appearance remains unchanged.

Automated coverage: `js/test/fullscreenSurface.test.js`, `hud83.test.js`, camera tests, and screen tests. Automated geometry checks do not replace visual inspection of artwork composition on a device.
