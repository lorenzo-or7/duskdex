// Utilitários de DOM e template seguro.
// `html` escapa toda interpolação; use `raw()` apenas para marcação confiável gerada pelo próprio app.

class SafeHTML {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export const raw = (value) => new SafeHTML(String(value ?? ''));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const escape = (value) => String(value ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);

function renderValue(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHTML) return v.value;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return escape(v);
}

/** Template seguro: html`<p>${userText}</p>` → SafeHTML */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < values.length ? renderValue(values[i]) : ''); });
  return new SafeHTML(out);
}

/** Atribui marcação segura a um elemento. */
export function render(el, content) {
  el.innerHTML = content instanceof SafeHTML ? content.value : escape(content);
  return el;
}

/** Cria um elemento a partir de SafeHTML (primeiro nó). */
export function toElement(content) {
  const t = document.createElement('template');
  t.innerHTML = String(content).trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Delegação de eventos por data-action. */
export function delegate(root, type, selector, handler) {
  const fn = (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(type, fn);
  return () => root.removeEventListener(type, fn);
}

export function debounce(fn, wait = 300) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function uid(prefix = '') {
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  return prefix + Date.now().toString(36) + Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' }) : null;
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const table = [[60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [2629800, 'week', 604800], [31557600, 'month', 2629800], [Infinity, 'year', 31557600]];
  for (const [limit, unit, div] of table) {
    if (abs < limit) return rtf ? rtf.format(Math.round(diff / div), unit) : new Date(iso).toLocaleString('pt-BR');
  }
  return '';
}

export function formatDate(iso, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('pt-BR', opts); } catch { return iso; }
}
export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const fmtInt = (n) => new Intl.NumberFormat('pt-BR').format(n || 0);
export const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
export const plural = (n, one, many) => `${fmtInt(n)} ${n === 1 ? one : many}`;
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function formatBytes(n) {
  if (!n && n !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function normalize(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
