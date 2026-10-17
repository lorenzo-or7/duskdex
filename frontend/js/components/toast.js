import { html, render } from '../core/html.js';
import { icon } from '../core/icons.js';

const ICONS = { success: 'check', error: 'alert', warning: 'alert', info: 'info' };

/** toast({ type, title, text, action: { label, onClick }, timeout }) */
export function toast(opts) {
  const o = typeof opts === 'string' ? { text: opts } : opts;
  const type = o.type || 'info';
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  render(el, html`${icon(ICONS[type])}
    <div class="toast__body">
      ${o.title ? html`<div class="toast__title">${o.title}</div>` : ''}
      ${o.text ? html`<div class="toast__text">${o.text}</div>` : ''}
    </div>
    ${o.action ? html`<button class="btn btn--sm btn--ghost toast__action" type="button">${o.action.label}</button>` : ''}
    <button class="icon-btn" type="button" aria-label="Fechar aviso" style="width:26px;height:26px">${icon('x')}</button>`);
  const close = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('.icon-btn').addEventListener('click', close);
  if (o.action) el.querySelector('.toast__action').addEventListener('click', () => { o.action.onClick(); close(); });
  host.appendChild(el);
  const timeout = o.timeout ?? (o.action ? 7000 : type === 'error' ? 7000 : 3800);
  if (timeout) setTimeout(close, timeout);
  return close;
}

export const toastError = (err, title = 'Não foi possível concluir') =>
  toast({ type: 'error', title, text: err?.message || String(err) });
