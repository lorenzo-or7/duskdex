// DADOS DE EXEMPLO (opcionais) do modo convidado. Identificados como `source: 'demo-seed'` e rotulados na interface.
// O convidado começa com a coleção vazia; estes exemplos só são criados se a pessoa escolher "Explorar com exemplos".
// Os ids seguem o formato da TCGdex (setId-localId) para que imagens e detalhes possam ser
// carregados da API quando houver internet; os metadados abaixo são uma amostra e podem divergir do catálogo oficial.
import { cardKeyOf } from './domain.js';

const BASE1 = { id: 'base1', name: 'Base Set', logo: 'https://assets.tcgdex.net/en/base/base1/logo', symbol: 'https://assets.tcgdex.net/univ/base/base1/symbol', cardCount: { official: 102, total: 102 } };
const SWSH3 = { id: 'swsh3', name: 'Darkness Ablaze', logo: 'https://assets.tcgdex.net/en/swsh/swsh3/logo', symbol: 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol', cardCount: { official: 189, total: 201 } };

const P = (set, serie, localId, name, extra) => ({
  id: `${set.id}-${localId}`, localId: String(localId), name, lang: 'en',
  image: `https://assets.tcgdex.net/en/${serie}/${set.id}/${localId}`,
  set, category: 'Pokemon', source: 'demo-seed', partial: false, types: [], dexId: [], attacks: [], abilities: [], weaknesses: [],
  variants: { normal: true, reverse: false, holo: false, firstEdition: set.id === 'base1' }, ...extra,
});
const T = (set, serie, localId, name, extra) => ({ ...P(set, serie, localId, name, extra), category: 'Trainer', stage: null, trainerType: 'Item', ...extra });
const E = (set, serie, localId, name, extra) => ({ ...P(set, serie, localId, name, extra), category: 'Energy', energyType: 'Basic', ...extra });

export const SEED_CARDS = [
  P(BASE1, 'base', 1, 'Alakazam', { rarity: 'Rare', types: ['Psychic'], stage: 'Stage2', dexId: [65], hp: 80, illustrator: 'Ken Sugimori', variants: { normal: false, holo: true, reverse: false, firstEdition: true } }),
  P(BASE1, 'base', 2, 'Blastoise', { rarity: 'Rare', types: ['Water'], stage: 'Stage2', dexId: [9], hp: 100, illustrator: 'Ken Sugimori', variants: { normal: false, holo: true, reverse: false, firstEdition: true } }),
  P(BASE1, 'base', 4, 'Charizard', { rarity: 'Rare', types: ['Fire'], stage: 'Stage2', dexId: [6], hp: 120, illustrator: 'Mitsuhiro Arita', variants: { normal: false, holo: true, reverse: false, firstEdition: true } }),
  P(BASE1, 'base', 6, 'Gyarados', { rarity: 'Rare', types: ['Water'], stage: 'Stage1', dexId: [130], hp: 100, illustrator: 'Mitsuhiro Arita', variants: { normal: false, holo: true, reverse: false, firstEdition: true } }),
  P(BASE1, 'base', 10, 'Mewtwo', { rarity: 'Rare', types: ['Psychic'], stage: 'Basic', dexId: [150], hp: 60, illustrator: 'Ken Sugimori', variants: { normal: false, holo: true, reverse: false, firstEdition: true } }),
  P(BASE1, 'base', 14, 'Raichu', { rarity: 'Rare', types: ['Lightning'], stage: 'Stage1', dexId: [26], hp: 80, illustrator: 'Ken Sugimori', variants: { normal: false, holo: true, reverse: false, firstEdition: true } }),
  P(BASE1, 'base', 15, 'Venusaur', { rarity: 'Rare', types: ['Grass'], stage: 'Stage2', dexId: [3], hp: 100, illustrator: 'Mitsuhiro Arita', variants: { normal: false, holo: true, reverse: false, firstEdition: true } }),
  P(BASE1, 'base', 16, 'Zapdos', { rarity: 'Rare', types: ['Lightning'], stage: 'Basic', dexId: [145], hp: 90, illustrator: 'Ken Sugimori', variants: { normal: false, holo: true, reverse: false, firstEdition: true } }),
  P(BASE1, 'base', 24, 'Charmeleon', { rarity: 'Uncommon', types: ['Fire'], stage: 'Stage1', dexId: [5], hp: 80, illustrator: 'Mitsuhiro Arita' }),
  P(BASE1, 'base', 26, 'Dratini', { rarity: 'Uncommon', types: ['Colorless'], stage: 'Basic', dexId: [147], hp: 40, illustrator: 'Ken Sugimori' }),
  P(BASE1, 'base', 44, 'Bulbasaur', { rarity: 'Common', types: ['Grass'], stage: 'Basic', dexId: [1], hp: 40, illustrator: 'Mitsuhiro Arita' }),
  P(BASE1, 'base', 46, 'Charmander', { rarity: 'Common', types: ['Fire'], stage: 'Basic', dexId: [4], hp: 50, illustrator: 'Mitsuhiro Arita' }),
  P(BASE1, 'base', 50, 'Gastly', { rarity: 'Common', types: ['Psychic'], stage: 'Basic', dexId: [92], hp: 30, illustrator: 'Keiji Kinebuchi' }),
  P(BASE1, 'base', 58, 'Pikachu', { rarity: 'Common', types: ['Lightning'], stage: 'Basic', dexId: [25], hp: 40, illustrator: 'Mitsuhiro Arita' }),
  P(BASE1, 'base', 63, 'Squirtle', { rarity: 'Common', types: ['Water'], stage: 'Basic', dexId: [7], hp: 40, illustrator: 'Mitsuhiro Arita' }),
  T(BASE1, 'base', 88, 'Professor Oak', { rarity: 'Uncommon', trainerType: 'Supporter' }),
  T(BASE1, 'base', 91, 'Bill', { rarity: 'Common', trainerType: 'Supporter' }),
  E(BASE1, 'base', 98, 'Fire Energy', { rarity: 'Common' }),
  E(BASE1, 'base', 102, 'Water Energy', { rarity: 'Common' }),
  P(SWSH3, 'swsh', 1, 'Butterfree V', { rarity: 'Rare Holo V', types: ['Grass'], stage: 'Basic', dexId: [12], hp: 210, variants: { normal: false, holo: true, reverse: false, firstEdition: false } }),
  P(SWSH3, 'swsh', 20, 'Charizard VMAX', { rarity: 'Rare Holo VMAX', types: ['Fire'], stage: 'VMAX', dexId: [6], hp: 330, variants: { normal: false, holo: true, reverse: false, firstEdition: false } }),
  P(SWSH3, 'swsh', 136, 'Furret', { rarity: 'Uncommon', types: ['Colorless'], stage: 'Stage1', dexId: [162], hp: 110, illustrator: 'tetsuya koizumi', evolveFrom: 'Sentret', regulationMark: 'D', variants: { normal: true, reverse: true, holo: false, firstEdition: false } }),
  E(SWSH3, 'swsh', 201, 'Capture Energy', { rarity: 'Rare', energyType: 'Special', variants: { normal: false, holo: true, reverse: false, firstEdition: false } }),
].map((c) => ({ ...c, key: cardKeyOf(c.id, c.lang), fetchedAt: '2026-10-13T00:00:00.000Z' }));

const K = (id) => cardKeyOf(id, 'en');
const item = (id, qty, finish = 'normal') => ({ cardKey: K(id), cardId: id, lang: 'en', finish, qty });

export const GUEST_PROFILE = {
  displayName: 'Convidado',
  username: 'convidado',
  bio: '',
  avatarAssetId: null,
  bannerAssetId: null,
  privacy: { showStats: true, showBinders: true, showDecks: true },
};

/** Primeiro acesso sem conta: coleção vazia, só os locais do sistema e um perfil local. */
export async function startEmptyGuest(db) {
  await db.ensureSystemLocations();
  await db.saveProfile(GUEST_PROFILE);
  await db.markSeeded();
}

export const DEMO_PROFILE = {
  displayName: 'Convidado (exemplo)',
  username: 'convidado',
  bio: 'Coleção de exemplo — cartas, fichários e decks fictícios para conhecer o DuskDex. Fica salva só neste navegador.',
  avatarAssetId: null,
  bannerAssetId: null,
  privacy: { showStats: true, showBinders: true, showDecks: true, showLocations: false },
  demo: true,
};

/** Popula o modo demo usando as próprias operações do adaptador (garante histórico e regras consistentes). */
export async function seedDemo(db, rememberCards) {
  await db.ensureSystemLocations();
  await rememberCards(SEED_CARDS);
  await db.saveProfile(DEMO_PROFILE);

  const quarto = await db.createLocation({ name: 'Quarto', kind: 'room' });
  const estante = await db.createLocation({ name: 'Estante', kind: 'shelf', parentId: quarto.id });
  const caixa = await db.createLocation({ name: 'Caixa Base Set', kind: 'box', parentId: estante.id, capacity: 400, description: 'Caixa de sapato com divisórias por tipo.' });
  await db.createLocation({ name: 'Gaveta de trocas', kind: 'drawer', parentId: quarto.id });

  // Cópias em caixa e caixa de entrada
  await db.addCopies([item('base1-58', 3), item('base1-46', 2), item('base1-63', 1), item('base1-50', 2), item('base1-98', 8), item('base1-102', 4), item('base1-91', 2), item('base1-24', 1)], { locationId: caixa.id, label: 'Lote de exemplo · Base Set' });
  await db.addCopies([item('swsh3-136', 2, 'reverse'), item('swsh3-1', 1, 'holo'), item('swsh3-201', 1, 'holo')], { label: 'Lote de exemplo · Darkness Ablaze' });
  const { copies: binderCopies } = await db.addCopies([
    item('base1-4', 1, 'holo'), item('base1-2', 1, 'holo'), item('base1-15', 1, 'holo'), item('base1-1', 1, 'holo'),
    item('base1-16', 1, 'holo'), item('base1-6', 1, 'holo'), item('base1-14', 1, 'holo'), item('base1-44', 1), item('base1-46', 1), item('base1-63', 1), item('base1-58', 1),
  ], { locationId: estante.id, label: 'Lote de exemplo · holos para o fichário' });

  // Fichário físico
  const kanto = await db.createBinder({ name: 'Kanto Clássico', description: 'Fichário de exemplo com os holos do Base Set. Os bolsos tracejados são cartas fantasmas (desejadas).', type: 'physical', rows: 3, cols: 3, pages: 6, color: '#4b2f5e', sheetColor: '#1a1420', style: 'couro', parentLocationId: estante.id, favorite: true, visibility: 'public', coverCardKey: K('base1-4') });
  const [p1, p2] = kanto.pages;
  const byId = (id) => binderCopies.find((c) => c.cardId === id).id;
  await db.binderOps(kanto.id, [
    { op: 'place', pageId: p1.id, index: 0, copyId: byId('base1-15') },
    { op: 'place', pageId: p1.id, index: 1, copyId: byId('base1-4') },
    { op: 'place', pageId: p1.id, index: 2, copyId: byId('base1-2') },
    { op: 'place', pageId: p1.id, index: 3, copyId: byId('base1-1') },
    { op: 'set', pageId: p1.id, index: 4, slot: { kind: 'ghost', cardKey: K('base1-10') } },
    { op: 'place', pageId: p1.id, index: 5, copyId: byId('base1-16') },
    { op: 'place', pageId: p1.id, index: 6, copyId: byId('base1-6') },
    { op: 'lock', pageId: p1.id, index: 7, locked: true },
    { op: 'place', pageId: p1.id, index: 8, copyId: byId('base1-14') },
    { op: 'place', pageId: p2.id, index: 0, copyId: byId('base1-44') },
    { op: 'place', pageId: p2.id, index: 1, copyId: byId('base1-46') },
    { op: 'place', pageId: p2.id, index: 2, copyId: byId('base1-63') },
    { op: 'place', pageId: p2.id, index: 3, copyId: byId('base1-58') },
    { op: 'set', pageId: p2.id, index: 4, slot: { kind: 'ghost', cardKey: K('base1-26') } },
    { op: 'set', pageId: p2.id, index: 5, slot: { kind: 'ghost', cardKey: K('base1-24') } },
  ], { label: 'Montagem inicial (exemplo)' });

  // Fichário virtual
  const noite = await db.createBinder({ name: 'Noite Eterna', description: 'Planejamento virtual (exemplo): nenhuma carta física é consumida aqui.', type: 'virtual', rows: 3, cols: 4, pages: 4, color: '#1d1526', sheetColor: '#120e17', style: 'noturno', slotStyle: 'glow' });
  const v1 = noite.pages[0];
  await db.binderOps(noite.id, [
    { op: 'set', pageId: v1.id, index: 0, slot: { kind: 'virtual', cardKey: K('swsh3-20') } },
    { op: 'set', pageId: v1.id, index: 1, slot: { kind: 'virtual', cardKey: K('base1-4') } },
    { op: 'set', pageId: v1.id, index: 2, slot: { kind: 'virtual', cardKey: K('swsh3-1') } },
    { op: 'set', pageId: v1.id, index: 3, slot: { kind: 'virtual', cardKey: K('swsh3-136') } },
    { op: 'set', pageId: v1.id, index: 4, slot: { kind: 'virtual', cardKey: K('base1-50') } },
    { op: 'set', pageId: v1.id, index: 5, slot: { kind: 'ghost', cardKey: K('base1-10') } },
    { op: 'set', pageId: v1.id, index: 6, slot: { kind: 'virtual', cardKey: K('base1-16') } },
    { op: 'set', pageId: v1.id, index: 7, slot: { kind: 'virtual', cardKey: K('base1-6') } },
  ], { label: 'Planejamento (exemplo)' });

  // Deck
  await db.saveDeck({
    name: 'Fogo Clássico', description: 'Lista de exemplo, incompleta de propósito, para mostrar cartas faltantes e validação.', format: 'standard', coverCardKey: K('base1-4'),
    cards: [
      { cardKey: K('base1-46'), cardId: 'base1-46', qty: 4 }, { cardKey: K('base1-24'), cardId: 'base1-24', qty: 3 },
      { cardKey: K('base1-4'), cardId: 'base1-4', qty: 2 }, { cardKey: K('base1-91'), cardId: 'base1-91', qty: 4 },
      { cardKey: K('base1-88'), cardId: 'base1-88', qty: 2 }, { cardKey: K('base1-98'), cardId: 'base1-98', qty: 12 },
    ],
  });

  // Wishlist
  await db.addWishlist({ cardKey: K('base1-10'), cardId: 'base1-10', qty: 1, priority: 'alta', note: 'Falta para fechar a página 1 do Kanto Clássico.' });
  await db.addWishlist({ cardKey: K('base1-26'), cardId: 'base1-26', qty: 1 });
  await db.addWishlist({ cardKey: K('swsh3-20'), cardId: 'swsh3-20', qty: 1, priority: 'alta' });
  await db.addWishlist({ cardKey: K('base1-24'), cardId: 'base1-24', qty: 2 });

  await db.markSeeded();
}
