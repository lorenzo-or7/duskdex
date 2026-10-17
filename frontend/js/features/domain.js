// Regras de negócio puras (sem DOM). Usadas pelo adaptador demo e pelas telas; testadas em Node (tests/unit).

export const LAYOUTS = [
  { id: '2x2', cols: 2, rows: 2, label: '2×2 · 4 bolsos' },
  { id: '3x3', cols: 3, rows: 3, label: '3×3 · 9 bolsos' },
  { id: '4x3', cols: 4, rows: 3, label: '4×3 · 12 bolsos' },
  { id: '4x4', cols: 4, rows: 4, label: '4×4 · 16 bolsos' },
];
export const MAX_GRID = 6;

export const SLOT_KINDS = {
  empty: 'Vazio', copy: 'Carta física', virtual: 'Referência virtual', ghost: 'Carta fantasma', image: 'Imagem personalizada',
};

// Faixas oficiais da Pokédex Nacional por geração (dado estável, não inferido de nomes).
export const GENERATIONS = [
  { gen: 1, label: 'Kanto', from: 1, to: 151 },
  { gen: 2, label: 'Johto', from: 152, to: 251 },
  { gen: 3, label: 'Hoenn', from: 252, to: 386 },
  { gen: 4, label: 'Sinnoh', from: 387, to: 493 },
  { gen: 5, label: 'Unova', from: 494, to: 649 },
  { gen: 6, label: 'Kalos', from: 650, to: 721 },
  { gen: 7, label: 'Alola', from: 722, to: 809 },
  { gen: 8, label: 'Galar / Hisui', from: 810, to: 905 },
  { gen: 9, label: 'Paldea', from: 906, to: 1025 },
];
export const generationOf = (dex) => GENERATIONS.find((g) => dex >= g.from && dex <= g.to)?.gen ?? null;

export const cardKeyOf = (id, lang) => `${lang}:${id}`;
export const isCustomKey = (key) => String(key).startsWith('custom:');

// ---------------- Fichários ----------------
export const emptySlot = () => ({ kind: 'empty', locked: false });

export function makePage(rows, cols) {
  return { id: 'p' + Math.random().toString(36).slice(2, 9), rows, cols, slots: Array.from({ length: rows * cols }, emptySlot) };
}

export function binderStats(binder) {
  const s = { slots: 0, copy: 0, ghost: 0, image: 0, virtual: 0, empty: 0, locked: 0 };
  for (const p of binder.pages || []) {
    for (const slot of p.slots) {
      s.slots++;
      s[slot.kind] = (s[slot.kind] || 0) + 1;
      if (slot.locked) s.locked++;
    }
  }
  // Progresso: físicos contam bolsos com carta real; virtuais contam bolsos planejados (referências/imagens).
  s.filled = binder.type === 'physical' ? s.copy : s.virtual + s.copy + s.image;
  s.planned = s.filled + s.ghost;
  s.progress = s.slots ? Math.round((s.filled / s.slots) * 100) : 0;
  return s;
}

/** Valida se um conteúdo é permitido no tipo de fichário. */
export function canPlace(binderType, kind) {
  if (kind === 'copy') return binderType === 'physical';
  if (kind === 'virtual') return binderType === 'virtual';
  return true;
}

const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Rare Holo', 'Double rare', 'Ultra Rare', 'Illustration rare', 'Special illustration rare', 'Hyper rare', 'Secret Rare'];

function sortValue(criterion, card, slot) {
  if (!card) return [2, ''];
  switch (criterion) {
    case 'name': return [0, (card.name || '').toLowerCase()];
    case 'set': return [0, `${card.set?.id || '~'}|${String(card.localId).padStart(5, '0')}`];
    case 'number': return [0, `${String(parseInt(card.localId, 10) || 99999).padStart(5, '0')}|${card.localId}`];
    case 'rarity': {
      const i = RARITY_ORDER.findIndex((r) => r.toLowerCase() === String(card.rarity || '').toLowerCase());
      return [card.rarity ? 0 : 1, `${String(i < 0 ? 99 : i).padStart(2, '0')}|${card.name}`];
    }
    case 'type': return [card.types?.length ? 0 : 1, `${(card.types?.[0] || card.category || '~')}|${card.name}`];
    case 'lang': return [0, `${slot.lang || card.lang || '~'}|${card.name}`];
    default: return [0, ''];
  }
}

/**
 * Planeja uma organização automática.
 * - Slots bloqueados permanecem intactos.
 * - Conteúdos móveis (não vazios e não bloqueados) das páginas escolhidas são ordenados e redistribuídos
 *   nos slots livres (não bloqueados), na ordem de leitura.
 * Retorna { moves: [{ from, to, slot }], changed } sem alterar o fichário.
 */
export function planAutoArrange(binder, { criterion = 'name', pages = null, resolveCard }) {
  const pageIdx = pages ?? binder.pages.map((_, i) => i);
  const positions = []; const items = [];
  for (const pi of pageIdx) {
    binder.pages[pi].slots.forEach((slot, si) => {
      if (slot.locked) return;
      positions.push({ page: pi, index: si });
      if (slot.kind !== 'empty') items.push({ from: { page: pi, index: si }, slot });
    });
  }
  const sorted = items
    .map((it) => ({ ...it, key: sortValue(criterion, resolveCard(it.slot), it.slot) }))
    .sort((a, b) => a.key[0] - b.key[0] || (a.key[1] < b.key[1] ? -1 : a.key[1] > b.key[1] ? 1 : 0));
  const moves = sorted.map((it, i) => ({ from: it.from, to: positions[i], slot: it.slot }));
  const changed = moves.filter((m) => m.from.page !== m.to.page || m.from.index !== m.to.index);
  return { moves, changed, freeSlots: positions.length, items: items.length };
}

/** Aplica um plano produzido por planAutoArrange (retorna novas páginas). */
export function applyArrange(binder, plan) {
  const pages = binder.pages.map((p) => ({ ...p, slots: p.slots.map((s) => ({ ...s })) }));
  for (const m of plan.moves) pages[m.from.page].slots[m.from.index] = { kind: 'empty', locked: false };
  for (const m of plan.moves) pages[m.to.page].slots[m.to.index] = { ...m.slot, locked: false };
  return pages;
}

// ---------------- Decks ----------------
export const DECK_FORMATS = {
  standard: { label: 'Standard', size: 60, maxCopies: 4, requiresBasic: true },
  expanded: { label: 'Expanded', size: 60, maxCopies: 4, requiresBasic: true },
  casual: { label: 'Livre / casual', size: null, maxCopies: null, requiresBasic: false },
};

const isBasicEnergy = (c) => c?.category === 'Energy' && String(c?.energyType || '').toLowerCase() === 'basic';

/**
 * Validação estrutural com regras verificáveis localmente (versão de regras: 2026-10, informativa).
 * Nunca declara legalidade em torneio: o resultado "legal" é sempre 'unverified'.
 */
export function validateDeck(deck, resolveCard) {
  const fmt = DECK_FORMATS[deck.format] || DECK_FORMATS.casual;
  const checks = [];
  const lines = deck.cards || [];
  const total = lines.reduce((n, l) => n + l.qty, 0);
  const unknown = lines.filter((l) => { const c = resolveCard(l.cardKey); return !c || c.partial || !c.category; });

  if (fmt.size) {
    checks.push(total === fmt.size
      ? { status: 'ok', text: `Tem exatamente ${fmt.size} cartas.` }
      : { status: 'bad', text: `Tem ${total} cartas; o formato ${fmt.label} exige ${fmt.size}.` });
  } else {
    checks.push({ status: 'ok', text: `${total} cartas (formato livre, sem tamanho fixo).` });
  }

  if (fmt.maxCopies) {
    const byName = new Map();
    for (const l of lines) {
      const c = resolveCard(l.cardKey);
      if (!c) continue;
      if (isBasicEnergy(c)) continue;
      const k = (c.name || '').trim().toLowerCase();
      byName.set(k, { name: c.name, qty: (byName.get(k)?.qty || 0) + l.qty });
    }
    const over = [...byName.values()].filter((x) => x.qty > fmt.maxCopies);
    checks.push(over.length
      ? { status: 'bad', text: `Mais de ${fmt.maxCopies} cópias com o mesmo nome: ${over.map((o) => `${o.name} (${o.qty})`).join(', ')}.` }
      : { status: unknown.length ? 'unknown' : 'ok', text: unknown.length ? `Limite de ${fmt.maxCopies} cópias por nome respeitado nas cartas com dados completos.` : `Nenhum nome passa de ${fmt.maxCopies} cópias (Energia básica é exceção).` });
  }

  if (fmt.requiresBasic) {
    const hasBasic = lines.some((l) => { const c = resolveCard(l.cardKey); return c?.category === 'Pokemon' && c?.stage === 'Basic'; });
    checks.push(hasBasic
      ? { status: 'ok', text: 'Possui ao menos um Pokémon Básico.' }
      : { status: unknown.length ? 'unknown' : 'bad', text: unknown.length ? 'Não foi possível confirmar um Pokémon Básico (dados incompletos).' : 'Nenhum Pokémon Básico encontrado.' });
  }

  if (unknown.length) checks.push({ status: 'unknown', text: `${unknown.length} carta(s) sem dados completos de categoria/estágio — validação parcial.` });

  // Legalidade por carta: lista Standard/Expanded da TCGdex (regulation marks, séries e banimentos).
  if (deck.format === 'standard' || deck.format === 'expanded') {
    const illegal = []; const noData = [];
    for (const l of lines) {
      const c = resolveCard(l.cardKey);
      const v = c?.legal?.[deck.format];
      if (v === false) illegal.push(c.name); else if (v !== true) noData.push(c?.name || l.cardKey);
    }
    if (illegal.length) checks.push({ legal: true, status: 'bad', text: `Fora do ${fmt.label} segundo a TCGdex: ${[...new Set(illegal)].join(', ')}.` });
    else if (noData.length) checks.push({ legal: true, status: 'unknown', text: `Legalidade no ${fmt.label} sem dados para ${noData.length} carta(s) — adicione-as de novo pelo catálogo para atualizar.` });
    else if (lines.length) checks.push({ legal: true, status: 'ok', text: `Todas as cartas constam como legais no ${fmt.label} na lista da TCGdex.` });
    checks.push({ legal: true, status: 'unknown', text: 'Legalidade segundo a lista pública da TCGdex: confira o anúncio oficial de rotação e banimentos antes de um torneio.' });
  }

  // estrutura (tamanho, cópias, Básico) e legalidade são avaliadas separadamente
  const structuralChecks = checks.filter((c) => !c.legal);
  const bad = structuralChecks.some((c) => c.status === 'bad');
  const partial = structuralChecks.some((c) => c.status === 'unknown');
  const legalChecks = checks.filter((c) => c.legal && !c.text.startsWith('Legalidade segundo'));
  const legal = !legalChecks.length ? 'unverified' : legalChecks.some((c) => c.status === 'bad') ? 'illegal' : legalChecks.some((c) => c.status === 'unknown') ? 'unverified' : 'legal';
  return {
    checks,
    total,
    structural: bad ? 'invalid' : partial ? 'partial' : 'valid',
    legal,
  };
}

/**
 * Compara a decklist com as cópias do usuário.
 * Só conta como "possuída" a MESMA impressão (mesmo id TCGdex, qualquer idioma).
 * Cartas com o mesmo nome e outro id aparecem como equivalências que "requerem revisão".
 */
export function analyzeDeck(deck, copies, resolveCard) {
  const active = copies.filter((c) => c.status !== 'removed');
  const lines = (deck.cards || []).map((l) => {
    const card = resolveCard(l.cardKey);
    const same = active.filter((c) => c.cardId === l.cardId);
    const reservedHere = same.filter((c) => c.reservedFor === deck.id);
    const reservedElsewhere = same.filter((c) => c.reservedFor && c.reservedFor !== deck.id);
    const free = same.filter((c) => !c.reservedFor);
    const name = (card?.name || '').toLowerCase();
    const candidates = name ? active.filter((c) => c.cardId !== l.cardId && !c.reservedFor && (resolveCard(c.cardKey)?.name || '').toLowerCase() === name) : [];
    const available = reservedHere.length + free.length;
    return {
      ...l, card,
      owned: same.length,
      reservedHere: reservedHere.length,
      reservedElsewhere: reservedElsewhere.length,
      available,
      missing: Math.max(0, l.qty - available),
      candidates,
    };
  });
  const need = lines.reduce((n, l) => n + l.qty, 0);
  const have = lines.reduce((n, l) => n + Math.min(l.qty, l.available), 0);
  return { lines, need, have, missing: need - have, progress: need ? Math.round((have / need) * 100) : 0 };
}

/**
 * Equivalência entre duas impressões para fins de deck. Nunca usa só o nome:
 * - 'confirmed': mesmo nome, mesma categoria e textos de jogo idênticos (ataques, habilidades, efeito) nos dados disponíveis, no mesmo idioma.
 * - 'not_allowed': mesmo nome mas textos de jogo diferentes (cartas distintas para as regras).
 * - 'review': dados insuficientes, idiomas diferentes ou outra incerteza — o usuário precisa revisar.
 * Rotação, banimentos e erratas não são avaliados aqui.
 */
export function equivalenceStatus(a, b) {
  if (!a || !b) return { status: 'review', reason: 'Dados da carta indisponíveis.' };
  if ((a.name || '').trim().toLowerCase() !== (b.name || '').trim().toLowerCase()) return { status: 'not_allowed', reason: 'Nomes diferentes.' };
  if (a.partial || b.partial || !a.category || !b.category) return { status: 'review', reason: 'Dados incompletos de uma das impressões.' };
  if (a.category !== b.category) return { status: 'not_allowed', reason: 'Categorias diferentes.' };
  if (a.lang !== b.lang) return { status: 'review', reason: 'Idiomas diferentes: não é possível comparar os textos automaticamente.' };
  const text = (c) => JSON.stringify({
    atk: (c.attacks || []).map((x) => [x.name, (x.cost || []).join(','), String(x.damage ?? ''), x.effect || '']),
    ab: (c.abilities || []).map((x) => [x.name, x.effect || '']),
    ef: c.effect || '', hp: c.hp ?? null,
  });
  if (!(a.attacks?.length || a.abilities?.length || a.effect)) return { status: 'review', reason: 'A TCGdex não forneceu o texto de jogo para comparar.' };
  return text(a) === text(b)
    ? { status: 'confirmed', reason: 'Textos de jogo idênticos nos dados disponíveis. Verifique erratas e rotação antes de torneios.' }
    : { status: 'not_allowed', reason: 'Textos de jogo diferentes: são cartas distintas para as regras.' };
}

/** Escolhe automaticamente cópias para montar o deck (prefere já reservadas, depois livres fora de fichários). */
export function pickCopiesForDeck(deck, copies) {
  const picks = []; const shortages = [];
  for (const l of deck.cards || []) {
    const pool = copies
      .filter((c) => c.status !== 'removed' && c.cardId === l.cardId && (!c.reservedFor || c.reservedFor === deck.id))
      .sort((a, b) => (b.reservedFor === deck.id) - (a.reservedFor === deck.id) || (a.slot ? 1 : 0) - (b.slot ? 1 : 0));
    const chosen = pool.slice(0, l.qty);
    picks.push(...chosen.map((c) => ({ copyId: c.id, cardKey: l.cardKey })));
    if (chosen.length < l.qty) shortages.push({ cardKey: l.cardKey, missing: l.qty - chosen.length });
  }
  return { picks, shortages };
}

// ---------------- Objetivos ----------------
export function setProgress(copies, resolveCard) {
  const sets = new Map();
  for (const c of copies) {
    if (c.status === 'removed' || c.custom) continue;
    const card = resolveCard(c.cardKey);
    if (!card?.set?.id) continue;
    const s = sets.get(card.set.id) || { id: card.set.id, name: card.set.name || card.set.id, official: card.set.cardCount?.official ?? null, total: card.set.cardCount?.total ?? null, owned: new Set(), logo: card.set.logo || null };
    s.owned.add(card.id);
    sets.set(card.set.id, s);
  }
  return [...sets.values()].map((s) => ({ ...s, unique: s.owned.size, progress: s.official ? Math.min(100, Math.round((s.owned.size / s.official) * 100)) : null }))
    .sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1));
}

export function speciesProgress(copies, resolveCard) {
  const owned = new Set();
  for (const c of copies) {
    if (c.status === 'removed' || c.custom) continue;
    const card = resolveCard(c.cardKey);
    (card?.dexId || []).forEach((d) => owned.add(d));
  }
  return GENERATIONS.map((g) => {
    let n = 0;
    owned.forEach((d) => { if (d >= g.from && d <= g.to) n++; });
    const size = g.to - g.from + 1;
    return { ...g, owned: n, size, progress: Math.round((n / size) * 100) };
  });
}

/** Agrupa cópias em entradas (carta + idioma + acabamento) para a tela de coleção. */
export function groupCopies(copies) {
  const map = new Map();
  for (const c of copies) {
    if (c.status === 'removed') continue;
    const k = `${c.cardKey}|${c.lang}|${c.finish}`;
    const e = map.get(k) || { key: k, cardKey: c.cardKey, cardId: c.cardId, lang: c.lang, finish: c.finish, copies: [], lastAdded: c.createdAt, custom: !!c.custom };
    e.copies.push(c);
    if (c.createdAt > e.lastAdded) e.lastAdded = c.createdAt;
    map.set(k, e);
  }
  return [...map.values()];
}

/** Verifica se um movimento pode ser revertido; retorna a lista de conflitos. */
export function revertConflicts(movement, copy, { slotOccupant, slotLocked, locationExists, binderExists }) {
  const conflicts = [];
  if (!copy || copy.status === 'removed') { conflicts.push('A cópia foi removida da coleção depois desta operação.'); return conflicts; }
  const to = movement.to; const from = movement.from;
  const atDest = copy.locationId === to.locationId && sameSlot(copy.slot, to.slot);
  if (!atDest) conflicts.push('A cópia foi movida novamente depois desta operação.');
  if (copy.reservedFor && copy.deckAssembled) conflicts.push('A cópia está montada em um deck físico.');
  if (from.locationId && !locationExists(from.locationId)) conflicts.push('O local de origem não existe mais.');
  if (from.slot) {
    if (!binderExists(from.slot.binderId)) conflicts.push('O fichário de origem não existe mais.');
    else {
      const occ = slotOccupant(from.slot);
      if (occ && occ !== copy.id) conflicts.push('O bolso de origem já está ocupado por outra carta.');
      if (slotLocked(from.slot)) conflicts.push('O bolso de origem está bloqueado.');
    }
  }
  return conflicts;
}
export const sameSlot = (a, b) => (!a && !b) || (!!a && !!b && a.binderId === b.binderId && a.pageId === b.pageId && a.index === b.index);
