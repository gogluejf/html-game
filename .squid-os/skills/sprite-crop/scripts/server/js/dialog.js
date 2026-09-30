// ---------- reusable confirm dialog ----------
import { app } from './state.js';
import { $ } from './viewport.js';

const cdDialog = $('confirmDialog');

export function confirmDialog(message, onYes){
  return new Promise(resolve => {
    $('cdMsg').textContent = message;
    app._cdResolve = resolve;
    cdDialog.showModal();
    $('cdYes').focus();
  }).then(ok => {
    cdDialog.close();
    if (ok) onYes();
    return ok;
  });
}

function _cdDone(ok){
  if (app._cdResolve){ app._cdResolve(ok); app._cdResolve = null; }
}

export function initConfirmDialog(){
  $('cdYes').addEventListener('click', () => { _cdDone(true); });
  $('cdCancel').addEventListener('click', () => { _cdDone(false); });
  cdDialog.addEventListener('cancel', e => { e.preventDefault(); _cdDone(false); });   // Esc
  cdDialog.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); _cdDone(true); } });
}
