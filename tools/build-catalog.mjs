// Gera o catálogo local (todos os idiomas da TCGdex) a partir de bases públicas:
//   git clone --depth 1 https://github.com/tcgdex/cards-database.git          (licença MIT)
//   git clone --depth 1 https://github.com/PokemonTCG/pokemon-tcg-data.git     (opcional, licença MIT)
//   node tools/build-catalog.mjs <cards-database> [--ptcg <pokemon-tcg-data>] [--langs en,fr,...]
//
// Saída (comprimida em gzip; o navegador descomprime): frontend/data/catalog/<lang>/
//   index.json.gz            busca: séries, expansões e uma linha compacta por carta
//   series/<serieId>.json.gz detalhes das cartas (ataques, habilidades…) de todas as expansões da série
//
// IDs iguais aos da API TCGdex (carta = "<setId>-<localId>"), então base local e API ao vivo são compatíveis.
// Imagens: a TCGdex não publica a lista de imagens existentes fora da API, então cada carta inglesa/internacional
// recebe também o endereço equivalente na base PokemonTCG (quando a expansão e o número batem), usado
// automaticamente quando a imagem da TCGdex não existe.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const src = args[0];
const ALL_LANGS = ['en', 'fr', 'es', 'es-mx', 'it', 'pt', 'pt-br', 'pt-pt', 'de', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh-tw', 'id', 'th', 'zh-cn'];
const ASIA = ['ja', 'ko', 'zh-tw', 'id', 'th', 'zh-cn'];
const langs = opt('--langs') ? opt('--langs').split(',') : ALL_LANGS;
const ptcgDir = opt('--ptcg');
if (!src || !fs.existsSync(path.join(src, 'data'))) {
  console.error('Uso: node tools/build-catalog.mjs <cards-database> [--ptcg <pokemon-tcg-data>] [--langs en,fr]');
  process.exit(1);
}
const outRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'frontend', 'data', 'catalog');

const failures = [];
/** Avalia um arquivo .ts de dados da TCGdex (objeto literal com anotações de tipo simples). */
const loadCache = new Map();
function load(file) {
  if (loadCache.has(file)) return loadCache.get(file);
  let code = fs.readFileSync(file, 'utf8');
  const refs = {};
  const STR = `(?:'(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*")`;
  code = code.replace(new RegExp(`^\\s*import\\s+\\{[^}]*\\}\\s+from\\s+${STR};?\\s*$`, 'gm'), '');
  code = code.replace(/^\s*import\s+type\s+.*$/gm, '');
  code = code.replace(new RegExp(`^\\s*import\\s+(\\w+)\\s+from\\s+${STR};?\\s*$`, 'gm'), (_, name) => { refs[name] = { __ref: name }; return ''; });
  code = code.replace(/^\s*(?:export\s+)?const\s+(\w+)\s*:\s*[\w.<>[\]| ]+\s*=/m, 'var __out =');
  code = code.replace(/^\s*export\s+default\s+\w+;?\s*$/gm, '');
  code = code.replace(/\s+as\s+const\b/g, '').replace(/\s+satisfies\s+\w+/g, '');
  let out = null;
  try {
    const ctx = vm.createContext({ ...refs });
    vm.runInContext(code, ctx, { timeout: 1000 });
    out = ctx.__out;
  } catch (e) {
    failures.push(`${path.relative(src, file)}: ${e.message}`);
  }
  loadCache.set(file, out);
  return out;
}

// Legalidade (Standard/Expanded) — mesma regra do compilador oficial da TCGdex (meta/legals.ts).
function loadLegals() {
  try {
    let code = fs.readFileSync(path.join(src, 'meta', 'legals.ts'), 'utf8');
    code = code.replace(/^\s*import\s+.*$/gm, '').replace(/export const (\w+)\s*:\s*\w+\s*=/g, 'L.$1 =');
    const ctx = vm.createContext({ L: {} });
    vm.runInContext(code, ctx, { timeout: 1000 });
    return ctx.L;
  } catch (e) { console.warn('legals.ts não pôde ser lido:', e.message); return null; }
}
const LEGALS = loadLegals();
const cardLegal = (type, card, set, serieId, localId) => {
  const l = LEGALS?.[type]; if (!l) return false;
  if (l.includes.series.includes(serieId) || l.includes.sets.includes(set.id) || card.energyType === 'Normal'
    || (card.regulationMark && l.includes.regulationMark.includes(card.regulationMark))) {
    return !(l.excludes.sets.includes(set.id) || (type === 'standard' && (card.types || []).includes('Fairy')) || l.excludes.cards.includes(`${set.id}-${localId}`));
  }
  return false;
};
const setLegal = (type, set, serieId) => {
  const l = LEGALS?.[type]; if (!l) return false;
  return (l.includes.series.includes(serieId) || l.includes.sets.includes(set.id)) && !l.excludes.sets.includes(set.id);
};

/** Texto no idioma — mesma regra da TCGdex: exato; para códigos sem região, a primeira variante (pt → pt-br…). */
const clean = (t) => (typeof t === 'string' ? t.replace(/Pok�+mon/g, 'Pokémon').replace(/�/g, '') : t);
const resolve = (v, lang) => {
  if (v == null) return null;
  if (typeof v !== 'object') return clean(v);
  if (v[lang] != null) return clean(v[lang]);
  if (!lang.includes('-')) { const k = Object.keys(v).find((x) => x.startsWith(lang)); if (k) return clean(v[k]); }
  return null;
};
const naturalKey = (id) => { const n = parseInt(id, 10); return Number.isNaN(n) ? [1, id] : [0, n, id]; };
const cmpLocal = (a, b) => { const x = naturalKey(a); const y = naturalKey(b); return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : String(x[2]).localeCompare(String(y[2]))); };
const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
// nomes das duas bases nem sempre batem: "Dialga" × "Dialga LV.X", "Groudon" × "Groudon ★",
// "Professor's Research" × "Professor's Research (Professor Sada)"
const cleanName = (s) => normName(String(s || '').replace(/\([^)]*\)/g, '').replace(/\bLV\.?\s?X\b/gi, '').replace(/[★☆δ◇]/g, ''));
const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const wordsWithin = (a, b) => { const A = words(a); const B = new Set(words(b)); return A.length > 1 && A.every((w) => B.has(w)); };
const normNum = (n) => String(n).replace(/^0+(?=\w)/, '').toLowerCase();

// ---------- Base PokemonTCG: imagens e logos alternativos ----------
const ptcg = { sets: [], cards: new Map() };
if (ptcgDir) {
  ptcg.sets = JSON.parse(fs.readFileSync(path.join(ptcgDir, 'sets', 'en.json'), 'utf8'));
  for (const s of ptcg.sets) {
    const f = path.join(ptcgDir, 'cards', 'en', `${s.id}.json`);
    if (!fs.existsSync(f)) continue;
    const m = new Map(); const byName = new Map();
    const list = JSON.parse(fs.readFileSync(f, 'utf8'));
    list.sort((a, b) => cmpLocal(a.number, b.number));
    for (const c of list) {
      const k0 = normNum(c.number);
      if (!m.has(k0)) m.set(k0, c);
      const k = cleanName(c.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(c); // mesmo nome mais de uma vez: pareado pela ordem
    }
    m.byName = byName; m.list = list;
    ptcg.cards.set(s.id, m);
  }
}
const ptcgSetFor = (set, name) => {
  if (!ptcg.sets.length) return null;
  const year = String(set.releaseDate || '').slice(0, 4);
  const sameYear = (s) => s.releaseDate.slice(0, 4) === year;
  const code = set.abbreviations?.official || set.tcgOnline;
  return ptcg.sets.find((s) => s.id === set.id)
    || (code && ptcg.sets.find((s) => s.ptcgoCode === code && sameYear(s) && normName(s.name) === normName(name)))
    || ptcg.sets.find((s) => normName(s.name) === normName(name) && sameYear(s))
    || (code && ptcg.sets.filter((s) => s.ptcgoCode === code && sameYear(s)).length === 1 && ptcg.sets.find((s) => s.ptcgoCode === code && sameYear(s)))
    // mesma data de lançamento e todas as palavras de um nome dentro do outro
    // (ex.: "30th Classic Collection" ↔ "30th Celebration: Classic Collection")
    || ptcg.sets.find((s) => set.releaseDate && s.releaseDate.replace(/\//g, '-') === set.releaseDate && wordsWithin(name, s.name))
    || null;
};
// identificador da imagem na base alternativa: tirado do próprio endereço (a numeração pode repetir na coleção)
const altNum = (pc) => {
  const u = pc.images?.small || '';
  const m = u.match(/scrydex\.com\/pokemon\/[^/]+?-([^/-]+)\/small$/) || u.match(/pokemontcg\.io\/[^/]+\/([^/]+)\.png$/);
  return m ? m[1] : pc.id.slice(pc.id.indexOf('-') + 1) || pc.number;
};
const altKind = (ps) => (ps.images?.logo?.includes('scrydex') ? 's' : 'p');

/** Carta que só existe na base PokemonTCG (ex.: versões “88a”), no mesmo formato das cartas da TCGdex. */
const STAGE = { Basic: 'Basic', 'Stage 1': 'Stage1', 'Stage 2': 'Stage2', 'MEGA': 'MEGA', 'BREAK': 'BREAK', 'VMAX': 'VMAX', 'VSTAR': 'VSTAR' };
const CAT = { 'Pokémon': 'Pokemon', Trainer: 'Trainer', Energy: 'Energy' };
function fromPtcg(pc, setId, altN) {
  const stage = (pc.subtypes || []).map((s) => STAGE[s]).find(Boolean) || null;
  return {
    id: `${setId}-${altN}`, localId: String(pc.number), name: pc.name, extra: true,
    category: CAT[pc.supertype] || null, rarity: pc.rarity || null, illustrator: pc.artist || null,
    hp: pc.hp ? Number(pc.hp) || null : null, types: pc.types || [], stage, dexId: pc.nationalPokedexNumbers || [],
    evolveFrom: pc.evolvesFrom || null, description: pc.flavorText || null, effect: (pc.rules || []).join(' ') || null,
    trainerType: pc.supertype === 'Trainer' ? (pc.subtypes || [])[0] || null : null, energyType: pc.supertype === 'Energy' ? (pc.subtypes || [])[0] || null : null,
    regulationMark: pc.regulationMark || null, retreat: pc.convertedRetreatCost ?? null,
    attacks: (pc.attacks || []).map((a) => ({ name: a.name, cost: a.cost || [], damage: a.damage || null, effect: a.text || null })),
    abilities: (pc.abilities || []).map((a) => ({ name: a.name, type: a.type || null, effect: a.text || null })),
    weaknesses: (pc.weaknesses || []).map((w) => ({ type: w.type, value: w.value })), resistances: (pc.resistances || []).map((w) => ({ type: w.type, value: w.value })),
    variants: null, alt: altN,
    legal: { standard: pc.legalities?.standard === 'Legal', expanded: pc.legalities?.expanded === 'Legal' },
  };
}

// ---------- Geração ----------
const gz = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 });
const summary = [];
for (const lang of langs) {
  loadCache.clear();
  const root = path.join(src, ASIA.includes(lang) ? 'data-asia' : 'data');
  const outDir = path.join(outRoot, lang);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'series'), { recursive: true });
  const series = []; const sets = []; const index = [];
  let cardsTotal = 0; let altCards = 0; let extraCards = 0;
  for (const serieFile of fs.readdirSync(root).filter((f) => f.endsWith('.ts')).sort()) {
    const serie = load(path.join(root, serieFile));
    const serieName = serie && resolve(serie.name, lang);
    if (!serie?.id || !serieName) continue;
    if (serie.id === 'tcgp') continue; // Pokémon TCG Pocket: jogo digital, sem cartas físicas
    const serieDir = path.join(root, serieFile.replace(/\.ts$/, ''));
    if (!fs.existsSync(serieDir)) continue;
    const serieSets = []; const detail = {};
    for (const setFile of fs.readdirSync(serieDir).filter((f) => f.endsWith('.ts'))) {
      const set = load(path.join(serieDir, setFile));
      const setName = set && resolve(set.name, lang);
      if (!set?.id || !setName) continue;
      const setDir = path.join(serieDir, setFile.replace(/\.ts$/, ''));
      if (!fs.existsSync(setDir)) continue;
      const enName = resolve(set.name, 'en') || setName;
      const ps = ASIA.includes(lang) ? null : ptcgSetFor(set, enName);
      const pcards = ps ? ptcg.cards.get(ps.id) : null;
      const cards = []; const usedAlt = new Set();
      for (const cf of fs.readdirSync(setDir).filter((f) => f.endsWith('.ts')).sort((a, b) => cmpLocal(a.replace(/\.ts$/, ''), b.replace(/\.ts$/, '')))) {
        const c = load(path.join(setDir, cf));
        const name = c && resolve(c.name, lang);
        if (!name) continue; // carta sem versão neste idioma
        const localId = cf.replace(/\.ts$/, '');
        const variants = Array.isArray(c.variants)
          ? Object.fromEntries(c.variants.map((v) => [v.type === 'firstEdition' ? 'firstEdition' : v.type, true]))
          : c.variants && typeof c.variants === 'object' ? c.variants : null;
        // mesma carta: pelo número; se a numeração for outra (coleções comemorativas), pelo nome único na coleção
        const enCardName = cleanName(resolve(c.name, 'en') || name);
        // 1º pelo número (mesmo nome); senão pelo nome, pegando a próxima carta ainda não usada
        // (ex.: Darkrai GX 88, 139, 158 na TCGdex × 88, 88a, 139, 158 na PokemonTCG: a 88a sobra e vira carta extra)
        const byNum = pcards?.get(normNum(localId));
        const sameName = (pcards?.byName.get(enCardName) || []).filter((x) => !usedAlt.has(altNum(x)));
        const prefixed = pcards && !sameName.length ? pcards.list.filter((x) => normName(x.name) === enCardName + 'lvx' && !usedAlt.has(altNum(x))) : [];
        const pc = (byNum && cleanName(byNum.name) === enCardName && !usedAlt.has(altNum(byNum)) ? byNum : null)
          || sameName.find((x) => normNum(x.number) === normNum(localId))
          || (sameName.length ? sameName[0] : null)
          || (prefixed.length === 1 ? prefixed[0] : null); // "Palkia" ↔ "Palkia LV.X"
        const alt = pc ? altNum(pc) : null;
        if (alt) usedAlt.add(alt);
        if (alt) altCards++;
        const legal = { standard: cardLegal('standard', c, set, serie.id, localId), expanded: cardLegal('expanded', c, set, serie.id, localId) };
        cards.push({
          id: `${set.id}-${localId}`, localId, name,
          category: c.category || null, rarity: c.rarity || null, illustrator: c.illustrator || null,
          hp: c.hp ?? null, types: Array.isArray(c.types) ? c.types : [], stage: c.stage || null,
          dexId: Array.isArray(c.dexId) ? c.dexId : [], evolveFrom: resolve(c.evolveFrom, lang),
          description: resolve(c.description, lang), effect: resolve(c.effect, lang),
          trainerType: c.trainerType || null, energyType: c.energyType || null, regulationMark: c.regulationMark || null,
          retreat: c.retreat ?? null,
          attacks: (c.attacks || []).map((a) => ({ name: resolve(a.name, lang), cost: a.cost || [], damage: a.damage ?? null, effect: resolve(a.effect, lang) })).filter((a) => a.name),
          abilities: (c.abilities || []).map((a) => ({ name: resolve(a.name, lang), type: a.type || null, effect: resolve(a.effect, lang) })).filter((a) => a.name),
          weaknesses: c.weaknesses || [], resistances: c.resistances || [], variants, legal, alt,
        });
      }
      if (lang === 'en' && pcards) {
        const haveNum = new Set(cards.map((c) => normNum(c.localId)));
        const haveAlt = new Set(cards.map((c) => c.alt).filter(Boolean));
        for (const pc of pcards.list) {
          const n = altNum(pc);
          if (haveAlt.has(n) || haveNum.has(normNum(pc.number))) continue; // a TCGdex já tem essa carta
          if (/^[A-Z!?]$/.test(String(pc.number))) continue; // Unown A–Z/!/? ficam numa expansão própria na TCGdex
          cards.push(fromPtcg(pc, set.id, n));
          haveAlt.add(n); extraCards++;
        }
      }
      if (!cards.length) continue;
      cards.sort((a, b) => cmpLocal(a.localId, b.localId));
      const releaseDate = typeof set.releaseDate === 'object' && set.releaseDate ? (set.releaseDate[lang] ?? Object.values(set.releaseDate)[0]) : set.releaseDate || null;
      const info = {
        id: set.id, name: setName, serie: { id: serie.id, name: serieName },
        releaseDate, tcgOnline: set.tcgOnline || null,
        cardCount: { official: set.cardCount?.official ?? cards.length, total: Math.max(set.cardCount?.official ?? 0, cards.length) },
        logo: `https://assets.tcgdex.net/${lang}/${serie.id}/${set.id}/logo`,
        symbol: `https://assets.tcgdex.net/univ/${serie.id}/${set.id}/symbol`,
        imageBase: `https://assets.tcgdex.net/${lang}/${serie.id}/${set.id}`,
        enBase: ASIA.includes(lang) || lang === 'en' ? null : `https://assets.tcgdex.net/en/${serie.id}/${set.id}`,
        alt: ps ? { k: altKind(ps), id: ps.id, logo: ps.images?.logo || null, symbol: ps.images?.symbol || null } : null,
        legal: { standard: setLegal('standard', set, serie.id), expanded: setLegal('expanded', set, serie.id) },
      };
      detail[set.id] = cards;
      // linha compacta: [id, localId, name, setId, rarity, category, types, hp, illustrator, stage, dexId, alt, legal(bit0 std, bit1 exp)]
      for (const c of cards) index.push([c.id, c.localId, c.name, set.id, c.rarity, c.category, c.types.join('|'), c.hp, c.illustrator, c.stage, c.dexId.join('|'), c.alt || '', (c.legal.standard ? 1 : 0) | (c.legal.expanded ? 2 : 0), c.extra ? 1 : 0]);
      cardsTotal += cards.length;
      serieSets.push(info);
    }
    if (!serieSets.length) continue;
    serieSets.sort((a, b) => String(a.releaseDate).localeCompare(String(b.releaseDate)));
    sets.push(...serieSets);
    series.push({ id: serie.id, name: serieName, firstRelease: serieSets[0].releaseDate, sets: serieSets.map((s) => s.id) });
    fs.writeFileSync(path.join(outDir, 'series', `${encodeURIComponent(serie.id)}.json.gz`), gz({ serie: serie.id, sets: detail }));
  }
  if (!cardsTotal) { fs.rmSync(outDir, { recursive: true, force: true }); summary.push(`${lang}: sem cartas neste idioma na base`); console.log(summary.at(-1)); continue; }
  series.sort((a, b) => String(a.firstRelease).localeCompare(String(b.firstRelease)));
  const meta = {
    source: 'TCGdex cards-database (MIT) — https://github.com/tcgdex/cards-database' + (ptcgDir ? ' · imagens alternativas: PokemonTCG pokemon-tcg-data (MIT)' : ''),
    lang, generatedAt: new Date().toISOString(), cards: cardsTotal, sets: sets.length, series: series.length, altImages: altCards,
    columns: ['id', 'localId', 'name', 'setId', 'rarity', 'category', 'types', 'hp', 'illustrator', 'stage', 'dexId', 'alt', 'legal', 'extra'],
  };
  fs.writeFileSync(path.join(outDir, 'index.json.gz'), gz({ meta, series, sets, cards: index }));
  // índice pequeno de expansões (o servidor PHP usa para validar cartas sem carregar o índice inteiro)
  fs.writeFileSync(path.join(outDir, 'sets.json'), JSON.stringify(Object.fromEntries(sets.map((x) => [x.id, x]))));
  summary.push(`${lang}: ${cardsTotal} cartas, ${sets.length} expansões, ${series.length} séries, ${altCards} com imagem alternativa${extraCards ? `, ${extraCards} só na base PokemonTCG` : ''}`);
  console.log(summary.at(-1));
}
// lista de idiomas disponíveis localmente (o app lê para montar o seletor sem depender da API)
const available = fs.readdirSync(outRoot).filter((d) => fs.existsSync(path.join(outRoot, d, 'index.json.gz')));
const langMeta = available.map((code) => {
  const ix = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(outRoot, code, 'index.json.gz'))));
  return { code, cards: ix.meta.cards, sets: ix.meta.sets };
});
fs.writeFileSync(path.join(outRoot, 'languages.json'), JSON.stringify({ generatedAt: new Date().toISOString(), langs: langMeta }));
// módulo lido pelo app para saber, sem rede, quais idiomas têm base local
const order = ALL_LANGS.filter((l) => available.includes(l));
fs.writeFileSync(path.resolve(outRoot, '..', '..', 'js', 'api', 'catalog-langs.js'),
  `// Gerado por tools/build-catalog.mjs — idiomas com base local embutida.\nexport const LOCAL_LANGS = ${JSON.stringify(order)};\n`);
if (failures.length) {
  console.log(`${failures.length} arquivo(s) não puderam ser lidos (ignorados):`);
  failures.slice(0, 20).forEach((f) => console.log('  ' + f));
}
