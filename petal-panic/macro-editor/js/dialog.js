// ---------- confirm dialog (macro editor) ----------
import { $ } from './viewport.js';

export function initConfirmDialog(){
  const yes = $('cdYes'), cancel = $('cdCancel');
  yes.addEventListener('click', () => resolve(true));
  cancel.addEventListener('click', () => resolve(false));
}

let _resolve = null;
function resolve(v){ if (_resolve){ const r=_resolve; _resolve=null; r(v); } }

/**
 * Show a confirm dialog. Returns a Promise<boolean>.
 * opts: { title, yesLabel }
 */
export function confirmDialog(msg, onConfirm, opts={}){
  return new Promise(res => {
    $('cdTitle').textContent = opts.title || '⚠ Confirm';
    $('cdMsg').textContent = msg;
    $('cdYes').textContent = opts.yesLabel || 'Confirm';
    _resolve = (v) => { res(v); if (v && onConfirm) onConfirm(); };
    document.getElementById('confirmDialog').showModal();
  });
}
