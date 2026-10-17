import { html, render, escape } from '../core/html.js';
import { icon } from '../core/icons.js';

const stack = [];

/**
 * openModal({ title, body, footer, size: 'md'|'lg'|'xl', drawer, onClose, labelledBy })
 * body/footer: SafeHTML ou função (el) => void para montar conteúdo.
 * Retorna { el, body, foot, close, setBody, setFooter }.
 */
export function openModal({ title = '', body = '', footer = null, size = 'md', drawer = false, onClose, dismissible = true } = {}) {
  const prevFocus = document.activeElement;
  const root = document.createElement('div');
  root.className = 'modal-root' + (drawer ? ' modal-root--drawer' : '');
  const id = 'm' + Math.random().toString(36).slice(2, 8);
  render(root, html`<div class="modal-backdrop" data-close></div>
    <div class="modal modal--${size}" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
      <div class="modal__head">
        <h2 class="modal__title" id="${id}-t">${title}</h2>
        <button class="icon-btn" type="button" data-close aria-label="Fechar">${icon('x')}</button>
      </div>
      <div class="modal__body"></div>
      <div class="modal__foot" hidden></div>
    </div>`);
  const bodyEl = root.querySelector('.modal__body');
  const footEl = root.querySelector('.modal__foot');
  const api = {
    el: root,
    body: bodyEl,
    foot: footEl,
    closed: false,
    close(result) {
      if (api.closed) return;
      api.closed = true;
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      stack.splice(stack.indexOf(api), 1);
      if (!stack.length) document.body.style.overflow = '';
      if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
      onClose?.(result);
    },
    setTitle(t) { root.querySelector('.modal__title').textContent = t; },
    setBody(content) { if (typeof content === 'function') { bodyEl.innerHTML = ''; content(bodyEl); } else render(bodyEl, content); },
    setFooter(content) {
      if (!content) { footEl.hidden = true; footEl.innerHTML = ''; return; }
      footEl.hidden = false;
      if (typeof content === 'function') { footEl.innerHTML = ''; content(footEl); } else render(footEl, content);
    },
  };
  api.setBody(body);
  api.setFooter(footer);

  const onKey = (e) => {
    if (stack[stack.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); api.close(); }
    if (e.key === 'Tab') trapFocus(e, root);
  };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', (e) => { if (e.target.closest('[data-close]') && dismissible) api.close(); });

  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';
  stack.push(api);
  requestAnimationFrame(() => {
    const first = root.querySelector('[autofocus], .modal__body input, .modal__body select, .modal__body textarea, .modal__body button, .modal__foot .btn--primary');
    (first || root.querySelector('.modal__head .icon-btn'))?.focus({ preventScroll: true });
  });
  return api;
}

function trapFocus(e, root) {
  const f = Array.from(root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((el) => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0]; const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Diálogo de confirmação. Resolve true/false. */
export function confirmDialog({ title = 'Confirmar', message = '', details = null, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      title,
      body: html`<div class="stack">${typeof message === 'string' ? html`<p class="muted">${message}</p>` : message}${details || ''}</div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-cancel>${cancelLabel}</button>
        <button class="btn ${danger ? 'btn--crimson' : 'btn--primary'}" type="button" data-ok>${confirmLabel}</button>`,
      onClose: () => resolve(result),
    });
    m.foot.querySelector('[data-cancel]').addEventListener('click', () => m.close());
    m.foot.querySelector('[data-ok]').addEventListener('click', () => { result = true; m.close(); });
    requestAnimationFrame(() => m.foot.querySelector('[data-ok]').focus());
  });
}

/** Pede um texto simples. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Salvar', maxLength = 80 }) {
  return new Promise((resolve) => {
    let result = null;
    const m = openModal({
      title,
      body: html`<form class="field" data-form><label class="field__label" for="pd-in">${label}</label>
        <input class="input" id="pd-in" name="v" value="${value}" placeholder="${placeholder}" maxlength="${maxLength}" required autofocus></form>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>${confirmLabel}</button>`,
      onClose: () => resolve(result),
    });
    const submit = () => {
      const v = m.body.querySelector('input').value.trim();
      if (!v) { m.body.querySelector('input').setAttribute('aria-invalid', 'true'); return; }
      result = v; m.close();
    };
    m.body.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    m.foot.querySelector('[data-ok]').addEventListener('click', submit);
  });
}

export { escape };
