// Ponto único de acesso a dados. As telas falam com `data()` e nunca com IndexedDB ou fetch diretamente.
import { DemoAdapter } from './demo-adapter.js';
import { ServerAdapter } from './server-adapter.js';
import { prefs } from '../core/prefs.js';
import { emit } from '../core/events.js';
import { cardKeyOf } from '../features/domain.js';

let adapter = null;
const cardCache = new Map(); // key → snapshot (memória, para render síncrono)

export function data() {
  if (!adapter) throw new Error('Adaptador de dados não inicializado.');
  return adapter;
}

export async function initData() {
  const mode = prefs.get('dataMode');
  adapter = mode === 'server' ? new ServerAdapter() : new DemoAdapter();
  const info = await adapter.init();
  await reloadCards();
  return { mode: adapter.mode, ...info };
}

export async function switchMode(mode) {
  prefs.set('dataMode', mode);
  cardCache.clear();
  location.hash = '#/inicio';
  location.reload();
}

export async function reloadCards() {
  cardCache.clear();
  try {
    const all = await adapter.allCards();
    for (const c of all) cardCache.set(c.key || cardKeyOf(c.id, c.lang), c);
  } catch { /* servidor pode exigir login; o cache é preenchido depois */ }
}

/** Resolve snapshot de forma síncrona (para render). */
export const card = (key) => cardCache.get(key) || null;
export const allCachedCards = () => [...cardCache.values()];

/** Garante que os snapshots fiquem salvos localmente/servidor antes de serem referenciados. */
export async function rememberCards(snaps) {
  const saved = await adapter.putCards(snaps.filter(Boolean));
  for (const c of saved) cardCache.set(c.key, c);
  emit('cards:changed');
  return saved;
}

/** Notifica telas e outras abas que dados mudaram. */
export function changed(scope) {
  emit('data:changed', scope);
  emit('data:' + scope, null, { broadcast: true });
}
