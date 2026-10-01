// ---------- toast notification (bottom-center, auto-fade) ----------
let _toastTimer = null;

export function showToast(message, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.style.borderColor = type === 'error' ? '#ff5a5a' : type === 'success' ? 'var(--grn)' : 'var(--line)';
  el.style.opacity = '1';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}
