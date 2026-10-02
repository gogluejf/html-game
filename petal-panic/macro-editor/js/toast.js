// ---------- toast (macro editor) ----------
let _t = null;
export function showToast(msg, kind='info'){
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = kind==='error' ? '#ff5a5a' : kind==='success' ? '#5aff8a' : 'var(--line)';
  el.style.opacity = '1';
  clearTimeout(_t);
  _t = setTimeout(()=>{ el.style.opacity='0'; }, 2600);
}
