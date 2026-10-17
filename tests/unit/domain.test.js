// Testes unitários das regras de negócio puras (node --test tests/unit/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  binderStats, canPlace, makePage, planAutoArrange, applyArrange, validateDeck, analyzeDeck,
  equivalenceStatus, pickCopiesForDeck, setProgress, speciesProgress, groupCopies, revertConflicts, generationOf,
} from '../../frontend/js/features/domain.js';
import { html, escape } from '../../frontend/js/core/html.js';

const CARDS = {
  'en:base1-58': { id: 'base1-58', name: 'Pikachu', category: 'Pokemon', stage: 'Basic', localId: '58', lang: 'en', dexId: [25], set: { id: 'base1', name: 'Base Set', cardCount: { official: 102 } }, attacks: [{ name: 'Gnaw', cost: ['Colorless'], damage: 10 }] },
  'en:base1-14': { id: 'base1-14', name: 'Raichu', category: 'Pokemon', stage: 'Stage1', localId: '14', lang: 'en', dexId: [26], set: { id: 'base1', name: 'Base Set', cardCount: { official: 102 } } },
  'en:basep-1': { id: 'basep-1', name: 'Pikachu', category: 'Pokemon', stage: 'Basic', localId: '1', lang: 'en', dexId: [25], set: { id: 'basep', name: 'Promos' }, attacks: [{ name: 'Gnaw', cost: ['Colorless'], damage: 10 }] },
  'en:energy': { id: 'base1-102', name: 'Water Energy', category: 'Energy', energyType: 'Basic', localId: '102', lang: 'en', set: { id: 'base1', name: 'Base Set', cardCount: { official: 102 } } },
};
const resolve = (k) => CARDS[k];
const copy = (id, cardKey, extra = {}) => ({ id, cardKey, cardId: cardKey.split(':')[1], lang: 'en', finish: 'normal', status: 'active', createdAt: '2026-10-13', ...extra });

test('template html escapa interpolações (proteção contra XSS)', () => {
  assert.equal(String(html`<p>${'<img src=x onerror=alert(1)>'}</p>`), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(escape('"\'`'), '&quot;&#39;&#96;');
});

test('fichário físico aceita cópia física; virtual não', () => {
  assert.equal(canPlace('physical', 'copy'), true);
  assert.equal(canPlace('virtual', 'copy'), false);
  assert.equal(canPlace('physical', 'virtual'), false);
  assert.equal(canPlace('virtual', 'ghost'), true);
});

test('progresso do fichário não conta fantasmas nem imagens como possuídas', () => {
  const p = makePage(2, 2);
  p.slots[0] = { kind: 'copy', copyId: 'c1', locked: false };
  p.slots[1] = { kind: 'ghost', cardKey: 'en:base1-14', locked: false };
  p.slots[2] = { kind: 'image', assetId: 'a1', locked: true };
  const s = binderStats({ type: 'physical', pages: [p] });
  assert.equal(s.slots, 4);
  assert.equal(s.filled, 1);
  assert.equal(s.progress, 25);
  assert.equal(s.locked, 1);
});

test('organização automática respeita bolsos bloqueados e não perde conteúdo', () => {
  const p = makePage(1, 3);
  p.slots[0] = { kind: 'virtual', cardKey: 'en:base1-58', locked: false }; // Pikachu
  p.slots[1] = { kind: 'image', assetId: 'x', locked: true };            // bloqueado
  p.slots[2] = { kind: 'virtual', cardKey: 'en:base1-14', locked: false }; // Raichu
  const binder = { pages: [p] };
  const plan = planAutoArrange(binder, { criterion: 'name', resolveCard: (s) => resolve(s.cardKey) });
  const pages = applyArrange(binder, plan);
  assert.deepEqual(pages[0].slots[1], p.slots[1], 'bolso bloqueado intacto');
  assert.equal(pages[0].slots[0].cardKey, 'en:base1-58'); // Pikachu < Raichu
  assert.equal(pages[0].slots[2].cardKey, 'en:base1-14');
  assert.equal(binder.pages[0].slots[0].cardKey, 'en:base1-58', 'plano não altera o original');
});

test('validação de deck: tamanho, limite por nome, Básico; legalidade sem dados = não verificada', () => {
  const deck = { format: 'standard', cards: [{ cardKey: 'en:base1-58', qty: 3 }, { cardKey: 'en:basep-1', qty: 2 }, { cardKey: 'en:energy', qty: 55 }] };
  const r = validateDeck(deck, resolve);
  assert.equal(r.total, 60);
  assert.equal(r.structural, 'invalid', '5 Pikachu (mesmo nome em impressões diferentes) excede 4');
  assert.equal(r.legal, 'unverified');
  deck.cards[1].qty = 1; deck.cards[2].qty = 56;
  assert.equal(validateDeck(deck, resolve).structural, 'valid', 'Energia básica é exceção ao limite');
});

test('validação de deck: legalidade por carta (lista da TCGdex) separada da estrutura', () => {
  const legalCards = {
    'en:a': { name: 'Alpha', category: 'Pokemon', stage: 'Basic', legal: { standard: true, expanded: true } },
    'en:b': { name: 'Beta', category: 'Trainer', legal: { standard: false, expanded: true } },
  };
  const deck = { format: 'standard', cards: [{ cardKey: 'en:a', qty: 4 }, { cardKey: 'en:b', qty: 4 }] };
  const r = validateDeck(deck, (k) => legalCards[k]);
  assert.equal(r.legal, 'illegal');
  assert.ok(r.checks.some((c) => c.status === 'bad' && c.text.includes('Beta')));
  deck.format = 'expanded';
  assert.equal(validateDeck(deck, (k) => legalCards[k]).legal, 'legal');
  deck.format = 'casual';
  assert.equal(validateDeck(deck, (k) => legalCards[k]).legal, 'unverified');
});

test('análise do deck: reservas em outro deck não contam como disponíveis', () => {
  const deck = { id: 'd1', cards: [{ cardKey: 'en:base1-58', cardId: 'base1-58', qty: 3 }] };
  const copies = [
    copy('c1', 'en:base1-58'),
    copy('c2', 'en:base1-58', { reservedFor: 'd1' }),
    copy('c3', 'en:base1-58', { reservedFor: 'd2' }),
    copy('c4', 'en:base1-58', { status: 'removed' }),
  ];
  const a = analyzeDeck(deck, copies, resolve);
  assert.equal(a.lines[0].owned, 3);
  assert.equal(a.lines[0].available, 2);
  assert.equal(a.lines[0].missing, 1);
  const pick = pickCopiesForDeck(deck, copies);
  assert.deepEqual(pick.picks.map((p) => p.copyId).sort(), ['c1', 'c2']);
  assert.equal(pick.shortages[0].missing, 1);
});

test('equivalência nunca se baseia só no nome', () => {
  assert.equal(equivalenceStatus(CARDS['en:base1-58'], CARDS['en:basep-1']).status, 'confirmed');
  assert.equal(equivalenceStatus(CARDS['en:base1-58'], { ...CARDS['en:basep-1'], attacks: [{ name: 'Thunder Jolt', damage: 30 }] }).status, 'not_allowed');
  assert.equal(equivalenceStatus(CARDS['en:base1-58'], { ...CARDS['en:basep-1'], lang: 'ja' }).status, 'review');
  assert.equal(equivalenceStatus(CARDS['en:base1-58'], CARDS['en:base1-14']).status, 'not_allowed');
});

test('objetivos contam só cópias reais (sem removidas nem personalizadas)', () => {
  const copies = [copy('c1', 'en:base1-58'), copy('c2', 'en:base1-58'), copy('c3', 'en:base1-14', { status: 'removed' }), { ...copy('c4', 'custom:x'), custom: true }];
  const sets = setProgress(copies, resolve);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].unique, 1);
  assert.equal(sets[0].progress, 1);
  const gen1 = speciesProgress(copies, resolve).find((g) => g.gen === 1);
  assert.equal(gen1.owned, 1);
  assert.equal(generationOf(25), 1);
  assert.equal(groupCopies(copies).find((g) => g.cardKey === 'en:base1-58').copies.length, 2);
});

test('reversão detecta conflitos posteriores', () => {
  const mv = { from: { locationId: 'box', slot: null }, to: { locationId: 'drawer', slot: null } };
  const deps = { slotOccupant: () => null, slotLocked: () => false, locationExists: () => true, binderExists: () => true };
  assert.deepEqual(revertConflicts(mv, copy('c1', 'en:base1-58', { locationId: 'drawer' }), deps), []);
  assert.match(revertConflicts(mv, copy('c1', 'en:base1-58', { locationId: 'shelf' }), deps)[0], /movida novamente/);
  assert.match(revertConflicts(mv, copy('c1', 'en:base1-58', { locationId: 'drawer' }), { ...deps, locationExists: () => false })[0], /origem não existe/);
  const mvSlot = { from: { locationId: 'b', slot: { binderId: 'b', pageId: 'p', index: 0 } }, to: { locationId: 'drawer', slot: null } };
  assert.match(revertConflicts(mvSlot, copy('c1', 'en:base1-58', { locationId: 'drawer' }), { ...deps, slotOccupant: () => 'other' })[0], /ocupado/);
});
