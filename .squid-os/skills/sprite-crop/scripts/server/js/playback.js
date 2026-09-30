// ---------- playback: tick loop, play/pause, frame step, fps ----------
import { app, ROT_MAX_VEL, ROT_ACCEL, ROT_DECEL } from './state.js';
import { $ } from './viewport.js';
import { curFrameIdx, editingLocked } from './geometry.js';
import { draw } from './draw.js';
import { syncPanel, setRotSpeed } from './panel.js';
import { buildTimingTable } from './timing.js';
import { saveState } from './save.js';
import { syncToggles } from './tools.js';
import { pushUndo } from './undo.js';

export function startPlayback(){
  requestAnimationFrame(tick);
}

function tick(t){
  requestAnimationFrame(tick);
  if (!app.cur || !app.cur.st){ app.lastT = t; return; }
  const dt = (t-app.lastT)/1000; app.lastT = t;
  // frame animation — unit-based accumulator
  if (app.cur.st.playing){
    app.acc += dt * app.cur.st.speed;   // accumulate in UNITS (1 unit = 1/fps seconds)
    const fi = curFrameIdx();
    const units = app.cur.st.frames[fi].durUnits || 1;
    if (app.acc >= units){
      app.acc -= units;
      const next = fi + 1;
      if (next >= app.cur.st.frames.length){
        if ((app.cur.st.playback || 'loop') === 'once'){
          // stop at final frame
          app.cur.st.frameIdx = app.cur.st.frames.length - 1;
          setPlaying(false);
          app.acc = 0;
        } else {
          app.cur.st.frameIdx = 0;
        }
      } else {
        app.cur.st.frameIdx = next;
      }
      app._selectedBox = null;   // clear box selection on frame change
      syncPanel(); draw();
    }
  } else { app.acc = 0; }
  // lightweight current-frame highlight update (avoids full table rebuild at 60fps)
  const _tbl = $('timingTable');
  if (_tbl){
    const rows = _tbl.children;
    const fi = curFrameIdx();
    for (let r = 0; r < rows.length; r++){
      rows[r].classList.toggle('current', r === fi);
    }
  }
  // rotation (independent of frame anim)
  if (app.cur.st.rot){
    // hold-to-rotate: accelerate while held, coast-decel after release
    if (app.rotHold){
      app.rotHold.t += dt;
      app.rotHold.vel = Math.min(ROT_MAX_VEL, app.rotHold.vel + ROT_ACCEL * dt);
      app.cur.st.rot.angle = ((app.cur.st.rot.angle + app.rotHold.dir * app.rotHold.vel * dt) % 360 + 360) % 360;
    } else if (app.lastRotVel > 0.5){
      // coasting: decelerate velocity, keep spinning in last direction
      app.cur.st.rot.angle = ((app.cur.st.rot.angle + app.lastRotDir * app.lastRotVel * dt) % 360 + 360) % 360;
      app.lastRotVel = Math.max(0, app.lastRotVel - ROT_DECEL * dt);
      if (app.lastRotVel <= 0.5) app.lastRotVel = 0;
    }
    if (app.cur.st.rot.playing){
      app.rotAcc += dt;
      const rstep = 1/60;
      while (app.rotAcc >= rstep){
        app.rotAcc -= rstep;
        app.cur.st.rot.angle = (app.cur.st.rot.angle + app.cur.st.rot.speed * rstep) % 360;
      }
    } else { app.rotAcc = 0; }
    $('rotAngle').textContent = Math.round(app.cur.st.rot.angle)+'\u00B0';
    P('p_rangle').value = Math.round(app.cur.st.rot.angle);
    draw();
  }
}

const P = id => $(id);

export function setPlaying(p){
  if(!app.cur || !app.cur.st) return;
  app.cur.st.playing = !!p;
  app.isPlaying = !!p;
  if (p) app.acc = 0;   // fresh start: no leftover accumulation
  $('playIco').innerHTML = app.cur.st.playing ? '&#10074;&#10074;' : '&#9654;';
  syncPanelDisabled();   // lock/unlock side inputs with play state
  syncToggles();   // update MELEE ON disabled state immediately
  saveState();
}

export function stepFrame(d){ if(!app.cur||!app.cur.st)return; const st=app.cur.st; st.frameIdx=(st.frameIdx+d+st.frames.length)%st.frames.length; app.acc=0; app._selectedBox=null; syncPanel(); draw(); }

export function setSpeed(v){ if(!app.cur||!app.cur.st)return; app.cur.st.speed = Math.max(1, Math.min(60, v|0)); $('fpsval').textContent = app.cur.st.speed+' fps'; $('p_speed').value = app.cur.st.speed; saveState(); buildTimingTable(); }

// Enable/disable side-panel inputs: locked while animating
const PANEL_EDITABLE = ['p_speed','p_ox','p_oy','p_sx','p_sy','p_kx','p_ky','p_kw','p_kh','p_px','p_py','p_rspeed'];
export function syncPanelDisabled(){
  if (!app.cur || !app.cur.st) return;
  const locked = editingLocked();
  for (const id of PANEL_EDITABLE) P(id).disabled = locked;
  // melee box inputs
  const list = $('meleeBoxList');
  if (list) list.querySelectorAll('input').forEach(inp => { inp.disabled = locked; });
}
