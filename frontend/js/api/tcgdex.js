// Cliente da API pública TCGdex (REST v2).
// Referência consultada: https://tcgdex.dev/rest · /reference/card · /reference/set · /assets · /rest/filtering-sorting-pagination
// Somente GET, JSON, sem chave. Idioma vai no caminho: https://api.tcgdex.net/v2/{lang}/...
// Imagens: URL base sem extensão + "/{high|low}.{webp|png|jpg}".

import * as local from './catalog-local.js';

export const TCGDEX_BASE = 'https://api.tcgdex.net/v2';
/** Todos os idiomas com cartas na TCGdex vêm da base local embutida (funciona sem internet); a API ao vivo fica como reserva. */
export const isLocal = (lang) => local.hasLocal(lang);
export const catalogMeta = (lang) => local.catalogMeta(lang);
export const listYears = (lang) => (isLocal(lang) ? local.listYears(lang) : Promise.resolve(null));

// Códigos candidatos. A lista efetiva é DESCOBERTA em tempo de execução (probe), não assumida.
const CANDIDATE_LANGS = ['en', 'fr', 'es', 'es-mx', 'it', 'pt', 'pt-br', 'pt-pt', 'de', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh-tw', 'zh-cn', 'id', 'th'];
export const LANG_LABELS = {
  en: 'Inglês', fr: 'Francês', es: 'Espanhol', 'es-mx': 'Espanhol (México)', it: 'Italiano', pt: 'Português (Brasil)',
  'pt-br': 'Português (Brasil)', 'pt-pt': 'Português (Portugal)', de: 'Alemão', nl: 'Holandês', pl: 'Polonês',
  ru: 'Russo', ja: 'Japonês', ko: 'Coreano', 'zh-tw': 'Chinês (Tradicional)', 'zh-cn': 'Chinês (Simplificado)',
  id: 'Indonésio', th: 'Tailandês',
};
export const langLabel = (c) => LANG_LABELS[c] || (c ? c.toUpperCase() : '—');

export class TcgdexError extends Error {
  constructor(message, kind, status) { super(message); this.kind = kind; this.status = status; }
}

const memo = new Map();

async function fetchJSON(path, { timeout = 12000, cache = true } = {}) {
  const url = TCGDEX_BASE + path;
  if (cache && memo.has(url)) return memo.get(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const p = (async () => {
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    } catch (e) {
      throw new TcgdexError(
        e.name === 'AbortError' ? 'A TCGdex demorou demais para responder.' : 'Não foi possível conectar à TCGdex (sem internet, bloqueio de rede ou serviço indisponível).',
        'network');
    } finally { clearTimeout(t); }
    if (res.status === 404) throw new TcgdexError('Registro não encontrado na TCGdex.', 'not_found', 404);
    if (!res.ok) throw new TcgdexError(`A TCGdex respondeu com erro ${res.status}.`, 'server', res.status);
    try { return await res.json(); } catch { throw new TcgdexError('Resposta inválida da TCGdex.', 'parse'); }
  })();
  if (cache) {
    memo.set(url, p);
    p.catch(() => memo.delete(url));
  }
  return p;
}

const qs = (params) => {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k).replace(/%3A/gi, ':').replace(/%2E/gi, '.')}=${encodeURIComponent(v).replace(/%3A/gi, ':').replace(/%7C/gi, '|')}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
};

/** URL de imagem de carta. quality: 'low' (245×337) | 'high' (600×825). */
export function cardImageUrl(base, quality = 'low', ext = 'webp') {
  if (!base) return null;
  if (/\.(webp|png|jpg)$/i.test(base)) return base;
  return `${base}/${quality}.${ext}`;
}
/** Logos e símbolos aceitam apenas a extensão. */
export const assetUrl = (base, ext = 'webp') => (base ? (/\.(webp|png|jpg)$/i.test(base) ? base : `${base}.${ext}`) : null);

// ---------- Idiomas ----------
/**
 * Idiomas disponíveis: os da base local (todos os que têm cartas na TCGdex — pt-pt, nl, pl e ru existem
 * na API, mas sem nenhuma carta). Não depende de rede.
 */
export async function discoverLanguages() {
  return local.LOCAL_LANGS.map((code) => ({ code, label: langLabel(code), local: true }));
}

// ---------- Listas auxiliares (endpoints "Other endpoints") ----------
export const listRarities = (lang) => (isLocal(lang) ? local.listRarities(lang) : fetchJSON(`/${lang}/rarities`));
export const listTypes = (lang) => (isLocal(lang) ? local.listTypes(lang) : fetchJSON(`/${lang}/types`));
/**
 * Cartas que a busca encontra na base em inglês mas que não existem no idioma escolhido
 * (a TCGdex não tem tradução de algumas expansões/promos antigas, ex.: BW Black Star Promos em português).
 */
export async function englishOnly(lang, opts = {}) {
  if (lang === 'en' || !isLocal('en') || !isLocal(lang)) return [];
  const { items } = await local.searchCards('en', { ...opts, page: 1, perPage: 60 });
  const missing = new Set(await local.missingIds(lang, items.map((c) => c.id)));
  return items.filter((c) => missing.has(c.id)).slice(0, 36);
}
/** Mecânicas (Mega, ex, GX, V…) presentes no idioma — só na base local. */
export const listKinds = (lang) => (isLocal(lang) ? local.listKinds(lang) : Promise.resolve([]));
export const rarityLabel = local.rarityLabel;
export const kindLabel = (id) => local.CARD_KINDS.find((k) => k.id === id)?.label || id;
const TYPE_LABELS = { Grass: 'Planta', Fire: 'Fogo', Water: 'Água', Lightning: 'Elétrico', Psychic: 'Psíquico', Fighting: 'Luta', Darkness: 'Escuridão', Metal: 'Metal', Fairy: 'Fada', Dragon: 'Dragão', Colorless: 'Incolor' };
export const typeLabel = (t) => TYPE_LABELS[t] || t;

// ---------- Séries / Expansões ----------
export const listSeries = (lang) => (isLocal(lang) ? local.listSeries(lang) : fetchJSON(`/${lang}/series`));
export const getSerie = (lang, id) => (isLocal(lang) ? local.getSerie(lang, id) : fetchJSON(`/${lang}/series/${encodeURIComponent(id)}`));
export const getSet = (lang, id) => (isLocal(lang) ? local.getSet(lang, id) : fetchJSON(`/${lang}/sets/${encodeURIComponent(id)}`));

// ---------- Cartas ----------
/**
 * Busca cartas (/cards) com filtros documentados (campo=valor, prefixos like:/eq:) e paginação explícita.
 * Retorna CardBrief[] ({ id, localId, name, image? }).
 */
export async function searchCards(lang, opts = {}) {
  if (isLocal(lang)) {
    const { items, total } = await local.searchCards(lang, opts);
    items.total = total;
    return items;
  }
  const { name, localId, rarity, types, illustrator, category, page = 1, perPage = 30, sortField, sortOrder } = opts;
  const params = {};
  if (name) params.name = `like:${name}`;
  if (localId) params.localId = `eq:${localId}`;
  if (rarity) params.rarity = `eq:${rarity}`;
  if (types) params.types = types;
  if (illustrator) params.illustrator = `like:${illustrator}`;
  if (category) params.category = `eq:${category}`;
  if (sortField) { params['sort:field'] = sortField; params['sort:order'] = sortOrder || 'ASC'; }
  params['pagination:page'] = page;
  params['pagination:itemsPerPage'] = perPage;
  return fetchJSON(`/${lang}/cards${qs(params)}`);
}

export async function suggestNames(lang, prefix) {
  if (!prefix || prefix.length < 2) return [];
  if (isLocal(lang)) return local.suggestNames(lang, prefix);
  const list = await fetchJSON(`/${lang}/cards${qs({ name: `like:${prefix}`, 'pagination:page': 1, 'pagination:itemsPerPage': 24 })}`);
  const seen = new Set(); const out = [];
  for (const c of list || []) {
    const k = c.name?.toLowerCase();
    if (k && !seen.has(k)) { seen.add(k); out.push(c.name); }
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Carta completa. Se não existir no idioma pedido, tenta inglês e sinaliza o fallback.
 * @returns {{ card: object, lang: string, fallbackFrom: string|null }}
 */
export async function getCard(id, lang = 'en') {
  if (isLocal(lang)) return { card: await local.getCard(id, lang), lang, fallbackFrom: null };
  try {
    const card = await fetchJSON(`/${lang}/cards/${encodeURIComponent(id)}`);
    return { card, lang, fallbackFrom: null };
  } catch (e) {
    if (e.kind === 'not_found' && lang !== 'en') {
      const card = await local.getCard(id, 'en').catch(() => fetchJSON(`/en/cards/${encodeURIComponent(id)}`));
      return { card, lang: 'en', fallbackFrom: lang };
    }
    throw e;
  }
}

/** Normaliza uma carta TCGdex (completa ou breve) em um snapshot armazenável localmente. */
export function toSnapshot(card, lang, extra = {}) {
  if (!card) return null;
  const set = card.set ? {
    id: card.set.id, name: card.set.name, logo: card.set.logo || null, symbol: card.set.symbol || null,
    logos: card.set.logos || null, symbols: card.set.symbols || null,
    cardCount: card.set.cardCount || null,
  } : (extra.set || null);
  return {
    id: card.id,
    localId: card.localId != null ? String(card.localId) : '',
    name: card.name || '(sem nome)',
    lang,
    image: card.image || null,
    enImage: card.enImage || null,
    alt: card.alt || null,
    category: card.category || null,
    rarity: card.rarity || null,
    illustrator: card.illustrator || null,
    hp: card.hp ?? null,
    types: Array.isArray(card.types) ? card.types : [],
    stage: card.stage || null,
    dexId: Array.isArray(card.dexId) ? card.dexId : [],
    evolveFrom: card.evolveFrom || null,
    energyType: card.energyType || null,
    trainerType: card.trainerType || null,
    regulationMark: card.regulationMark || null,
    variants: card.variants || null,
    legal: card.legal || null,
    effect: card.effect || null,
    attacks: Array.isArray(card.attacks) ? card.attacks.map((a) => ({ name: a.name, cost: a.cost || [], damage: a.damage ?? null, effect: a.effect || null })) : [],
    abilities: Array.isArray(card.abilities) ? card.abilities.map((a) => ({ name: a.name, type: a.type || null, effect: a.effect || null })) : [],
    weaknesses: Array.isArray(card.weaknesses) ? card.weaknesses : [],
    retreat: card.retreat ?? null,
    description: card.description || null,
    set,
    updated: card.updated || null,
    partial: !card.category || card.brief === true, // resumo de carta (sem texto de jogo completo)
    source: extra.source || 'tcgdex',
    fallbackFrom: extra.fallbackFrom || null,
    fetchedAt: new Date().toISOString(),
  };
}

export const variantLabels = {
  normal: 'Normal', reverse: 'Reverse holo', holo: 'Holo', firstEdition: '1ª edição', wPromo: 'Promo (W)',
};
export function availableVariants(snapshot) {
  const v = snapshot?.variants;
  if (!v) return null; // desconhecido
  return Object.entries(v).filter(([, on]) => on === true).map(([k]) => k);
}

// ---------- Fontes de imagem ----------
// Ordem: TCGdex no idioma da carta → TCGdex em inglês (mesma carta) → base PokemonTCG (inglês).
// A TCGdex não tem imagem de algumas cartas/expansões; as fontes seguintes cobrem a maior parte delas.
const ptcgUrl = (alt, quality) => (alt?.k === 's'
  ? `https://images.scrydex.com/pokemon/${alt.id}-${alt.n}/${quality === 'high' ? 'large' : 'small'}`
  : alt ? `https://images.pokemontcg.io/${alt.id}/${alt.n}${quality === 'high' ? '_hires' : ''}.png` : null);

export function cardImageSources(card, quality = 'low') {
  if (!card) return [];
  const out = [cardImageUrl(card.image, quality), cardImageUrl(card.enImage, quality), ptcgUrl(card.alt, quality)];
  return [...new Set(out.filter(Boolean))];
}
/** Fontes extras para uma carta salva antes desta versão (consulta a base local). */
export async function findImageSources(id, lang = 'en', quality = 'low') {
  const r = await local.imageRefs(id, lang);
  return r ? cardImageSources(r, quality) : [];
}
export const setLogoSources = (set) => [...new Set((set?.logos || [set?.logo]).filter(Boolean).map((u) => assetUrl(u)))];
export const setSymbolSources = (set) => [...new Set((set?.symbols || [set?.symbol]).filter(Boolean).map((u) => assetUrl(u)))];
