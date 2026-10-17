// Roteador por hash (#/rota) — funciona em qualquer servidor estático, sem reescrita de URL.
const routes = [];
let notFound = null;
let current = { cleanup: null, path: null };
let beforeEach = null;
let afterEach = null;

export function route(pattern, loader, meta = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ pattern, re, keys, loader, meta });
}
export const setNotFound = (loader) => { notFound = loader; };
export const onBefore = (fn) => { beforeEach = fn; };
export const onAfter = (fn) => { afterEach = fn; };

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) { resolve(); return; }
  if (replace) { history.replaceState(null, '', target); resolve(); }
  else location.hash = target;
}

/** Atualiza a query string da rota atual sem recarregar a página. */
export function setQuery(params) {
  const { path, query } = parseHash();
  const next = { ...query, ...params };
  Object.keys(next).forEach((k) => (next[k] === '' || next[k] == null) && delete next[k]);
  const qs = new URLSearchParams(next).toString();
  history.replaceState(null, '', `#${path}${qs ? '?' + qs : ''}`);
}

// Navegações são serializadas: se outra chegar enquanto uma página carrega, ela roda
// logo depois (as intermediárias são descartadas). Evita que uma página lenta
// termine depois e sobrescreva a tela da navegação mais recente.
let running = null;
let pending = false;

export function resolve() {
  if (running) { pending = true; return running; }
  running = (async () => {
    try {
      do { pending = false; await resolveOnce(); } while (pending);
    } finally { running = null; }
  })();
  return running;
}

async function resolveOnce() {
  const { path, query } = parseHash();
  let match = null; let params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  const ctx = { path, query, params, meta: match?.meta || {} };
  if (beforeEach) {
    const redirect = await beforeEach(ctx);
    if (redirect) { history.replaceState(null, '', '#' + redirect); pending = true; return; }
  }
  if (typeof current.cleanup === 'function') { try { current.cleanup(); } catch { /* ignore */ } }
  current = { cleanup: null, path };
  const loader = match ? match.loader : notFound;
  try {
    const cleanup = await loader(ctx);
    if (current.path === path) current.cleanup = cleanup;
  } finally {
    afterEach?.(ctx);
  }
}

export function start() {
  window.addEventListener('hashchange', resolve);
  return resolve();
}

/** Re-renderiza a rota atual (ex.: após mudança de dados em outra aba). */
export const refresh = () => resolve();
