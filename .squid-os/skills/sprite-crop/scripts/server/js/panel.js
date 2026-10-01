// ---------- side panel: sync + number inputs ----------
import { app } from './state.js';
import { $ } from './viewport.js';
import { curFrameIdx, editingLocked } from './geometry.js';
import { shiftAll, scaleAllAbout } from './rigidbody.js';
import { draw } from './draw.js';
import { buildMeleeBoxList } from './meleeBoxes.js';
import { buildMarkerList } from './markers.js';
import { setPlaying, setSpeed, syncPanelDisabled } from './playback.js';
import { syncPlaybackButtons, buildTimingTable } from './timing.js';
import { syncToggles } from './tools.js';
import { pushUndo } from './undo.js';
import { markGameDataChanged } from './save.js';

const P = id => $(id);

// wrap panel number inputs with custom spinner arrows (native ones are hidden)
export function initPanelSpinners(){
  document.querySelectorAll('#panel input[type=number]').forEach(inp=>{
    const wrap = document.createElement('span');
    wrap.className = 'numwrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const arr = document.createElement('span');
    arr.className = 'arr';
    arr.innerHTML = '<span class="up"></span><span class="dn"></span>';
    wrap.appendChild(arr);
    const step = () => parseFloat(inp.step) || 1;
    arr.querySelector('.up').addEventListener('click', ()=>{ inp.value=(parseFloat(inp.value)||0)+step(); inp.dispatchEvent(new Event('change')); });
    arr.querySelector('.dn').addEventListener('click', ()=>{ inp.value=(parseFloat(inp.value)||0)-step(); inp.dispatchEvent(new Event('change')); });
    // arrow-key stepping
    inp.addEventListener('keydown', e=>{
      if (e.key==='ArrowUp'||e.key==='ArrowDown'){
        e.preventDefault();
        const d = e.key==='ArrowUp' ? step() : -step();
        inp.value = (parseFloat(inp.value)||0) + d;
        inp.dispatchEvent(new Event('change'));
      }
    });
  });
}

export function syncPanel(){
  if (!app.cur || !app.cur.st) return;
  const st = app.cur.st, fi = curFrameIdx(), f = st.frames[fi];
  const _curEn = (() => { for (const l of app.manifest.labels) for (const e of l.entities) if (e.name===app.cur.name) return e; return null; })();
  P('p_stitle').textContent = _curEn ? (_curEn.char + ' — ' + _curEn.anim) : app.cur.name;
  P('p_acount').value = st.frames.length;
  P('p_speed').value = st.speed; $('fpsval').textContent = st.speed+' fps';
  P('p_fidx').textContent = (fi+1)+' / '+st.frames.length;
  P('p_fname').textContent = f.name;
  P('p_cx').value=f.crop.x; P('p_cy').value=f.crop.y; P('p_cw').value=f.crop.w; P('p_ch').value=f.crop.h;
  P('p_ox').value=f.offset.x; P('p_oy').value=f.offset.y;
  P('p_sx').value=f.scale.sx; P('p_sy').value=f.scale.sy;
  P('p_kx').value=st.collision.x; P('p_ky').value=st.collision.y; P('p_kw').value=st.collision.w; P('p_kh').value=st.collision.h;
  if (st.pivot){ P('p_px').value=st.pivot.x; P('p_py').value=st.pivot.y; }
  if (st.rot){ P('p_rangle').value=Math.round(st.rot.angle); P('p_rspeed').value=st.rot.speed; $('rotSpeedVal').textContent=st.rot.speed+'\u00B0/s'; $('rotAngle').textContent=Math.round(st.rot.angle)+'\u00B0'; $('rotIco').innerHTML=st.rot.playing?'&#10074;&#10074;':'&#9654;'; }
  buildMeleeBoxList();
  buildMarkerList();
  setPlaying(st.playing);
  syncPlaybackButtons();
  buildTimingTable();
  syncPanelDisabled();
  syncToggles();
}

export function bindNum(id, fn){ P(id).addEventListener('change', ()=>{ const v=parseFloat(P(id).value); if(!isNaN(v)&&app.cur&&app.cur.st&&!editingLocked()){ pushUndo(); fn(v); draw(); markGameDataChanged(); } else syncPanel(); }); }

export function initPanelBindings(){
  bindNum('p_speed', v=>setSpeed(v));
  bindNum('p_ox', v=>{ const st=app.cur.st, fi=curFrameIdx(); const d=v-st.frames[fi].offset.x; if(app.show.allFrames) shiftAll(d,0); else st.frames[fi].offset.x+=d; });
  bindNum('p_oy', v=>{ const st=app.cur.st, fi=curFrameIdx(); const d=v-st.frames[fi].offset.y; if(app.show.allFrames) shiftAll(0,d); else st.frames[fi].offset.y+=d; });
  bindNum('p_sx', v=>{ const st=app.cur.st, fi=curFrameIdx(); const r=Math.max(.05,v)/st.frames[fi].scale.sx; if(app.show.allFrames) scaleAllAbout(r,1); else st.frames[fi].scale.sx=Math.max(.05,st.frames[fi].scale.sx*r); });
  bindNum('p_sy', v=>{ const st=app.cur.st, fi=curFrameIdx(); const r=Math.max(.05,v)/st.frames[fi].scale.sy; if(app.show.allFrames) scaleAllAbout(1,r); else st.frames[fi].scale.sy=Math.max(.05,st.frames[fi].scale.sy*r); });
  bindNum('p_kx', v=>app.cur.st.collision.x=v);
  bindNum('p_ky', v=>app.cur.st.collision.y=v);
  bindNum('p_kw', v=>app.cur.st.collision.w=Math.max(1,v));
  bindNum('p_kh', v=>app.cur.st.collision.h=Math.max(1,v));
  bindNum('p_px', v=>{ if(app.cur.st.pivot) app.cur.st.pivot.x=v; });
  bindNum('p_py', v=>{ if(app.cur.st.pivot) app.cur.st.pivot.y=v; });
  bindNum('p_rspeed', v=>{ if(app.cur.st.rot) setRotSpeed(v); });
}

export function setRotSpeed(v){
  if (!app.cur || !app.cur.st) return;
  app.cur.st.rot.speed = Math.max(1, Math.min(360, v|0));
  $('rotSpeedVal').textContent = app.cur.st.rot.speed+'\u00B0/s';
}
