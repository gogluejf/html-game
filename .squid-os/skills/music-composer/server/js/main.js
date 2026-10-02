/* main.js — boot: fetch the game's songs over HTTP (playlist order = createdAt
 * ascending, same rule as compose.py list), build the SongController, wire UI.
 * Deep link: ?game=<name>&track=<slug-or-name>. */
import { SongController } from './controller.js';
import { initUI } from './ui.js';
// Expose the Player facade to classic-script land (controller.js reads it off window).
import * as MusicPlayer from './player.js';
window.MusicPlayer = MusicPlayer;

const params = new URLSearchParams(location.search);
const game = params.get('game') || 'petal-panic';

async function loadTracks(gameName) {
  // Songs live at <repo-root>/.squid-os/music-composer/<game>/; the page is served
  // from <repo-root>/.squid-os/skills/music-composer/server/, so go up three levels.
  const dir = '../../../music-composer/' + encodeURIComponent(gameName);
  // Static file serving already exposes every song JSON; no API endpoint needed.
  const files = await fetch(dir + '/').then(async r => {
    if (!r.ok) throw new Error('no songs dir for game "' + gameName + '" (' + r.status + ')');
    const html = await r.text();
    // SimpleHTTPRequestHandler directory listing: <a href="file.json"> entries.
    const out = [];
    const re = /href="([^"]+\.json)"/g;
    let m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
  });
  const tracks = await Promise.all(files.map(f =>
    fetch(dir + '/' + f).then(r => {
      if (!r.ok) throw new Error('cannot load ' + f + ' (' + r.status + ')');
      return r.json();
    })
  ));
  // Playlist order = createdAt ascending; stable fallback to name (mirrors _load_state).
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
