// ---------- confirm dialog (macro editor) ----------
import { $ } from './viewport.js';

const cdDialog = $('confirmDialog');
let _resolve = null;

export function initConfirmDialog(){
  $('cdYes').addEventListener('click', () => resolve(true));
  $('cdCancel').addEventListener('click', () => resolve(false));
}

function resolve(v){ if (_resolve){ const r=_resolve; _resolve=null; r(v); } }

/**
 * Show a confirm dialog. Returns a Promise<boolean> that settles when the user
 * picks a button; the dialog closes itself either way.
 * opts: { title, yesLabel }
 */
export function confirmDialog(msg, onConfirm, opts={}){
  return new Promise(res => {
    $('cdTitle').textContent = opts.title || '⚠ Confirm';
    $('cdMsg').textContent = msg;
    $('cdYes').textContent = opts.yesLabel || 'Confirm';
    _resolve = (v) => { res(v); };
    cdDialog.showModal();
    $('cdYes').focus();
  }).then(ok => {
    cdDialog.close();
    if (ok && onConfirm) onConfirm();
    return ok;
  });
}
