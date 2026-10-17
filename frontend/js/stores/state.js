// Carregamento agregado e consultas derivadas usadas por várias telas.
import { data, card, reloadCards } from '../api/index.js';

export async function loadAll(parts = ['copies', 'binders', 'locations', 'decks', 'wishlist']) {
  const db = data();
  const map = {
    copies: () => db.listCopies(),
    binders: () => db.listBinders(),
    locations: () => db.listLocations(),
    decks: () => db.listDecks(),
    wishlist: () => db.listWishlist(),
    batches: () => db.listBatches(),
    activity: () => db.listActivity(20),
    profile: () => db.getProfile(),
  };
  const entries = await Promise.all(parts.map(async (p) => [p, await map[p]()]));
  const out = Object.fromEntries(entries);
  // Cartas que chegaram de fora desta tela (troca aceita por outra pessoa, outra aba/aparelho):
  // se alguma carta referenciada não está na memória, recarrega os snapshots uma vez.
  const keys = [
    ...(out.copies || []).map((c) => c.cardKey),
    ...(out.wishlist || []).map((w) => w.cardKey),
    ...(out.decks || []).flatMap((d) => (d.cards || []).map((l) => l.cardKey)),
  ];
  if (keys.some((k) => k && !card(k))) await reloadCards();
  return out;
}

export const activeCopies = (copies) => copies.filter((c) => c.status !== 'removed');

export function ownedByCardId(copies) {
  const m = new Map();
  for (const c of activeCopies(copies)) m.set(c.cardId, (m.get(c.cardId) || 0) + 1);
  return m;
}

export function locationPath(id, locations) {
  const parts = []; let cur = locations.find((l) => l.id === id); let guard = 0;
  while (cur && guard++ < 20) { parts.unshift(cur.name); cur = locations.find((l) => l.id === cur.parentId); }
  return parts.join(' › ');
}

/** Descrição legível de onde uma cópia está. */
export function copyWhere(copy, { binders = [], locations = [], decks = [] }) {
  if (copy.status === 'removed') return 'Fora da coleção';
  if (copy.slot) {
    const b = binders.find((x) => x.id === copy.slot.binderId);
    if (b) {
      const pn = b.pages.findIndex((p) => p.id === copy.slot.pageId) + 1;
      return `${b.name} · pág. ${pn} · bolso ${copy.slot.index + 1}`;
    }
  }
  if (copy.deckAssembled) {
    const d = decks.find((x) => x.id === copy.reservedFor);
    return `Deck montado · ${d?.name || '—'}`;
  }
  return locationPath(copy.locationId, locations) || '—';
}

/** Onde uma carta (por id TCGdex) aparece planejada: fantasmas e referências em fichários. */
export function plannedIn(cardId, binders) {
  const out = [];
  for (const b of binders) {
    b.pages.forEach((p, pi) => p.slots.forEach((s, si) => {
      if ((s.kind === 'ghost' || s.kind === 'virtual') && card(s.cardKey)?.id === cardId) out.push({ binder: b, page: pi, pageId: p.id, index: si, kind: s.kind });
    }));
  }
  return out;
}

export function deckNeeds(cardId, decks, copies) {
  const owned = ownedByCardId(copies).get(cardId) || 0;
  return decks.map((d) => {
    const line = d.cards.find((l) => l.cardId === cardId);
    return line ? { deck: d, qty: line.qty, missing: Math.max(0, line.qty - owned) } : null;
  }).filter(Boolean);
}

export const slotCard = (slot) => (slot && slot.cardKey ? card(slot.cardKey) : null);
