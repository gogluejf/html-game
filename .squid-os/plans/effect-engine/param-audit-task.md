# Task — Effect Parameterizability Audit

## Your job
Compare `petal-panic/docs/architecture/effects.md` (the concept catalog) against the actual effect code in `petal-panic/js/effects/*.js`. For every implemented effect, list its parameters and mark each as **configurable** or **hardcoded**.

## Method
1. Read `effects.md` — get each effect's "Parameters may include" list (§1–§24 + §26; skip §25 Heat Distortion, not implemented).
2. For each effect, open its file in `petal-panic/js/effects/` and find which params are actually read from `params.*` (configurable) vs baked-in constants (hardcoded).
3. Fill the table below.

## Output
One table. Columns:

| Effect | Param | Config? |
|--------|-------|---------|
| e.g. Beam | length | ✅ |
| e.g. Beam | color | ✅ |
| e.g. Particle Burst | size | ❌ |

- ✅ = readable via `params.<name>` (configurable at fire time)
- ❌ = hardcoded constant in the file (not configurable)
- Group rows by effect. One row per param.
- If an effect has NO configurable params, still list its hardcoded ones with ❌.
- Note any doc-listed param that is entirely absent from the code as ❌ with a `(missing)` tag.

## Rules
- Be accurate to the code — check the actual `params.X` reads, don't guess from the doc.
- Keep it factual. No commentary beyond the table + a short summary count at the end (e.g. "X of Y effects fully parametric; Z have gaps").
- Write the result to `petal-panic/docs/architecture/effects-param-audit.md`.
