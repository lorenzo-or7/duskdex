// Preferências pequenas no localStorage (somente dados leves, nunca dados da coleção).
const KEY = 'dd.prefs';
const DEFAULTS = {
  catalogLang: 'en',
  binderView: 'auto',      // auto | book | single
  collectionView: 'grid',  // grid | list
  dataMode: 'demo',        // demo (convidado, dados no navegador) | server (conta)
  guestStart: null,        // escolha do convidado no primeiro acesso: 'empty' | 'examples'
};

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch { cache = { ...DEFAULTS }; }
  return cache;
}

export const prefs = {
  get(key) { return load()[key]; },
  set(key, value) {
    load()[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* armazenamento cheio/bloqueado */ }
  },
  all() { return { ...load() }; },
};

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
