// Core vector helpers — low-level math shared across layers (no game logic).
// The 8-way aim angle table lives here so both the input engine (core) and the
// projectile/combat layers can resolve an aim index to a spawn angle without a
// cross-layer import.

/**
 * 8-direction aim index → unit vector.
 *   0=right 1=up-right 2=up 3=up-left 4=left 5=down-left 6=down 7=down-right
 * Angle starts at "up" (-90°) and steps 45° clockwise, matching how a player
 * thinks about aiming (hold up to shoot up, up+right for up-right, etc.).
 */
const DIR_ANGLES = [
  0,               // right     (+x)
  -Math.PI / 4,    // up-right
  -Math.PI / 2,    // up        (-y)
  -3 * Math.PI / 4,// up-left
  Math.PI,         // left      (-x)
  3 * Math.PI / 4, // down-left
  Math.PI / 2,     // down      (+y)
  Math.PI / 4,     // down-right
];

/** Angle (radians) for an 8-way aim index. Exported so callers can offset spawns. */
export function dirAngle(dir) {
  return DIR_ANGLES[((dir % 8) + 8) % 8];
}
