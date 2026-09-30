// ---------- toolbar (display toggles) + background color picker ----------
import { app, _bgState } from './state.js';
import { $ } from './viewport.js';
import { draw } from './draw.js';
import { setPlaying } from './playback.js';
import { addMeleeBox } from './meleeBoxes.js';
import { cancelHideMode } from './markers.js';
import { saveState } from './save.js';

export function syncToggles(){
  $('tglCollision').classList.toggle('on', app.show.collision);
  $('tglMeleeView').classList.toggle('on', app.show.meleeView);
  $('tglAxes').classList.toggle('on', app.show.axes);
  $('tglGrid').classList.toggle('on', app.show.grid);
  $('tglSpriteView').classList.toggle('on', app.show.spriteView);
  const afBtn = $('tglAllFrames');
  if (afBtn){
    afBtn.classList.toggle('on', app.show.allFrames);
    afBtn.disabled = !!(app.cur && app.cur.st && app.cur.st.playing);
  }
  // + BOX button: disabled while playing
  const locked = !!(app.cur && app.cur.st && app.cur.st.playing);
  const addBtn = $('addBoxBtn');
  if (addBtn) addBtn.disabled = locked;
  const addBtn2 = $('addBoxToolbar');
  if (addBtn2) addBtn2.disabled = locked;
  // recenter pivot + markers also lock while playing
  const recBtn = $('recenterPivotBtn');
  if (recBtn) recBtn.disabled = locked;
  const mkBtn1 = $('addMarkerBtn');
  if (mkBtn1) mkBtn1.disabled = locked;
  const mkBtn2 = $('addMarkerToolbar');
  if (mkBtn2) mkBtn2.disabled = locked;
  // MELEE VIEW (Display): global display preference, always toggleable
  const mv = $('tglMeleeView');
  mv.disabled = false;
  mv.classList.toggle('on', app.show.meleeView);
  $('tglPivot').classList.toggle('on', app.show.pivot);
  $('tglLabel').classList.toggle('on', app.show.label);
  const mv2 = $('tglMarkerView');
  if (mv2) mv2.classList.toggle('on', app.show.markerView);
  $('resetBtn').disabled = locked;
}

// ---------- background color picker (popup, live-updating) ----------
const bgSatsq = $('bgSatsq'), bgSqDot = $('bgSqDot');
const bgPop = $('bgPop'), bgSwatch = $('bgSwatch'), bgHex = $('bgHex');
const PRESETS = ['#000000','#0a0c14','#0d1120','#1b2540','#3ef0ff','#ffe23e',
                 '#ff9d2e','#b47bff','#5aff8a','#ffffff','#8fa0d0','#5a6a90',
                 '#1e2a4a','#2a1e3a','#3a0d0d','#0d3a2a'];

function hsl2hex(h,s,l){ s/=100; l/=100; const k=n=>(n+h/30)%12, a=s*Math.min(l,1-l);
  const f=n=>{ const c=l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1))); return Math.round(c*255).toString(16).padStart(2,'0'); };
  return '#'+f(0)+f(8)+f(4); }
function hex2hsl(hex){ const m=/^#?([0-9a-f]{6})$/i.exec(hex); if(!m) return null;
  const r=parseInt(m[1].slice(0,2),16)/255,g=parseInt(m[1].slice(2,4),16)/255,b=parseInt(m[1].slice(4,6),16)/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b); let h=0,s=0,l=(mx+mn)/2;
  if(mx!==mn){ const d=mx-mn; s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360; }
  return { h:Math.round(h), s:Math.round(s*100), l:Math.round(l*100) }; }
function paintSatSquare(){
  const c=bgSatsq.getContext('2d'), W=bgSatsq.width, H=bgSatsq.height;
  const hueCol=hsl2hex(_bgState.h,100,50);
  const g=c.createLinearGradient(0,0,W,0); g.addColorStop(0,'#fff'); g.addColorStop(1,hueCol);
  c.fillStyle=g; c.fillRect(0,0,W,H);
  const v=c.createLinearGradient(0,0,0,H); v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'#000');
  c.fillStyle=v; c.fillRect(0,0,W,H);
}
function setBgFromHsl(h,s,l){
  _bgState.h=h; _bgState.s=s; _bgState.l=l;
  const hex=hsl2hex(h,s,l);
  app.bgColor=hex;
  document.documentElement.style.setProperty('--film-bg', hex);
  $('bgval').textContent=hex; bgSwatch.style.background=hex;
  bgHex.value=hex;
  $('bgHue').value=h; $('bgLight').value=l;
  paintSatSquare();
  const W=bgSatsq.width,H=bgSatsq.height;
  bgSqDot.style.left=(s/100*100)+'%';
  bgSqDot.style.top=((100-l)/100*100)+'%';
  draw();
  saveState();
}
export function setBg(hex){ const hsl=hex2hsl(hex); if(hsl) setBgFromHsl(hsl.h,hsl.s,hsl.l); }
export function paintSatSquareFn(){ paintSatSquare(); }

// saturation square drag (live)
let sqDrag=false;
function pickSq(e){ const rect=bgSatsq.getBoundingClientRect();
  let x=(e.clientX-rect.left)/rect.width, y=(e.clientY-rect.top)/rect.height;
  x=Math.max(0,Math.min(1,x)); y=Math.max(0,Math.min(1,y));
  setBgFromHsl(_bgState.h, Math.round(x*100), Math.round((1-y)*100)); }

// open / close popup
function openBgPop(){ bgPop.classList.add('on'); paintSatSquare(); }
function closeBgPop(){ bgPop.classList.remove('on'); }

export function initToolbar(){
  $('tglCollision').addEventListener('click', ()=>{ cancelHideMode(); app.show.collision=!app.show.collision; syncToggles(); draw(); saveState(); });
  $('tglMeleeView').addEventListener('click', ()=>{
    // The button may LOOK disabled (current frame has no melee) but is still
    // clickable — it's a global display preference, not a per-frame control.
    app.show.meleeView=!app.show.meleeView; cancelHideMode(); syncToggles(); draw(); saveState();
  });
  $('addBoxToolbar').addEventListener('click', addMeleeBox);
  $('tglAxes').addEventListener('click', ()=>{ cancelHideMode(); app.show.axes=!app.show.axes; syncToggles(); draw(); saveState(); });
  $('tglGrid').addEventListener('click', ()=>{ cancelHideMode(); app.show.grid=!app.show.grid; syncToggles(); draw(); saveState(); });
  $('tglSpriteView').addEventListener('click', ()=>{ cancelHideMode(); app.show.spriteView=!app.show.spriteView; syncToggles(); draw(); saveState(); });
  $('tglAllFrames').addEventListener('click', ()=>{
    if (!app.cur || !app.cur.st) return;
    // can't be active while playing — ghosts are a paused-state view
    if (app.cur.st.playing){ setPlaying(false); }
    app.show.allFrames = !app.show.allFrames;
    syncToggles(); draw(); saveState();
  });
  $('tglPivot').addEventListener('click', ()=>{ cancelHideMode(); app.show.pivot=!app.show.pivot; syncToggles(); draw(); saveState(); });
  $('tglLabel').addEventListener('click', ()=>{ app.show.label=!app.show.label; syncToggles(); draw(); saveState(); });

  // --- background color picker wiring ---
  bgSatsq.addEventListener('mousedown',e=>{sqDrag=true;pickSq(e);e.preventDefault();});
  window.addEventListener('mousemove',e=>{if(sqDrag)pickSq(e);});
  window.addEventListener('mouseup',()=>{sqDrag=false;});
  $('bgHue').addEventListener('input',()=>setBgFromHsl(+$('bgHue').value,_bgState.s,_bgState.l));
  $('bgLight').addEventListener('input',()=>setBgFromHsl(_bgState.h,_bgState.s,+$('bgLight').value));
  bgHex.addEventListener('change',()=>{ let v=bgHex.value.trim(); if(!v.startsWith('#'))v='#'+v;
    if(/^#[0-9a-f]{6}$/i.test(v)) setBg(v); else bgHex.value=app.bgColor; });
  // presets grid
  PRESETS.forEach(p=>{ const d=document.createElement('div'); d.className='sw'; d.style.background=p; d.title=p;
    d.addEventListener('click',()=>setBg(p)); $('bgPresets').appendChild(d); });
  // open / close popup
  bgSwatch.addEventListener('click',e=>{ e.stopPropagation(); bgPop.classList.contains('on')?closeBgPop():openBgPop(); });
  $('bgClose').addEventListener('click',e=>{ e.stopPropagation(); closeBgPop(); });
  document.addEventListener('click',e=>{ if(bgPop.classList.contains('on') && !bgPop.contains(e.target) && e.target!==bgSwatch) closeBgPop(); });
}
