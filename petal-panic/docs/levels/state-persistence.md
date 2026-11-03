# Petal Panic — State Persistence Rules (Revision)

> **Single source of truth** for what persists and what resets across every game
> transition. `game-rules.md` and `lifecycle.md` defer to this document for all
> persistence questions. Where older docs say "design-plan decision" about
> persistence, this document settles it.

## 0. The one-line model

**Failure always costs you (a life or a continue) and resets you to the
zone-entry state with full energy and no weapon. Progress never resets anything.**

## 1. The zone snapshot

Every zone entry stores a snapshot: **coins + score** (the farmable resources).

- Snapshots form an append-only chain per run: `[{zone: "1-1", coins, score}, {zone: "1-2", ...}, ...]`.
- A snapshot is taken exactly once, the instant the player enters the zone.
- The chain is what makes Continue / Save&Quit able to restore the *correct*
  state for any target zone — not just the last one.
- Energy, weapon, specials, lives, continues are NOT part of the zone snapshot
  (they are player state, handled by the transition rules below).

## 2. The rules

### 2.1 Die / Retry — costs 1 life

- Respawn: **same zone**.
- Coins + score: rolled back to that zone's entry snapshot.
- Energy: **full**.
- Weapon: **gone** (back to hero default). Specials/shield/super: cleared.
- Lives: −1. Continues: unchanged.
- World: unchanged (same seed, same arrangement).

A manual retry (pause menu) costs exactly the same as dying: 1 life, same resets.

### 2.2 Continue — costs 1 continue (when out of lives)

- Respawn: **zone 1-1 of the current level**.
- Coins + score: rolled back to zone 1-1's entry snapshot.
- Energy: **full**.
- Weapon: **gone** (default). Specials/shield/super: cleared.
- Lives: **refilled** to the starting count.
- Continues: −1.
- World: unchanged (continue never rerolls generation).

### 2.3 Pass zone → next zone

- Keep **everything**: coins, score, energy, weapon, specials, lives, continues.
- No resets of any kind. A new zone snapshot is taken at entry.

### 2.4 Pass level (boss defeated) → next level

- Keep everything (coins, score, weapon, specials, lives, continues).
- Energy: **full** (the only progress transition that touches energy).
- Lives do NOT refill on level clear.
- New level config/weights apply; world seed unchanged.

### 2.5 Save & Quit — free

Saving costs nothing and changes nothing. The save stores:

- Current zone (level + area).
- The full zone-snapshot chain up to that point.
- Player state: coins, score, energy, weapon, specials, lives, continues.
- The generation seed (exact world on reload).

### 2.6 Continue after reload (Save&Quit → Continue)

- Restores the saved zone with the saved player state (wallet, weapon, energy,
  lives, continues, score) — i.e. exactly what was on screen at quit time.
- Same semantics as §2.2 for anything the save does not carry; the saved state
  wins over any reset.

### 2.7 New game

- Reset everything. Fresh seed, fresh snapshots, starting lives/continues.

## 3. Transition table

| Transition | Cost | Respawn at | Coins/Score | Energy | Weapon | Lives | Continues |
|---|---|---|---|---|---|---|---|
| Die / Retry | 1 life | same zone | ↩ zone snapshot | full | gone | −1 | keep |
| Continue | 1 continue | zone 1-1 | ↩ 1-1 snapshot | full | gone | refill | −1 |
| Next zone | — | next zone | keep | keep | keep | keep | keep |
| Next level | — | next level 1-1 | keep | full | keep | keep | keep |
| Save & Quit | — | (no respawn) | saved | saved | saved | saved | saved |
| Reload → Continue | — | saved zone | saved | saved | saved | saved | saved |
| New game | — | level 1-1 | zero | full | default | start | start |

## 4. What this changes vs current code

1. **Weapon no longer resets on zone pass** — it already doesn't; confirmed kept.
2. **Die/retry currently rolls back to AREA entry** — stays, now explicitly
   coins+score only (energy full + weapon reset already match).
3. **Continue currently nukes the loadout AND coin tally** — becomes: rollback
   to 1-1 zone snapshot, weapon gone, energy full (matches die), lives refill.
4. **Save&Quit currently stores only `{level, area, score, seed}`** — gains the
   snapshot chain + wallet + inventory + lives + continues.
5. **Zone snapshots are currently single-slot** (`wallet.snapshot` for the last
   entered area only) — become an append-only chain keyed by zone id.
6. **Level clear currently keeps energy** — becomes energy full.

## 4b. Implementation note — the two attempt flavors

A zone entry starts an "attempt" via `startLife`, which has two flavors:

- **Failure restart** (die / manual retry / continue): wallet rollback to the
  zone snapshot, full energy, weapon/specials/shield/super cleared, respawn
  i-frames. (`startLife(h, ctx)`)
- **Advance arrival** (passing into a new zone): keeps EVERYTHING — it only
  places the hero at the new zone's entry with brief entry i-frames. No
  rollback, no refill, no inventory reset. (`startLife(h, ctx, {advance:true})`)

The area-entry presentation carries the flavor (`beginAreaEntryPresentation(advance)`);
the clear-sequence advance and debug wrap mark it as an advance, while death
restart / retry / continue use the failure flavor. This is what makes §2.3
"keep everything" hold across zone passes in actual play, not just in unit calls.

## 5. Open questions (parked)

- Boss-reward coin accounting (delta since level start) — unchanged by this doc.
- Whether converted reward coins are deducted from the spendable balance.
- Manual retry confirmation UX (costing a live must be clearly communicated).
