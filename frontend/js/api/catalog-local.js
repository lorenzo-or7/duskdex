// Catálogo local (base embutida) — gerado por tools/build-catalog.mjs a partir do repositório
// público da TCGdex (MIT). Mesmos IDs e formato de resposta da API REST v2, então as telas não
// precisam saber de onde vieram os dados. Cobre todos os idiomas que têm cartas na base da TCGdex.
import { normalize } from '../core/html.js';
import { LOCAL_LANGS as GENERATED } from './catalog-langs.js';

const BASE = 'data/catalog';
// Arquivos comprimidos (gzip); a prévia online publica a mesma base já descomprimida em .json.
const EXT = window.DUSKDEX_PREVIEW ? '.json' : '.json.gz';
export const LOCAL_LANGS = GENERATED;
export const hasLocal = (lang) => LOCAL_LANGS.includes(lang);

const idx = new Map();      // lang → Promise<index>
const serieCache = new Map(); // `${lang}:${serieId}` → Promise<{ sets }>

/** Lê JSON comprimido (gzip). Se o servidor já descomprimiu (Content-Encoding), lê direto. */
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`Base local indisponível (${res.status}).`), { kind: res.status === 404 ? 'not_found' : 'server' });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw Object.assign(new Error('Este navegador não consegue ler a base local (atualize o navegador).'), { kind: 'server' });
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

function loadIndex(lang) {
  if (!idx.has(lang)) {
    const p = getJSON(`${BASE}/${lang}/index${EXT}`).then((raw) => {
      const sets = new Map(raw.sets.map((s, order) => [s.id, { ...s, order }]));
      const byId = new Map();
      const cards = raw.cards.map(([id, localId, name, setId, rarity, category, types, hp, illustrator, stage, dexId, alt, legal, extra]) => {
        const set = sets.get(setId);
        const c = {
          id, localId, name, setId, rarity, category, hp, illustrator, stage, alt: alt || null, extra: !!extra,
          types: types ? types.split('|') : [],
          dexId: dexId ? dexId.split('|').map(Number) : [],
          legal: { standard: !!(legal & 1), expanded: !!(legal & 2) },
          _n: normalize(name), _a: normalize(illustrator || ''), _order: set?.order ?? 0, _year: (set?.releaseDate || '').slice(0, 4),
          _num: parseInt(localId, 10),
        };
        byId.set(id, c);
        return c;
      });
      return { meta: raw.meta, series: raw.series, sets, cards, byId };
    });
    p.catch(() => idx.delete(lang));
    idx.set(lang, p);
  }
  return idx.get(lang);
}

export const catalogMeta = async (lang) => (await loadIndex(lang)).meta;

// ---------- Imagens: TCGdex no idioma → TCGdex em inglês → PokemonTCG ----------
const altRef = (set, n) => (set?.alt && n ? { k: set.alt.k, id: set.alt.id, n } : null);
// cartas “extra” (só na base PokemonTCG, ex.: 88a) não têm imagem na TCGdex: vão direto para a alternativa
const imageOf = (set, localId, extra) => (set && !extra ? `${set.imageBase}/${localId}` : null);
const enImageOf = (set, localId, extra) => (set?.enBase && !extra ? `${set.enBase}/${localId}` : null);
const setLogos = (s) => [s.logo, s.enBase ? `${s.enBase}/logo` : null, s.alt?.logo].filter(Boolean);
const setSymbols = (s) => [s.symbol, s.alt?.symbol].filter(Boolean);
const setBrief = (s) => ({ id: s.id, name: s.name, logo: s.logo, symbol: s.symbol, logos: setLogos(s), symbols: setSymbols(s), cardCount: s.cardCount, releaseDate: s.releaseDate, serie: s.serie, legal: s.legal || null });
const brief = (c, set) => ({ brief: true, id: c.id, localId: c.localId, name: c.name, image: imageOf(set, c.localId, c.extra), enImage: enImageOf(set, c.localId, c.extra), alt: altRef(set, c.alt), rarity: c.rarity, category: c.category, types: c.types, legal: c.legal, set: set ? { id: set.id, name: set.name } : null });

/**
 * Fontes alternativas de imagem para uma carta salva antes desta versão (snapshot sem `alt`):
 * procura a carta na base local do idioma (ou do inglês) e devolve { enImage, alt }.
 */
export async function imageRefs(id, lang = 'en') {
  for (const l of [lang, 'en']) {
    if (!hasLocal(l)) continue;
    try {
      const ix = await loadIndex(l);
      const c = ix.byId.get(id);
      if (!c) continue;
      const set = ix.sets.get(c.setId);
      return { image: imageOf(set, c.localId, c.extra), enImage: enImageOf(set, c.localId, c.extra), alt: altRef(set, c.alt) };
    } catch { /* base indisponível */ }
  }
  return null;
}

// ---------- Mecânicas / variantes (GX, EX, V…): vêm no nome da carta (cada idioma escreve um pouco diferente) ----------
const END = (re) => (c) => re.test(c.name);
export const CARD_KINDS = [
  { id: 'mega', label: 'Mega', test: (c) => c.category === 'Pokemon' && /^(Mega|M\.?)\s|^メガ/.test(c.name) },
  { id: 'ex', label: 'ex', test: END(/(?:[\s-]|(?<=[^\x00-\x7F]))ex$/) },
  { id: 'EX', label: 'EX', test: END(/(?:[\s-]|(?<=[^\x00-\x7F]))EX$/) },
  { id: 'GX', label: 'GX', test: END(/(?:[\s-]|(?<=[^\x00-\x7F]))GX$/) },
  { id: 'tagteam', label: 'TAG TEAM', test: (c) => /GX$/.test(c.name) && /&|＆| e | y | et | und /.test(c.name) },
  { id: 'V', label: 'V', test: END(/(?:[\s-]|(?<=[^\x00-\x7F]))V$/) },
  { id: 'VMAX', label: 'VMAX', test: END(/VMAX$/) },
  { id: 'VSTAR', label: 'V-ASTRO', test: END(/(VSTAR|V-ASTRO|V ASTRO|\sASTRO)$/) },
  { id: 'VUNION', label: 'V-UNIÃO', test: END(/V-UNI/) },
  { id: 'BREAK', label: 'TURBO (BREAK)', test: END(/(BREAK|TURBO)$/) },
  { id: 'radiant', label: 'Radiante', test: (c) => c.rarity === 'Radiant Rare' },
  { id: 'prism', label: 'Prisma ◇', test: END(/◇$/) },
  { id: 'star', label: 'Estrela ☆', test: END(/☆$/) },
  { id: 'LVX', label: 'Nível X', test: (c) => c.rarity === 'Rare Holo LV.X' || /LV\.?X$/.test(c.name) },
  { id: 'LEGEND', label: 'LENDA', test: (c) => c.rarity === 'LEGEND' || /(LEGEND|LENDA|LEYENDA|LEGENDE|LÉGENDE|LEGGENDA)$/.test(c.name) },
  { id: 'prime', label: 'Prime', test: (c) => c.rarity === 'Rare PRIME' },
  { id: 'delta', label: 'Espécie Delta δ', test: END(/δ$/) },
];
const KIND_BY_ID = new Map(CARD_KINDS.map((k) => [k.id, k]));

/** Nomes das raridades em português (a base guarda o nome em inglês em todos os idiomas). */
export const RARITY_LABELS = {
  'Common': 'Comum', 'Uncommon': 'Incomum', 'Rare': 'Rara', 'Rare Holo': 'Rara Holo', 'Holo Rare': 'Rara Holo',
  'Holo Rare V': 'Rara Holo V', 'Holo Rare VMAX': 'Rara Holo VMAX', 'Holo Rare VSTAR': 'Rara Holo V-ASTRO',
  'Double rare': 'Rara Dupla', 'Triple Rare': 'Rara Tripla', 'Ultra Rare': 'Ultra Rara', 'Illustration rare': 'Ilustração Rara',
  'Special illustration rare': 'Ilustração Rara Especial', 'Hyper rare': 'Hiper Rara', 'Secret Rare': 'Rara Secreta',
  'Shiny rare': 'Rara Brilhante', 'Shiny rare V': 'Rara Brilhante V', 'Shiny rare VMAX': 'Rara Brilhante VMAX', 'Shiny Ultra Rare': 'Ultra Rara Brilhante',
  'ACE SPEC Rare': 'ACE SPEC', 'Amazing Rare': 'Rara Incrível', 'Radiant Rare': 'Rara Radiante', 'Full Art Trainer': 'Treinador Arte Completa',
  'Black White Rare': 'Rara Preto e Branco', 'Mega Attack Rare': 'Rara Ataque Mega', 'Mega Hyper Rare': 'Hiper Rara Mega', 'Futuristic Rare': 'Rara Futurista',
  'Pikachu Rare': 'Rara Pikachu', 'RGB Rare': 'Rara RGB', 'Rare Holo LV.X': 'Rara Holo Nível X', 'Rare PRIME': 'Rara Prime', 'LEGEND': 'LENDA',
  'Classic Collection': 'Coleção Clássica', 'Character Rare': 'Rara de Personagem', 'Character Super Rare': 'Super Rara de Personagem',
  'Promo': 'Promocional', 'None': 'Sem raridade',
};
export const rarityLabel = (r) => RARITY_LABELS[r] || r;

/** Busca com os mesmos filtros da API + extras locais (expansão, ano, faixa da Pokédex, legalidade, mecânica). */
export async function searchCards(lang, { name, localId, rarity, types, illustrator, category, set, year, dex, legal, kind, page = 1, perPage = 30, sortField, sortOrder } = {}) {
  const ix = await loadIndex(lang);
  const n = name ? normalize(name) : '';
  const a = illustrator ? normalize(illustrator) : '';
  const [d0, d1] = dex || [];
  const kindTest = kind ? KIND_BY_ID.get(kind)?.test : null;
  let list = ix.cards.filter((c) => (!n || c._n.includes(n))
    && (!localId || c.localId === localId || String(c._num) === String(parseInt(localId, 10)))
    && (!rarity || c.rarity === rarity)
    && (!types || c.types.includes(types))
    && (!category || c.category === category)
    && (!a || c._a.includes(a))
    && (!set || c.setId === set)
    && (!year || c._year === String(year))
    && (!legal || c.legal[legal])
    && (!kindTest || kindTest(c))
    && (!dex || c.dexId.some((d) => d >= d0 && d <= d1)));
  const dir = sortOrder === 'DESC' ? -1 : 1;
  if (sortField === 'name') list = [...list].sort((x, y) => dir * x.name.localeCompare(y.name) || x._order - y._order);
  else if (sortField === 'releaseDate') list = [...list].sort((x, y) => dir * (x._order - y._order) || (x._num - y._num));
  else if (sortField === 'localId') list = [...list].sort((x, y) => dir * ((x._num - y._num) || x.localId.localeCompare(y.localId)));
  else if (n) {
    // relevância: nome exato, depois começa com, depois contém; dentro disso, mais recentes primeiro
    const rank = (c) => (c._n === n ? 0 : c._n.startsWith(n) ? 1 : 2);
    list = [...list].sort((x, y) => rank(x) - rank(y) || y._order - x._order || x._num - y._num);
  }
  const start = (page - 1) * perPage;
  return { total: list.length, items: list.slice(start, start + perPage).map((c) => brief(c, ix.sets.get(c.setId))) };
}

/** Ids (da lista) que não existem na base deste idioma. */
export async function missingIds(lang, ids) {
  const ix = await loadIndex(lang);
  return ids.filter((id) => !ix.byId.has(id));
}

export async function suggestNames(lang, prefix) {
  const ix = await loadIndex(lang);
  const n = normalize(prefix);
  if (n.length < 2) return [];
  const starts = new Map(); const contains = new Map();
  for (const c of ix.cards) {
    if (c._n.startsWith(n)) starts.set(c._n, c.name);
    else if (c._n.includes(n)) contains.set(c._n, c.name);
    if (starts.size >= 8) break;
  }
  return [...starts.values(), ...contains.values()].slice(0, 8);
}

async function loadSerie(lang, serieId) {
  const k = `${lang}:${serieId}`;
  if (!serieCache.has(k)) {
    const p = getJSON(`${BASE}/${lang}/series/${encodeURIComponent(encodeURIComponent(serieId))}${EXT}`);
    p.catch(() => serieCache.delete(k));
    serieCache.set(k, p);
  }
  return serieCache.get(k);
}
async function setCards(lang, ix, setId) {
  const s = ix.sets.get(setId);
  if (!s) throw Object.assign(new Error('Expansão não encontrada na base local.'), { kind: 'not_found' });
  const serie = await loadSerie(lang, s.serie.id);
  return { s, cards: serie.sets[setId] || [] };
}

export async function getSet(lang, id) {
  const ix = await loadIndex(lang);
  const { s, cards } = await setCards(lang, ix, id);
  return { ...setBrief(s), cards: cards.map((c) => ({ brief: true, id: c.id, localId: c.localId, name: c.name, image: imageOf(s, c.localId, c.extra), enImage: enImageOf(s, c.localId, c.extra), alt: altRef(s, c.alt), rarity: c.rarity, category: c.category, types: c.types, illustrator: c.illustrator, legal: c.legal })) };
}

export async function getCard(id, lang) {
  const ix = await loadIndex(lang);
  const entry = ix.byId.get(id);
  if (!entry) throw Object.assign(new Error('Carta não encontrada na base local.'), { kind: 'not_found' });
  const { s, cards } = await setCards(lang, ix, entry.setId);
  const c = cards.find((x) => x.id === id);
  return { ...c, image: imageOf(s, c.localId, c.extra), enImage: enImageOf(s, c.localId, c.extra), alt: altRef(s, c.alt), set: setBrief(s) };
}

export async function listSeries(lang) {
  const ix = await loadIndex(lang);
  return ix.series.map((s) => ({ id: s.id, name: s.name }));
}

export async function getSerie(lang, id) {
  const ix = await loadIndex(lang);
  const s = ix.series.find((x) => x.id === id);
  if (!s) throw Object.assign(new Error('Série não encontrada.'), { kind: 'not_found' });
  return { id: s.id, name: s.name, sets: s.sets.map((sid) => setBrief(ix.sets.get(sid))) };
}

const distinct = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
export async function listRarities(lang) { return distinct((await loadIndex(lang)).cards.map((c) => c.rarity)); }
export async function listTypes(lang) { return distinct((await loadIndex(lang)).cards.flatMap((c) => c.types)); }
/** Mecânicas que existem neste idioma (com a quantidade de cartas). */
export async function listKinds(lang) {
  const ix = await loadIndex(lang);
  return CARD_KINDS.map((k) => ({ id: k.id, label: k.label, count: ix.cards.reduce((n, c) => n + (k.test(c) ? 1 : 0), 0) })).filter((k) => k.count > 0);
}
export async function listYears(lang) {
  const ix = await loadIndex(lang);
  return [...new Set([...ix.sets.values()].map((s) => (s.releaseDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();
}
