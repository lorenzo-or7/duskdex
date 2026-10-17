// Adaptador do MODO CONTA: fala com o backend PHP + MySQL (/api/v1). Exige login real (sessão + CSRF).
// Mesma interface do adaptador do navegador (modo convidado), então as telas não mudam entre os modos.
import { DomainError, ConflictError, UnsupportedError } from './errors.js';

const BASE = (window.DUSKDEX_API_BASE || 'api/v1').replace(/\/$/, '');

export class AuthRequiredError extends DomainError {
  constructor() { super('UNAUTHENTICATED', 'Entre na sua conta para continuar.'); }
}

// ---------------------------------------------------------------- transporte compartilhado
let csrf = null;
export async function fetchCsrf() {
  const r = await fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' });
  const j = await r.json();
  csrf = j.data.token;
  return csrf;
}

/** Requisição JSON à API. `raw`: corpo binário (upload) com cabeçalhos extras. */
export async function apiRequest(method, path, body, { raw = null, headers: extra = {} } = {}) {
  const headers = { Accept: 'application/json', ...extra };
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    if (!csrf) await fetchCsrf();
    headers['X-CSRF-Token'] = csrf;
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, credentials: 'same-origin', body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new DomainError('NETWORK', 'Sem conexão com o servidor DuskDex. Verifique se o backend PHP está em execução.');
  }
  let json = null;
  try { json = await res.json(); } catch { /* corpo vazio */ }
  if (res.ok) return json?.data ?? null;
  const err = json?.error || {};
  if (res.status === 401) throw new AuthRequiredError();
  if (res.status === 403 && err.code === 'CSRF') {
    // sessão regenerada (login em outra aba): renova o token e tenta uma vez
    csrf = null;
    if (!extra['X-Retry']) return apiRequest(method, path, body, { raw, headers: { ...extra, 'X-Retry': '1' } });
  }
  if (res.status === 409) throw new ConflictError(err.message, err.details);
  if (res.status === 413) throw new DomainError('TOO_LARGE', err.message || 'Arquivo grande demais para o servidor.');
  throw new DomainError(err.code || `HTTP_${res.status}`, err.message || `Erro ${res.status} no servidor.`, err.details);
}

let healthCache = null;
/** Saúde do servidor (cacheada por 30 s). */
export async function serverHealth({ force = false } = {}) {
  if (!force && healthCache && Date.now() - healthCache.at < 30000) return healthCache.value;
  let value;
  try {
    const r = await fetch(`${BASE}/health`, { credentials: 'same-origin' });
    const j = await r.json();
    const db = j?.data?.database;
    value = {
      ok: r.ok && db === 'ok',
      message: db === 'ok' ? 'Servidor e banco disponíveis.' : db === 'outdated' ? 'Banco de dados desatualizado: rode “php backend/bin/migrate.php”.' : db === 'not_migrated' ? 'Banco ainda não preparado: rode “php backend/bin/migrate.php”.' : (j?.data?.reason || j?.error?.message || 'Banco de dados indisponível. Verifique se o MySQL está rodando e os dados DB_* do arquivo .env.'),
      data: j?.data || null,
    };
  } catch {
    value = { ok: false, message: 'Servidor DuskDex não encontrado neste endereço.' };
  }
  healthCache = { at: Date.now(), value };
  return value;
}

const assetUrl = (id) => `${BASE}/assets/${encodeURIComponent(id)}/file`;

export class ServerAdapter {
  constructor() {
    this.mode = 'server';
    this.label = 'Conta DuskDex (servidor)';
    this.capabilities = { inventory: true, assets: true, community: true, deckAssembly: true, auth: true, revert: true, trades: true };
    this.user = null;
    this.maxUpload = 8 * 1024 * 1024;
  }

  request(method, path, body) { return apiRequest(method, path, body); }
  async fetchCsrf() { return fetchCsrf(); }

  async init() {
    const health = await this.health();
    if (!health.ok) throw new DomainError('SERVER_DOWN', health.message);
    if (health.data?.maxUpload) this.maxUpload = health.data.maxUpload;
    this.mailTestMode = !!health.data?.mailTestMode; // e-mails só gravados em arquivo (desenvolvimento)
    try { this.user = await this.request('GET', '/auth/me'); } catch (e) { if (!(e instanceof AuthRequiredError)) throw e; }
    return { seeded: true, user: this.user, health };
  }

  health() { return serverHealth({ force: true }); }

  // ---- autenticação
  async register(payload) { const u = await this.request('POST', '/auth/register', payload); this.user = u; await fetchCsrf(); return u; }
  async login(payload) { const u = await this.request('POST', '/auth/login', payload); this.user = u; await fetchCsrf(); return u; }
  async logout() { await this.request('POST', '/auth/logout', {}); this.user = null; csrf = null; }
  forgotPassword(email) { return this.request('POST', '/auth/forgot', { email }); }
  async resetPassword(token, password) { const u = await this.request('POST', '/auth/reset', { token, password }); this.user = u; await fetchCsrf(); return u; }
  verifyEmail(token) { return this.request('POST', '/auth/verify', { token }); }
  resendVerification() { return this.request('POST', '/auth/verify/resend', {}); }
  async changePassword(current, password) { const r = await this.request('POST', '/users/me/password', { current, password }); await fetchCsrf(); return r; }
  async deleteAccount(password) { await this.request('DELETE', '/users/me', { password }); this.user = null; csrf = null; }
  async refreshMe() { this.user = await this.request('GET', '/auth/me'); return this.user; }

  // ---- meta
  async reset() { throw new UnsupportedError('Reiniciar dados (use “Excluir conta”)'); }
  async storageEstimate() { return null; }
  async ensureSystemLocations() { /* criados pelo servidor no registro */ }
  get inboxId() { return this._inbox || 'inbox'; }
  get removedId() { return this._removed || 'removed'; }

  // ---- cartas
  putCards(snaps) { return this.request('POST', '/cards', { cards: snaps }); }
  allCards() { return this.request('GET', '/cards'); }

  // ---- perfil
  getProfile() { return this.request('GET', '/users/me'); }
  saveProfile(patch) { return this.request('PATCH', '/users/me', patch); }
  listActivity(limit = 30) { return this.request('GET', `/activity?limit=${limit}`); }

  // ---- locais
  async listLocations() {
    const list = await this.request('GET', '/storage-locations');
    this._inbox = list.find((l) => l.system && !l.hidden)?.id || 'inbox';
    this._removed = list.find((l) => l.system && l.hidden)?.id || 'removed';
    return list;
  }
  createLocation(p) { return this.request('POST', '/storage-locations', p); }
  updateLocation(id, p) { return this.request('PATCH', `/storage-locations/${id}`, p); }
  deleteLocation(id) { return this.request('DELETE', `/storage-locations/${id}`); }

  // ---- coleção
  listCopies() { return this.request('GET', '/collection/copies'); }
  addCopies(items, opts = {}) { return this.request('POST', '/collection/copies', { items, locationId: opts.locationId && opts.locationId !== 'inbox' ? opts.locationId : null, label: opts.label || null }); }
  removeCopies(copyIds, opts = {}) { return this.request('POST', '/collection/copies/remove', { copyIds, reason: opts.reason || null }); }
  setCondition(copyIds, condition) { return this.request('POST', '/collection/copies/condition', { copyIds, condition }); }
  setForTrade(copyIds, forTrade) { return this.request('POST', '/collection/copies/trade', { copyIds, forTrade }); }

  // ---- inventário
  previewMove(copyIds, locationId) { return this.request('POST', '/inventory/move/preview', { copyIds, locationId }); }
  commitMove(copyIds, locationId, opts = {}) { return this.request('POST', '/inventory/move', { copyIds, locationId, token: opts.token || null, idempotencyKey: opts.idempotencyKey || null }); }
  listBatches() { return this.request('GET', '/inventory/batches'); }
  previewRevert(batchId) { return this.request('GET', `/inventory/batches/${encodeURIComponent(batchId)}/revert-preview`); }
  revertBatch(batchId, movementIds) { return this.request('POST', `/inventory/batches/${encodeURIComponent(batchId)}/revert`, { movementIds }); }

  // ---- fichários
  listBinders() { return this.request('GET', '/binders'); }
  getBinder(id) { return this.request('GET', `/binders/${id}`); }
  createBinder(d) { return this.request('POST', '/binders', d); }
  updateBinderMeta(id, patch, expectedVersion) { return this.request('PATCH', `/binders/${id}`, { ...patch, expectedVersion }); }
  deleteBinder(id, opts = {}) { return this.request('DELETE', `/binders/${id}?moveCopiesTo=${encodeURIComponent(opts.moveCopiesTo && opts.moveCopiesTo !== 'inbox' ? opts.moveCopiesTo : '')}`); }
  duplicateAsVirtual(id, name) { return this.request('POST', `/binders/${id}/duplicate`, name ? { name } : {}); }
  binderOps(id, ops, opts = {}) {
    return this.request('POST', `/binders/${id}/ops`, { ops, expectedVersion: opts.expectedVersion ?? null, label: opts.label || null });
  }

  // ---- decks
  listDecks() { return this.request('GET', '/decks'); }
  getDeck(id) { return this.request('GET', `/decks/${id}`); }
  saveDeck(deck) { return deck.id ? this.request('PUT', `/decks/${deck.id}`, deck) : this.request('POST', '/decks', deck); }
  async duplicateDeck(id) { const d = await this.getDeck(id); return this.saveDeck({ ...d, id: null, version: null, name: `${d.name} (cópia)` }); }
  deleteDeck(id) { return this.request('DELETE', `/decks/${id}`); }
  async reserveCopies(deckId, copyIds) { return (await this.request('POST', `/decks/${deckId}/reserve`, { copyIds })).reserved; }
  releaseReservations(deckId) { return this.request('POST', `/decks/${deckId}/release`, {}); }
  assembleDeck(deckId, opts = {}) { return this.request('POST', `/decks/${deckId}/assemble`, { parentLocationId: opts.parentLocationId || null }); }
  disassembleDeck(deckId, toLocationId) { return this.request('POST', `/decks/${deckId}/disassemble`, { toLocationId: toLocationId && toLocationId !== 'inbox' ? toLocationId : null }); }

  // ---- wishlist
  listWishlist() { return this.request('GET', '/wishlist'); }
  addWishlist(p) { return this.request('POST', '/wishlist', p); }
  updateWishlist(id, p) { return this.request('PATCH', `/wishlist/${id}`, p); }
  removeWishlist(id) { return this.request('DELETE', `/wishlist/${id}`); }

  // ---- imagens (arquivos no servidor; a interface recebe Blob como no modo convidado)
  listAssets() { return this.request('GET', '/assets'); }
  async addAsset({ blob, name, mime }) {
    let file = blob;
    if (file.size > this.maxUpload) file = await shrinkForUpload(file, this.maxUpload);
    return apiRequest('POST', '/assets', undefined, { raw: file, headers: { 'Content-Type': mime || file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(name || 'imagem') } });
  }
  async getAssetBlob(id) {
    try {
      const r = await fetch(assetUrl(id), { credentials: 'same-origin' });
      return r.ok ? await r.blob() : null;
    } catch { return null; }
  }
  assetUsage(id) { return this.request('GET', `/assets/${id}/usage`); }
  deleteAsset(id) { return this.request('DELETE', `/assets/${id}`); }

  // ---- importação do modo convidado
  importGuest(payload) { return this.request('POST', '/users/me/import', payload); }

  exportAll() { return this.request('GET', '/users/me/export'); }
}

/** Reduz uma imagem que passou do limite do servidor (mantém proporção; WebP de alta qualidade). */
async function shrinkForUpload(blob, max) {
  const bmp = await createImageBitmap(blob);
  let scale = Math.min(1, Math.sqrt((max * 0.8) / blob.size) * 1.6);
  for (let i = 0; i < 6; i++) {
    const w = Math.max(16, Math.round(bmp.width * scale)); const h = Math.max(16, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 });
    if (out.size <= max) return out;
    scale *= 0.8;
  }
  throw new DomainError('TOO_LARGE', 'Imagem grande demais para o servidor, mesmo reduzida.');
}
