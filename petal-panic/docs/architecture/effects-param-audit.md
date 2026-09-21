# Effect Parameterizability Audit

Compares `effects.md` (concept catalog) against actual code in `petal-panic/js/effects/*.js`.

**Legend:** ✅ = readable via `params.<name>` (configurable at fire time) · ❌ (hardcoded) = baked-in constant in code, not exposed as a param · ❌ (missing) = entirely absent from code.

---

## 1. Particle Burst / Sparks (`particleBurst.js`)

| Param | Config? |
|-------|---------|
| count | ✅ |
| size | ❌ (hardcoded) |
| speed | ❌ (hardcoded) |
| direction / spread | ❌ (hardcoded) |
| lifetime | ❌ (hardcoded) |
| gravity | ❌ (hardcoded) |
| color | ❌ (hardcoded) |
| spawn radius | ❌ (hardcoded) |

> Only `count` is configurable. All other values are baked into the shared particle pool defaults.

---

## 2. Explosion (`explosion.js`)

| Param | Config? |
|-------|---------|
| size (radius) | ✅ |
| duration | ❌ (hardcoded) |
| intensity | ❌ (hardcoded) |
| sprite / visual style | ❌ (hardcoded) |
| growth rate | ❌ (hardcoded) |
| position | ✅ (x, y) |

> `radius` and `count` are configurable; everything else is hardcoded.

---

## 3. Debris (`debris.js`)

| Param | Config? |
|-------|---------|
| fragment count | ✅ |
| initial velocity | ✅ |
| direction | ✅ |
| gravity | ✅ |
| rotation | ✅ |
| lifetime | ✅ |
| size | ✅ |

> Fully parametric. Also accepts `spread` (✅).

---

## 4. Ground Wave (`groundWave.js`)

| Param | Config? |
|-------|---------|
| direction | ✅ |
| speed | ✅ |
| distance | ✅ |
| height | ✅ |
| width | ✅ |
| duration | ✅ |
| visual style | ✅ |

> Fully parametric.

---

## 5. Shockwave (`shockwave.js`)

| Param | Config? |
|-------|---------|
| starting radius | ✅ |
| maximum radius | ✅ |
| expansion speed | ✅ |
| thickness | ✅ |
| opacity | ✅ |
| duration | ✅ |

> Fully parametric. Also accepts `color` (✅).

---

## 6. Trail (`trail.js`)

| Param | Config? |
|-------|---------|
| length | ✅ |
| width | ✅ |
| lifetime | ✅ |
| opacity | ✅ |
| density | ✅ |
| offset | ✅ |

> Fully parametric. The trail follows its carrier's actual movement — no speed param needed.

---

## 7. Afterimage / Ghost Frames (`afterimage.js`)

| Param | Config? |
|-------|---------|
| number of afterimages | ✅ |
| spawn interval | ✅ |
| lifetime | ✅ |
| opacity | ✅ |
| fade rate | ✅ |
| offset | ✅ |

> Fully parametric. Also accepts `color` (✅) and `box` (✅).

---

## 8. Telegraph Circle (`telegraphCircle.js`)

| Param | Config? |
|-------|---------|
| radius | ✅ |
| duration | ✅ |
| shrink rate | ✅ |
| opacity | ✅ |
| thickness | ✅ |
| position | ✅ (carrier origin or x/y) |
| follow target / fixed position | ✅ |

> Fully parametric. Also accepts `minRadius`, `pulseRate`, `color` (all ✅).

---

## 9. Ground Target Marker (`groundMarker.js`)

| Param | Config? |
|-------|---------|
| position | ✅ (carrier origin or x/y) |
| radius | ✅ |
| duration | ✅ |
| animation | ✅ |
| rotation | ✅ |
| pulse rate | ✅ |
| opacity | ✅ |

> Fully parametric. Also accepts `color` (✅).

---

## 10. Target Reticle (`targetReticle.js`)

| Param | Config? |
|-------|---------|
| target entity / position | ✅ (carrier origin or x/y) |
| duration | ✅ |
| size | ✅ |
| rotation speed | ✅ |
| pulse rate | ✅ |
| offset | ✅ |
| follow mode | ✅ |

> Fully parametric. Also accepts `opacity`, `color` (all ✅).

---

## 11. Damage Vignette (`vignette.js`)

| Param | Config? |
|-------|---------|
| color | ❌ (hardcoded) |
| opacity | ✅ (as `strength`) |
| duration | ❌ (hardcoded: `VIGNETTE_DECAY = 1/0.5`) |
| fade-in | ❌ (hardcoded) |
| fade-out | ❌ (hardcoded) |
| intensity | ✅ (as `strength`) |

> Only `strength` is configurable. Color, duration, and fade timing are hardcoded.

---

## 12. Sprite Flash (`spriteFlash.js`)

| Param | Config? |
|-------|---------|
| color | ✅ |
| duration | ✅ |
| flash frequency | ✅ |
| number of flashes | ✅ |
| opacity | ✅ |
| blend intensity | ✅ |

> Fully parametric. Also accepts `box` (✅).

---

## 13. Camera Shake (`cameraShake.js`)

| Param | Config? |
|-------|---------|
| intensity | ✅ |
| duration | ✅ |
| frequency | ✅ |
| horizontal strength | ✅ |
| vertical strength | ✅ |
| decay | ✅ |

> Fully parametric.

---

## 14. Screen Flash (`screenFlash.js`)

| Param | Config? |
|-------|---------|
| color | ❌ (hardcoded) |
| maximum opacity | ✅ (as `strength`) |
| duration | ❌ (hardcoded: `FLASH_DECAY = 1/0.15`) |
| fade-in | ❌ (hardcoded) |
| fade-out | ❌ (hardcoded) |

> Only `strength` is configurable. Color, duration, and fade timing are hardcoded.

---

## 15. Sprite Shake (`spriteShake.js`)

| Param | Config? |
|-------|---------|
| horizontal intensity | ✅ (as `amount`) |
| vertical intensity | ✅ (as `amount`) |
| frequency | ❌ (hardcoded) |
| duration | ❌ (hardcoded) |
| decay | ❌ (hardcoded) |

> Only `amount` is configurable. Frequency, duration, and decay are hardcoded.

---

## 16. Impact Star / Hit Pop (`impactStar.js`)

| Param | Config? |
|-------|---------|
| size | ✅ |
| duration | ✅ |
| rotation | ✅ |
| opacity | ✅ |
| style | ✅ |
| scale curve | ✅ |

> Fully parametric.

---

## 17. Fade Out (`fadeOut.js`)

| Param | Config? |
|-------|---------|
| starting opacity | ✅ |
| ending opacity | ✅ |
| duration | ✅ |
| delay | ✅ |
| fade curve | ✅ |

> Fully parametric. Also accepts `box` (✅).

---

## 18. Scale / Pulse (`scalePulse.js`)

| Param | Config? |
|-------|---------|
| starting scale | ✅ |
| maximum scale | ✅ |
| minimum scale | ✅ |
| duration | ❌ (derived: `loopCount / pulseFrequency`) |
| pulse frequency | ✅ |
| loop count | ✅ |

> Nearly fully parametric. `duration` is derived from loop count × pulse period, not directly settable. Also accepts `delay` (✅), `box` (✅).

---

## 19. Squash & Stretch (`squashStretch.js`)

| Param | Config? |
|-------|---------|
| X scale | ✅ |
| Y scale | ✅ |
| duration | ✅ |
| recovery duration | ✅ |
| intensity | ✅ |

> Fully parametric. Also accepts `delay` (✅), `box` (✅).

---

## 20. Dust Cloud (`dustCloud.js`)

| Param | Config? |
|-------|---------|
| particle count | ✅ |
| spread | ✅ |
| size | ✅ |
| velocity | ✅ |
| lifetime | ✅ |
| opacity | ✅ |
| gravity | ✅ |

> Fully parametric.

---

## 21. Attack Arc / Slash (`attackArc.js`)

| Param | Config? |
|-------|---------|
| arc angle | ✅ |
| radius | ✅ |
| thickness | ✅ |
| duration | ✅ |
| orientation | ✅ |
| opacity | ✅ |
| follow entity | ✅ |

> Fully parametric. Also accepts `sweepDirection`, `color` (all ✅).

---

## 22. Aura / Glow (`auraGlow.js`)

| Param | Config? |
|-------|---------|
| radius | ✅ |
| opacity | ✅ |
| pulse rate | ✅ |
| intensity | ✅ |
| color | ✅ |
| duration | ✅ |
| offset | ✅ |

> Fully parametric.

---

## 23. Screen Overlay (`screenOverlay.js`)

| Param | Config? |
|-------|---------|
| color | ✅ |
| opacity | ✅ |
| duration | ✅ |
| fade-in | ✅ |
| fade-out | ✅ |
| blend mode | ✅ |

> Fully parametric.

---

## 24. Composite Explosion Burst (`compositeExplosion.js`)

| Param | Config? |
|-------|---------|
| radius / area | ✅ |
| explosion count | ✅ |
| spawn interval | ✅ |
| random timing variance | ✅ |
| random position variance | ✅ |
| child effect | ✅ |
| child size range | ✅ |
| duration | ✅ |
| density | ✅ |

> Fully parametric.

---

## 26. Beam (`beam.js`)

| Param | Config? |
|-------|---------|
| length | ✅ |
| width | ✅ |
| halo / gradient radius | ✅ |
| color | ✅ |
| ignition time (flash-in) | ✅ |
| fade-out time | ✅ |
| hold time | ❌ (not implemented — deferred to v2) |
| origin | ✅ (carrier origin or x/y) |
| orientation | ✅ |

> Nearly fully parametric. `holdTime` has no code path at all (deferred per scope section). Also accepts `opacity`, `coreAlpha` (all ✅).

---

## Summary

**18 of 25 effects** are fully or nearly fully parametric (all doc-listed params configurable).

**7 effects have gaps:**

| Effect | ❌ (hardcoded) | ❌ (missing) |
|--------|---------------|------------|
| Particle Burst | size, speed, direction/spread, lifetime, gravity, color, spawn radius | — |
| Explosion | duration, intensity, sprite/visual style, growth rate | — |
| Damage Vignette | color, duration, fade-in, fade-out | — |
| Screen Flash | color, duration, fade-in, fade-out | — |
| Sprite Shake | frequency, duration, decay | — |
| Scale / Pulse | duration (derived) | — |
| Beam | — | hold time |

The gaps cluster around: (a) the two screen-space overlays (vignette, screen flash) which share a minimal `strength`-only API, (b) the legacy particle-pool effects (particle burst, explosion) that predate full parameterization, and (c) sprite shake which uses a single `amount` scalar. These are candidates for the next parameterization pass.
