// ---------- confirm dialog (macro editor) ----------
import { $ } from './viewport.js';

const cdDialog = $('confirmDialog');
let _resolve = null;

export function initConfirmDialog(){
  $('cdYes').addEventListener('click', () => resolve(true));
  $('cdCancel').addEventListener('click', () => resolve(false));
  // Escape / backdrop click = Cancel (matches the sprite editor dialog). The
  // native <dialog> fires 'cancel' on Esc; preventDefault stops the browser
  // from auto-closing before we settle the promise, then we close in .then().
  cdDialog.addEventListener('cancel', e => { e.preventDefault(); resolve(false); });
  cdDialog.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); resolve(true); } });
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

// ---------- text-input dialog (rename / new-macro name) ----------
// A small <dialog> with a single text field. Returns Promise<string|null>:
// the trimmed value on confirm, or null if cancelled/empty.
let _inputEl = null;
let _inputResolve = null;

export function ensureInputDialog(){
  if (_inputEl) return _inputEl;
  const d = document.createElement('dialog');
  d.id = 'inputDialog';
  d.innerHTML = `
    <div class="cd-body">
      <div class="cd-title" id="inTitle">Rename</div>
      <div class="cd-msg" id="inMsg"></div>
      <input id="inField" type="text" spellcheck="false" autocomplete="off"
             style="width:100%;margin-top:10px;padding:8px 10px;font-size:14px;box-sizing:border-box;
                    background:var(--bg,#0b1220);color:var(--txt,#fff);border:1px solid var(--line,#334);
                    border-radius:8px;outline:none;font-family:inherit;">
    </div>
    <div class="cd-actions">
      <button class="cd-btn" id="inCancel">Cancel</button>
      <button class="cd-btn danger" id="inOk">OK</button>
    </div>`;
  document.body.appendChild(d);
  _inputEl = d;
  d.addEventListener('cancel', () => settleInput(null));   // Esc / backdrop
  $('inCancel').addEventListener('click', () => settleInput(null));
  $('inOk').addEventListener('click', () => settleInput($('inField').value));
  $('inField').addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); settleInput($('inField').value); }
  });
  return d;
}

function settleInput(value){
  if (!_inputResolve) return;
  const r = _inputResolve; _inputResolve = null;
  r(value);
}

/**
 * Prompt for a text value.
 * @returns {Promise<string|null>} trimmed non-empty value, or null if cancelled.
 */
export function promptDialog(title, message, initial='', opts={}){
  const d = ensureInputDialog();
  return new Promise(res => {
    $('inTitle').textContent = opts.title || title;
    $('inMsg').textContent = message || '';
    const field = $('inField');
    field.value = initial || '';
    $('inOk').textContent = opts.okLabel || 'OK';
    _inputResolve = (value) => {
      d.close();
      res(value === null ? null : String(value).trim());
    };
    d.showModal();
    field.focus();
    field.select();
  });
}
