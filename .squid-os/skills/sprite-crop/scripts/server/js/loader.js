// ---------- runtime project loading (replaces baked-in MANIFEST) ----------
// Fetches per-sheet JSONs from the server and builds the same entity tree the
// old render_editor.py injected:
//   { project, labels: [{ name, entities: [{ name, char, anim, row, frames:[{file,bbox}], sheetFile, croppedPath }] }] }
//
// The server serves the repo root, so:
//   /sprite-sheets/<project>/<label>/<sheet>.json  -> sheet data
//   /<cropped_path>/<frameFile>                    -> cropped frame image
//   /<sheetFile>                                   -> full sprite sheet image

import { app } from './state.js';

// Read ?project= from the URL (default petal-panic).
export function getProjectName(){
  const p = new URLSearchParams(location.search).get('project');
  return p || 'petal-panic';
}

// Best-effort directory listing. python3 -m http.server emits an HTML index with
// <a href="..."> entries; we parse those. Returns [] if the endpoint is missing.
async function listDir(path){
  try{
    const res = await fetch(path);
    if (!res.ok) return [];
    const html = await res.text();
    const out = [];
    const re = /<a[^>]+href="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null){
      let h = m[1];
      if (h === '/' || h === '../' || h.startsWith('?')) continue;
      out.push(h);
    }
    return out;
  }catch(e){
    return [];
  }
}

// Build one label's entities from a list of sheet JSON objects.
// Mirrors render_editor.build_manifest(): dedupe by name+anim, flatten frames.
function buildLabelEntities(labelName, sheets){
  const ents = [];
  const seen = new Set();
  // deterministic order: sort sheets by filename
  sheets.sort((a, b) => a._file.localeCompare(b._file));
  for (const sh of sheets){
    const cpath = sh.cropped_path || '';
    const sheetFile = sh.file || '';
    // repo-relative path of this sheet JSON (for PUT saves; see save.js)
    const sheetPath = `.squid-os/sprite-sheets/${app.project}/${labelName}/${sh._file}`;
    for (const e of (sh.entities || [])){
      const name = `${e.name || 'x'}_${e.anim || 'a'}`;
      if (seen.has(name) || !e.frames) continue;
      seen.add(name);
      const frames = e.frames.map(f => ({
        file: typeof f === 'string' ? f : f.file,
        bbox: (typeof f === 'object' && f) ? (f.bbox || null) : null,
        row: (typeof f === 'object' && f) ? (f.row ?? null) : null,
      }));
      ents.push({
        name,
        char: e.name || '',
        anim: e.anim || '',
        row: (e.frames[0] && e.frames[0].row) ?? null,
        frames,
        sheetFile,
        croppedPath: cpath,
        sheetPath,
        // existing tuning data persisted in the sheet JSON (I3/L2)
        tuning: {
          speed: e.speed ?? null,
          playback: e.playback ?? null,
          collision: e.collision ?? null,
          pivot: e.pivot ?? null,
          markers: e.markers ?? null,
          frames: (e.frames || []).map(f => ({
            offset: f.offset ?? null,
            scale: f.scale ?? null,
            boxes: f.boxes ?? null,
            durUnits: f.durUnits ?? null
          }))
        }
      });
    }
  }
  return ents;
}

// Load a whole project: enumerate labels, fetch every sheet JSON, build the tree.
export async function loadProject(projectName){
  // The server serves the repo root; sheet data lives under the hidden .squid-os dir.
  const base = `/.squid-os/sprite-sheets/${encodeURIComponent(projectName)}/`;
  const entries = await listDir(base);
  const labels = [];
  for (const entry of entries){
    if (!entry.endsWith('/')) continue;   // only subfolders are labels
    const labelName = entry.slice(0, -1);
    const files = await listDir(`${base}${encodeURIComponent(labelName)}/`);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const sheets = [];
    for (const jf of jsonFiles){
      try{
        // Cache-buster: browsers sometimes serve stale disk-cached copies even
        // with no-store headers (files cached before the header existed). The
        // editor's whole model depends on reading fresh tuning data from disk.
        const res = await fetch(`${base}${encodeURIComponent(labelName)}/${jf}?t=${Date.now()}`);
        if (!res.ok) continue;
        const sh = await res.json();
        sh._file = jf;
        sheets.push(sh);
      }catch(e){ /* skip unreadable sheet */ }
    }
    const entities = buildLabelEntities(labelName, sheets);
    if (entities.length) labels.push({ name: labelName, entities });
  }
  labels.sort((a, b) => a.name.localeCompare(b.name));
  return { project: projectName, labels };
}

// Resolve the absolute URL for a cropped frame image.
export function frameUrl(entity, frame){
  return `/${entity.croppedPath}/${frame.file}`;
}

// Resolve the absolute URL for a full sprite sheet image.
export function sheetUrl(entity){
  return `/${entity.sheetFile}`;
}

// Convenience: all frame image URLs for an entity (in frame order).
export function frameUrls(entity){
  return entity.frames.map(f => frameUrl(entity, f));
}
