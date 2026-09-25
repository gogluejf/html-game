// Shared mutable game state context.
// Breaks circular dependencies between world/, combat/, boss/, enemies/ modules.
// All modules read/write through this single object instead of importing each other.
export const ctx = {
  hero: null,
  collisionWorld: null,
  solids: [],
  solidEntities: [],
  realEnemies: [],
  barrels: [],
  woodBarrels: [],
  coinBarrels: [],
  powerups: [],
  checkpoints: [],
  boss: null,
  camera: null,
  world: null,
  levelZones: null,
  areaContext: null,
  floatTexts: null,
  coins: null,
  projectilePool: null,
  bossZoneDef: null,
  specialPool: null,
};
