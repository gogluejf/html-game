/* main.js — boot: fetch the game's songs over HTTP (playlist order = createdAt
 * ascending), compile backbone+parts pairs into engine grids, build the
 * SongController, wire UI. Deep link: ?game=<name>&track=<slug-or-name>. */
import { SongController } from './controller.js';
import { initUI } from './ui.js';
// Expose the Player facade to classic-script land (controller.js reads it off window).
import * as MusicPlayer from './player.js';
window.MusicPlayer = MusicPlayer;
import { compile } from './compiler.js';

const params = new URLSearchParams(location.search);
const game = params.get('game') || 'petal-panic';

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw null;
  return r.json();
}

async function loadTracks(gameName) {
  // Songs live at <repo-root>/.squid-os/music-composer/<game>/; the page is served
  // from <repo-root>/.squid-os/skills/music-composer/server/, so go up three levels.
  const dir = '../../../music-composer/' + encodeURIComponent(gameName);
  // List parts-*.json files (each has a matching backbones/<slug>.json).
  const files = await fetch(dir + '/').then(async r => {
    if (!r.ok) throw new Error('no songs dir for game "' + gameName + '" (' + r.status + ')');
    const html = await r.text();
    const out = [];
    const re = /href="([^"]+\.json)"/g;
    let m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
  });

  const tracks = [];
  for (const f of files) {
    if (!f.startsWith('parts-') || !f.endsWith('.json')) continue;
    const base = f.slice('parts-'.length, -'.json'.length);
    const bbFile = 'backbones/' + base + '.json';
    const backbone = await getJSON(dir + '/' + bbFile).catch(() => null);
    if (!backbone || !Array.isArray(backbone.form)) {
      console.warn('[jukebox] missing backbone for ' + f);
      continue;
    }
    const parts = await getJSON(dir + '/' + f).catch(() => null);
    if (!parts) { console.warn('[jukebox] missing parts for ' + f); continue; }
    try {
      const t = compile(backbone, parts);
      tracks.push(t);
      console.log('[jukebox] loaded:', t.name);
    } catch (e) {
      console.error('[jukebox] compile failed for ' + f, e);
    }
  }

  // Playlist order = createdAt ascending; stable fallback to name.
  tracks.sort((a, b) => {
    const ka = a.createdAt || '', kb = b.createdAt || '';
    if (ka !== kb) return ka < kb ? -1 : 1;
    return (a.name || '') < (b.name || '') ? -1 : 1;
  });
  return tracks;
}

try {
  const tracks = await loadTracks(game);
  if (tracks.length === 0) throw new Error('no songs found for game "' + game + '"');
  console.log('[jukebox] loaded ' + tracks.length + ' tracks for "' + game + '"');
  // Deep link: ?track=<slug or name> selects that song on load.
  const wantTrack = params.get('track');
  if (wantTrack) {
    const idx = tracks.findIndex(t => t.name === wantTrack || slugOf(t.name) === wantTrack);
    if (idx >= 0) {
      console.log('[jukebox] deep link -> track ' + (idx + 1) + ': ' + tracks[idx].name);
      localStorage.setItem('jukebox-prefs', JSON.stringify({ cur: idx }));
    } else {
      console.warn('[jukebox] no track matching ?track=' + wantTrack);
    }
  }
  const sc = new SongController(tracks);
  initUI(sc, game);
} catch (e) {
  console.error(e);
  document.getElementById('now').textContent = '\u2716 ' + e.message;
  document.body.style.cursor = 'default';
}

/** Slugify a track name the same way compose.py does (for ?track= deep links). */
function slugOf(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}
