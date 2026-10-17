// Cliente da comunidade e das trocas (API /api/v1). Funciona em qualquer modo: ler o feed e perfis
// públicos não exige conta; publicar, curtir, comentar, seguir e trocar exigem login.
import { apiRequest, serverHealth } from './server-adapter.js';

const enc = encodeURIComponent;
const qs = (o) => { const p = Object.entries(o).filter(([, v]) => v != null && v !== ''); return p.length ? `?${p.map(([k, v]) => `${k}=${enc(v)}`).join('&')}` : ''; };

export const community = {
  /** O servidor DuskDex está disponível neste endereço? */
  async available() { return (await serverHealth()).ok; },

  feed: ({ scope = 'all', before = null } = {}) => apiRequest('GET', `/community/feed${qs({ scope, before })}`),
  post: (id) => apiRequest('GET', `/community/posts/${enc(id)}`),
  publish: (body, attachment = null) => apiRequest('POST', '/community/posts', { body, attachment }),
  remove: (id) => apiRequest('DELETE', `/community/posts/${enc(id)}`),
  like: (id, on = true) => apiRequest(on ? 'POST' : 'DELETE', `/community/posts/${enc(id)}/like`, on ? {} : undefined),
  comments: (id) => apiRequest('GET', `/community/posts/${enc(id)}/comments`),
  comment: (id, body) => apiRequest('POST', `/community/posts/${enc(id)}/comments`, { body }),
  removeComment: (id) => apiRequest('DELETE', `/community/comments/${enc(id)}`),
  report: (targetType, targetId, reason, details = '') => apiRequest('POST', '/community/reports', { targetType, targetId, reason, details }),

  users: (q = '') => apiRequest('GET', `/community/users${qs({ q })}`),
  profile: (username) => apiRequest('GET', `/community/u/${enc(username)}`),
  userPosts: (username, before = null) => apiRequest('GET', `/community/u/${enc(username)}/posts${qs({ before })}`),
  connections: (username, type = 'followers') => apiRequest('GET', `/community/u/${enc(username)}/connections${qs({ type })}`),
  follow: (username, on = true) => apiRequest(on ? 'POST' : 'DELETE', `/community/u/${enc(username)}/follow`, on ? {} : undefined),
  block: (username, on = true) => apiRequest(on ? 'POST' : 'DELETE', `/community/u/${enc(username)}/block`, on ? {} : undefined),

  publicBinder: (id) => apiRequest('GET', `/public/binders/${enc(id)}`),
  publicDeck: (id) => apiRequest('GET', `/public/decks/${enc(id)}`),

  notifications: () => apiRequest('GET', '/notifications'),
  counts: () => apiRequest('GET', '/notifications/count'),
  markRead: (ids = []) => apiRequest('POST', '/notifications/read', { ids }),

  reports: (status = 'open') => apiRequest('GET', `/admin/reports${qs({ status })}`),
  resolveReport: (id, action) => apiRequest('POST', `/admin/reports/${enc(id)}`, { action }),

  // ---- trocas
  tradable: (username) => apiRequest('GET', `/community/u/${enc(username)}/tradable`),
  trades: (box = 'open') => apiRequest('GET', `/trades${qs({ box })}`),
  trade: (id) => apiRequest('GET', `/trades/${enc(id)}`),
  propose: ({ to, give = [], want = [], message = '' }) => apiRequest('POST', '/trades', { to, give, want, message }),
  accept: (id, message = '') => apiRequest('POST', `/trades/${enc(id)}/accept`, { message }),
  decline: (id, message = '') => apiRequest('POST', `/trades/${enc(id)}/decline`, { message }),
  cancel: (id, message = '') => apiRequest('POST', `/trades/${enc(id)}/cancel`, { message }),
};

export const REPORT_REASONS = { spam: 'Spam ou propaganda', ofensivo: 'Ofensivo ou assédio', golpe: 'Golpe ou fraude', conteudo_improprio: 'Conteúdo impróprio', direitos: 'Direitos autorais', outro: 'Outro motivo' };
