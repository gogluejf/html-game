/* ui.js — DOM wiring for the jukebox: playlist, transport bar, side panel,
 * timeline scrubbing, keyboard shortcuts. Ported from the standalone template;
 * receives the SongController + game name and owns all element references. */

// Format an ISO datetime (e.g. 2026-09-17T06:19:54) as "Sep 17, 2026 · 6:19 AM".
export function fmtDate(iso) {
  if (!iso) return '\u2013';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return mon + ' ' + d.getDate() + ', ' + d.getFullYear() + ' \u00b7 ' + h + ':' + m + ' ' + ampm;
}

// Per-genre color palette so each style gets its own hue in the list + panel.
// Normalizes the genre string, then matches against known styles; falls back to
// a hash-based pick from the palette so unseen genres still get a stable color.
const GENRE_COLORS = [
  ['#ff5d5d', 'rgba(255,93,93,.14)'],   // red
  ['#ffa040', 'rgba(255,160,64,.14)'],  // orange
  ['#ffe23e', 'rgba(255,226,62,.14)'],  // gold
  ['#a8e05f', 'rgba(168,224,95,.14)'],  // lime
  ['#5fe08a', 'rgba(95,224,138,.14)'],  // green
  ['#3ef0c8', 'rgba(62,240,200,.14)'],  // teal
  ['#3ef0ff', 'rgba(62,240,255,.14)'],  // cyan
  ['#5aa8ff', 'rgba(90,168,255,.14)'],  // blue
  ['#8a7bff', 'rgba(138,123,255,.14)'], // indigo
  ['#c86bff', 'rgba(200,107,255,.14)'], // purple
  ['#ff6bd6', 'rgba(255,107,214,.14)'],// pink
  ['#ff8fb0', 'rgba(255,143,176,.14)'] // rose
];
// Explicit keyword -> palette index for the common styles we actually use.
const GENRE_KEYWORDS = {
  metal:0, thrash:0, punk:1, 'speed punk':1, 'punk metal':1, speed:0,
  trance:6, techno:6, dubstep:9, industrial:9, breakbeat:7, electro:7,
  jazz:2, 'acid jazz':2, fusion:2, bossa:4, reggae:4, funk:3, soul:3,
  chiptune:5, 'drum and bass':5, '8-bit':5, march:8, anthem:8, dirge:11,
  gothic:11, darkwave:10, ambient:10, horror:11, baroque:8, celtic:4,
  folk:4, psych:10, psychedelic:10, disco:2, house:6, tropical:6,
  neoclassical:7, lofi:3, 'lo-fi':3, hip:3, waltz:11
};
export function genreColor(genre) {
  if (!genre) return null;
  const g = String(genre).toLowerCase();
  // Exact keyword hit first.
  if (GENRE_KEYWORDS[g] != null) return GENRE_COLORS[GENRE_KEYWORDS[g]];
  // Then substring match (longest keyword wins).
  let best = -1, bestLen = 0;
  for (const k in GENRE_KEYWORDS) {
    if (g.indexOf(k) !== -1 && k.length > bestLen) { best = GENRE_KEYWORDS[k]; bestLen = k.length; }
  }
  if (best >= 0) return GENRE_COLORS[best];
  // Fallback: stable hash into the palette.
  let h = 0; for (let i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) >>> 0;
  return GENRE_COLORS[h % GENRE_COLORS.length];
}

export function initUI(sc, gameName) {
  const nowEl = document.getElementById('now');
  const listEl = document.getElementById('list');
  const tbPrev = document.getElementById('tb-prev');
  const tbPlay = document.getElementById('tb-play');
  const tbNext = document.getElementById('tb-next');
  const tlEl = document.getElementById('timeline');
  const tlProg = document.getElementById('tl-progress');
  const tlDot = document.getElementById('tl-dot');
  const tlTime = document.getElementById('tl-time');
  const mtSeq = document.getElementById('mt-seq');
  const mtRep = document.getElementById('mt-rep');
  const mtShf = document.getElementById('mt-shf');
  const playIcon = document.getElementById('play-icon');
  const tlTitle = document.getElementById('tl-title');
  const sidePanel = document.getElementById('side-panel');
  const spTitle = document.getElementById('sp-title');
  const spGenre = document.getElementById('sp-genre');
  const spBpm = document.getElementById('sp-bpm');
  const spFav = document.getElementById('sp-fav');
  const spCreated = document.getElementById('sp-created');
  const spRevision = document.getElementById('sp-revision');
  const spVibe = document.getElementById('sp-vibe');

  function renderSidePanel() {
    const t = sc.tracks[sc.current];
    if (!t) { sidePanel.classList.add('hidden'); return; }
    sidePanel.classList.remove('hidden');
    spTitle.textContent = t.name || '\u2013';
    spGenre.textContent = t.genre || '\u2013';
    const gc = genreColor(t.genre);
    if (gc) { spGenre.style.color = gc[0]; spGenre.style.background = gc[1]; spGenre.style.borderColor = gc[0] + '66'; }
    else { spGenre.style.color = ''; spGenre.style.background = ''; spGenre.style.borderColor = ''; }
    spBpm.textContent = (t.bpm != null ? t.bpm + ' BPM' : '\u2013');
    const fav = sc.isFav(sc.current);
    spFav.classList.toggle('on', fav);
    spFav.innerHTML = sc._heartSVG(fav);
    spFav.title = fav ? 'Unfavorite' : 'Favorite';
    spCreated.textContent = fmtDate(t.createdAt);
    spRevision.textContent = (t.revision != null ? 'r' + t.revision : '\u2013');
    spVibe.textContent = (t.vibe && String(t.vibe).trim()) ? t.vibe : '\u2013';
    spVibe.title = (t.vibe && String(t.vibe).trim()) ? t.vibe : '';
  }

  // Refresh only the side-panel heart (used by toggleFav so list + panel stay in sync).
  window.__syncSpFav = function() {
    const fav = sc.isFav(sc.current);
    spFav.classList.toggle('on', fav);
    spFav.innerHTML = sc._heartSVG(fav);
    spFav.title = fav ? 'Unfavorite' : 'Favorite';
  };
  spFav.addEventListener('click', () => { sc.toggleFav(sc.current); });

  // Track change → update list highlight + now-playing label + side panel
  sc.onTrackChange = (i) => {
    const names = sc.tracks.map(t => t.name);
    nowEl.textContent = '\u25cf NOW PLAYING: ' + (i+1) + ' ' + names[i];
    tlTitle.textContent = (i+1) + '. ' + names[i];
    renderList();
    renderSidePanel();
  };
  sc.onPlayStateChange = (playing) => {
    if (!playing && sc._startTime === null) {
      nowEl.textContent = '\u23f8 PAUSED';
    }
  };

  let _listTimer = null, _listCount = 0, _listIdx = 0;
  function renderList() {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    listEl.innerHTML = sc.tracks.map((t, i) => {
      const gc = genreColor(t.genre);
      const genreStyle = gc ? 'style="color:' + gc[0] + ';background:' + gc[1] + ';border-color:' + gc[0] + '55"' : '';
      const fav = sc.isFav(i);
      return '<div class="row ' + (i === sc.current ? 'on' : '') + '" data-i="' + i + '">' +
        '<span class="num">' + (i+1) + '</span>' +
        '<span class="nm" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
        '<span class="chips">' +
          (t.genre ? '<span class="chip genre" ' + genreStyle + '>' + esc(t.genre) + '</span>' : '') +
        '</span>' +
        (t.bpm != null ? '<span class="bpm">' + t.bpm + ' BPM</span>' : '') +
        '<span class="fav' + (fav ? ' on' : '') + '" title="' + (fav ? 'Unfavorite' : 'Favorite') + '">' + sc._heartSVG(fav) + '</span>' +
      '</div>';
    }).join('');
    listEl.querySelectorAll('.row').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.i, 10);
        _listIdx = i;
        // Already playing → single click switches song immediately.
        if (sc.playing) { sc.play(i); return; }
        // Not playing → single click selects (highlight, dot to 0), double plays.
        _listCount++;
        if (_listCount === 1) {
          sc.select(i);
          nowEl.textContent = '\u25cb SELECTED: ' + (i+1) + ' ' + sc.tracks[i].name;
          _listTimer = setTimeout(() => { _listCount = 0; }, 400);
        } else if (_listCount >= 2) {
          clearTimeout(_listTimer);
          _listCount = 0;
          sc.play(i);
        }
      });
      // Heart toggles favorite without triggering play/select.
      const favEl = el.querySelector('.fav');
      if (favEl) favEl.addEventListener('click', (e) => {
        e.stopPropagation();
        sc.toggleFav(parseInt(el.dataset.i, 10));
      });
    });
  }

  // Prev button: single=restart current, double=previous song (1s grace).
  // Shared with the Left-arrow key so both behave identically.
  function onPrevClick() {
    sc.prevSmart();
  }
  tbPrev.addEventListener('click', e => { onPrevClick(); e.currentTarget.blur(); });
  tbPlay.addEventListener('click', e => { sc.togglePause(); e.currentTarget.blur(); });
  tbNext.addEventListener('click', e => { sc.next(); e.currentTarget.blur(); });
  mtSeq.addEventListener('click', e => { sc.setMode('seq'); syncModes(); e.currentTarget.blur(); });
  mtRep.addEventListener('click', e => { sc.setMode('rep'); syncModes(); e.currentTarget.blur(); });
  mtShf.addEventListener('click', e => { sc.setMode('shf'); syncModes(); e.currentTarget.blur(); });

  function syncModes() {
    mtSeq.classList.toggle('on', sc.seq);
    mtRep.classList.toggle('on', sc.rep);
    mtShf.classList.toggle('on', sc.shf);
  }

  // Keyboard (mirrors the transport buttons exactly)
  window.addEventListener('keydown', e => {
    // If a transport button still has focus, let the browser's native Space/Enter
    // activation handle it — otherwise we'd double-toggle. (blur() on click above
    // normally prevents this; this is a safety net.)
    const btnFocused = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if (e.code === 'Space' || e.code === 'Enter') {
      if (btnFocused) return;   // native button activation will fire the same action
      e.preventDefault(); sc.togglePause();
      return;
    }
    if (e.code === 'KeyP') { e.preventDefault(); sc.next(); }
    else if (e.code === 'ArrowDown' || e.code === 'ArrowRight') { e.preventDefault(); sc.next(); }
    else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') { e.preventDefault(); onPrevClick(); }
    else if (e.code === 'KeyM') { sc.toggleMute(); }
    else if (e.code === 'KeyS') { e.preventDefault(); sc.setMode('seq'); syncModes(); }
    else if (e.code === 'KeyR') { e.preventDefault(); sc.setMode('rep'); syncModes(); }
    else if (e.code === 'KeyH') { e.preventDefault(); sc.setMode('shf'); syncModes(); }
    else if (e.code === 'KeyL') { e.preventDefault(); sc.toggleLog(); }
  });

  // ── Timeline rendering (reads from sc.position()) ────────────────────────
  (function buildTimeline() {
    const divs = document.getElementById('tl-dividers');
    const labels = document.getElementById('phrase-labels');
    const names = ['0','0b','1','1b','2','3','4','tag'];
    for (let i = 0; i < 8; i++) {
      const d = document.createElement('div'); d.className = 'div'; divs.appendChild(d);
      const l = document.createElement('span'); l.textContent = names[i]; labels.appendChild(l);
    }
  })();

  function fmt(s) {
    const m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  // Main render loop. One rule: show sc.position(). While playing that reads the
  // live engine position; while paused/stopped it honors a manual dot placement
  // (_manualPos) and otherwise freezes at the paused audio position. No clobbering.
  setInterval(() => {
    const p = sc.position();
    tlDot.style.left = (p * 100) + '%';
    tlProg.style.width = (p * 100) + '%';
    const dur = sc.duration();
    tlTime.textContent = fmt(p * dur) + ' / ' + fmt(dur);
    // Side-panel mirror (skip while user is dragging its dot)
    if (!spDragging) {
      spTlDot.style.left = (p * 100) + '%';
      spTlProg.style.width = (p * 100) + '%';
    }
    spTimeCur.textContent = fmt(p * dur);
    spTimeDur.textContent = fmt(dur);
    if (sc.playing) {
      playIcon.innerHTML = '<rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/>';
      spPlayIcon.innerHTML = '<rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/>';
      tbPlay.classList.remove('paused');
      spPlay.classList.remove('paused');
    } else {
      playIcon.innerHTML = '<polygon points="7 4 20 12 7 20 7 4"/>';
      spPlayIcon.innerHTML = '<polygon points="7 4 20 12 7 20 7 4"/>';
      tbPlay.classList.add('paused');
      spPlay.classList.add('paused');
    }
  }, 50);

  // Drag dot → seek
  let dragging = false;
  tlDot.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); e.stopPropagation(); });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const r = tlEl.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    tlDot.style.left = (f * 100) + '%';
    tlProg.style.width = (f * 100) + '%';
  });
  window.addEventListener('mouseup', e => {
    if (!dragging) return;
    dragging = false;
    const r = tlEl.getBoundingClientRect();
    sc.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  });
  tlEl.addEventListener('click', e => {
    if (dragging) return;
    const r = tlEl.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    sc.seek(f);
  });

  /* ── Side-panel transport: bigger controls + simple line scrubber ─────── */
  const spPrev = document.getElementById('sp-prev');
  const spPlay = document.getElementById('sp-play');
  const spNext = document.getElementById('sp-next');
  const spPlayIcon = document.getElementById('sp-play-icon');
  const spTlEl = document.getElementById('sp-timeline');
  const spTlProg = document.getElementById('sp-tl-progress');
  const spTlDot = document.getElementById('sp-tl-dot');
  const spTimeCur = document.getElementById('sp-time-cur');
  const spTimeDur = document.getElementById('sp-time-dur');
  spPrev.addEventListener('click', e => { onPrevClick(); e.currentTarget.blur(); });
  spPlay.addEventListener('click', e => { sc.togglePause(); e.currentTarget.blur(); });
  spNext.addEventListener('click', e => { sc.next(); e.currentTarget.blur(); });
  let spDragging = false;
  function _spSeekFromEvent(e) {
    const r = spTlEl.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }
  spTlDot.addEventListener('mousedown', e => { spDragging = true; e.preventDefault(); e.stopPropagation(); });
  spTlEl.addEventListener('mousedown', e => {
    if (e.target === spTlDot) return;
    spDragging = true;
    sc.seek(_spSeekFromEvent(e));
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!spDragging) return;
    const f = _spSeekFromEvent(e);
    spTlDot.style.left = (f * 100) + '%';
    spTlProg.style.width = (f * 100) + '%';
  });
  window.addEventListener('mouseup', e => {
    if (!spDragging) return;
    spDragging = false;
    sc.seek(_spSeekFromEvent(e));
  });

  // Initial render + restore saved mode prefs to UI
  document.getElementById('title').textContent = 'Music for ' + gameName;
  renderList();
  renderSidePanel();
  syncModes();
  // Populate the transport-bar title for the initially-selected track.
  // onTrackChange only fires on a *change*, so the first song's title would
  // otherwise stay blank until the user switches songs.
  tlTitle.textContent = (sc.current + 1) + '. ' + sc.tracks[sc.current].name;
  nowEl.textContent = '\u25cb READY: ' + (sc.current + 1) + ' ' + sc.tracks[sc.current].name;
}

