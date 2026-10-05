// Petal Panic — dependency-free validator for macros/macro.schema.json.
//
// JSON Schema is the formal machine-readable contract. This small validator is
// the browser/runtime enforcement path (game + Macro Editor) so validation does
// not depend on bundling Ajv. Keep it structurally aligned with the schema;
// tests validate every canonical file with BOTH this function and jsonschema.

const ID_RE = /^[A-Za-z0-9_]+$/;
const OWN = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function intAtLeast(value, min) { return Number.isInteger(value) && value >= min; }
function extraKeys(value, allowed) { return Object.keys(value).filter((k) => !allowed.has(k)); }

/**
 * Validate one macro object against macros/macro.schema.json.
 * @param {unknown} macro
 * @param {{expectedId?:string}} [opts]
 * @returns {string[]} human-readable errors; empty means valid
 */
export function macroSchemaErrors(macro, { expectedId } = {}) {
  const errors = [];
  const err = (path, message) => errors.push(`${path}: ${message}`);
  if (!object(macro)) return ['$: must be an object'];

  const topAllowed = new Set(['id','name','orientation','difficulty','units','placements','variations','follows','followedBy']);
  for (const key of extraKeys(macro, topAllowed)) err(`$.${key}`, 'unknown property');
  for (const key of topAllowed) if (!OWN(macro, key)) err('$', `missing required property "${key}"`);

  if (typeof macro.id !== 'string' || !ID_RE.test(macro.id)) err('$.id', 'must be a non-empty safe identifier');
  if (expectedId !== undefined && macro.id !== expectedId) err('$.id', `must match filename "${expectedId}.json"`);
  if (typeof macro.name !== 'string' || macro.name.length < 1) err('$.name', 'must be a non-empty string');
  if (macro.orientation !== 'horizontal' && macro.orientation !== 'vertical') err('$.orientation', 'must be horizontal or vertical');
  if (!Number.isInteger(macro.difficulty) || macro.difficulty < 1 || macro.difficulty > 3) err('$.difficulty', 'must be integer 1..3');

  if (!Array.isArray(macro.units) || macro.units.length < 1) err('$.units', 'must be a non-empty array');
  else macro.units.forEach((unit, i) => validateUnit(unit, `$.units[${i}]`, err));

  if (!Array.isArray(macro.placements)) err('$.placements', 'must be an array');
  else macro.placements.forEach((slot, i) => validatePlacement(slot, `$.placements[${i}]`, err));

  if (!Array.isArray(macro.variations)) err('$.variations', 'must be an array');
  else macro.variations.forEach((v, i) => { if (!object(v)) err(`$.variations[${i}]`, 'must be an object'); });

  for (const key of ['follows','followedBy']) {
    const value = macro[key];
    if (!Array.isArray(value)) { err(`$.${key}`, 'must be an array'); continue; }
    const seen = new Set();
    value.forEach((id, i) => {
      if (typeof id !== 'string' || !ID_RE.test(id)) err(`$.${key}[${i}]`, 'must be a safe macro id');
      if (seen.has(id)) err(`$.${key}[${i}]`, 'must be unique');
      seen.add(id);
    });
  }
  return errors;
}

function validateUnit(unit, path, err) {
  if (!object(unit)) { err(path, 'must be an object'); return; }
  if (unit.kind !== 'block' && unit.kind !== 'platform') { err(`${path}.kind`, 'must be block or platform'); return; }
  const isBlock = unit.kind === 'block';
  const allowed = new Set(isBlock ? ['kind','x','y','width','height'] : ['kind','x','y','width']);
  for (const key of extraKeys(unit, allowed)) err(`${path}.${key}`, 'unknown property');
  for (const key of allowed) if (!OWN(unit, key)) err(path, `missing required property "${key}"`);
  if (!intAtLeast(unit.x, 0)) err(`${path}.x`, 'must be a non-negative integer');
  if (!intAtLeast(unit.y, isBlock ? 0 : 1)) err(`${path}.y`, isBlock ? 'must be a non-negative integer' : 'platform row must be integer >= 1');
  if (!intAtLeast(unit.width, 1)) err(`${path}.width`, 'must be a positive integer');
  if (isBlock && !intAtLeast(unit.height, 1)) err(`${path}.height`, 'must be a positive integer');
}

function validatePlacement(slot, path, err) {
  if (!object(slot)) { err(path, 'must be an object'); return; }
  const allowed = new Set(['slot','type','x','y']);
  for (const key of extraKeys(slot, allowed)) err(`${path}.${key}`, 'unknown property');
  for (const key of allowed) if (!OWN(slot, key)) err(path, `missing required property "${key}"`);
  if (typeof slot.slot !== 'string' || slot.slot.length < 1) err(`${path}.slot`, 'must be a non-empty string');
  if (!['enemy','barrel','powerup'].includes(slot.type)) err(`${path}.type`, 'must be enemy, barrel, or powerup');
  if (!intAtLeast(slot.x, 0)) err(`${path}.x`, 'must be a non-negative integer');
  if (!intAtLeast(slot.y, 0)) err(`${path}.y`, 'must be a non-negative integer');
}

/** Throw one concise error when a macro violates the schema. */
export function assertMacroSchema(macro, opts = {}) {
  const errors = macroSchemaErrors(macro, opts);
  if (errors.length) throw new Error(`invalid macro JSON:\n${errors.join('\n')}`);
  return macro;
}
