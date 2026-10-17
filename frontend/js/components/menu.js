import { html, render } from '../core/html.js';
import { icon } from '../core/icons.js';

let current = null;

/**
 * Abre um menu contextual ancorado em um elemento ou coordenada.
 * items: [{ label, icon, onClick, danger, disabled, hint } | { separator: true } | { label, heading: true }]
 */
export function openMenu(anchor, items, { x, y } = {}) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  render(el, html`${items.map((it, i) => it.separator
    ? html`<div class="menu__sep" role="separator"></div>`
    : it.heading
      ? html`<div class="menu__label">${it.label}</div>`
      : html`<button class="menu__item ${it.danger ? 'menu__item--danger' : ''}" role="menuitem" type="button" data-i="${i}" ${it.disabled ? 'disabled' : ''} title="${it.hint || ''}">${it.icon ? icon(it.icon) : ''}<span>${it.label}</span></button>`)}`);
  document.body.appendChild(el);

  const rect = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, top: y, bottom: y };
  const mw = el.offsetWidth; const mh = el.offsetHeight;
  let left = rect.left; let top = rect.bottom + 6;
  if (left + mw > innerWidth - 8) left = Math.max(8, rect.right - mw);
  if (top + mh > innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
  el.style.left = left + 'px'; el.style.top = top + 'px';

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closeMenu();
    it.onClick?.();
  });
  const onDoc = (e) => { if (!el.contains(e.target) && e.target !== anchor) closeMenu(); };
  const onKey = (e) => {
    const btns = Array.from(el.querySelectorAll('.menu__item:not([disabled])'));
    const idx = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeMenu(); anchor?.focus?.(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(idx + 1) % btns.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(idx - 1 + btns.length) % btns.length]?.focus(); }
  };
  setTimeout(() => document.addEventListener('pointerdown', onDoc), 0);
  document.addEventListener('keydown', onKey);
  current = { el, cleanup: () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); } };
  current.openedAt = performance.now();
  el.querySelector('.menu__item:not([disabled])')?.focus({ preventScroll: true });
  return current;
}

export function closeMenu() {
  if (!current) return;
  current.cleanup();
  current.el.remove();
  current = null;
}
// Fecha em gestos de rolagem do usuário (roda do mouse/toque), não em rolagens programáticas.
window.addEventListener('wheel', (e) => { if (current && !current.el.contains(e.target)) closeMenu(); }, { passive: true });
window.addEventListener('touchmove', (e) => { if (current && !current.el.contains(e.target)) closeMenu(); }, { passive: true });
window.addEventListener('resize', closeMenu);
