import { html, render, formatDate } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { analyzeDeck, validateDeck, DECK_FORMATS } from '../features/domain.js';
import { cardArt, hydrateImages } from '../components/card.js';
import { promptDialog } from '../components/modal.js';
import { toastError } from '../components/toast.js';
import { navigate, setQuery } from '../router.js';
import { on } from '../core/events.js';

const STATUS = { virtual: ['Virtual', ''], reserved: ['Reservas feitas', 'badge--warning'], assembled: ['Montado fisicamente', 'badge--success'] };

export default async function decks(ctx, main) {
  const db = data();
  const create = async () => {
    const name = await promptDialog({ title: 'Novo deck', label: 'Nome do deck', placeholder: 'Ex.: Darkrai Control', confirmLabel: 'Criar deck' });
    if (!name) return;
    try { const d = await db.saveDeck({ name, format: 'standard', cards: [] }); changed('decks'); navigate(`/decks/${d.id}`); } catch (e) { toastError(e); }
  };
  const paint = async () => {
    const [list, copies] = await Promise.all([db.listDecks(), db.listCopies()]);
    render(main, html`<div class="page page--wide">
      <div class="page-head page-head--art" data-art="decks"><div><div class="page-head__eyebrow">Deck Builder</div><h1>Decks</h1><p>Monte listas sem possuir as cartas, compare com a coleção e transforme em um deck físico com lista de separação.</p></div>
        <button class="btn btn--primary" type="button" data-new>${icon('plus')} Novo deck</button></div>
      ${list.length ? html`<div class="deck-cards">${list.map((d, i) => {
    const a = analyzeDeck(d, copies, card);
    const v = validateDeck(d, card);
    const covers = [d.coverCardKey, ...d.cards.map((l) => l.cardKey)].filter(Boolean).filter((k, j, arr) => arr.indexOf(k) === j).slice(0, 3);
    const [sl, sc] = STATUS[d.status] || STATUS.virtual;
    return html`<a class="deck-card" href="#/decks/${d.id}" style="animation-delay:${i * 40}ms">
          <div class="deck-card__art">${covers.map((k) => cardArt(card(k)))}</div>
          <div class="deck-card__body">
            <div class="row row--between"><strong style="font-size:var(--fs-lg)">${d.name}</strong><span class="badge ${sc}">${sl}</span></div>
            <div class="text-xs muted">${DECK_FORMATS[d.format]?.label || d.format} · ${v.total} cartas · atualizado ${formatDate(d.updatedAt)}</div>
            <div class="progress-row"><div class="progress-row__top text-xs"><span class="muted">Disponível na coleção</span><span>${a.have}/${a.need}</span></div><div class="progress progress--sm"><div class="progress__bar" style="width:${a.progress}%"></div></div></div>
            <span class="badge ${v.structural === 'valid' ? 'badge--success' : v.structural === 'invalid' ? 'badge--danger' : 'badge--warning'}" style="align-self:flex-start">${v.structural === 'valid' ? 'Estruturalmente válido' : v.structural === 'invalid' ? 'Inválido por regra identificada' : 'Validação parcial'}${v.legal === 'legal' ? ' · legal no formato' : v.legal === 'illegal' ? ' · carta fora do formato' : ''}</span>
          </div></a>`;
  })}</div>` : html`<div class="state"><div class="state__icon">${icon('swords')}</div><h3>Nenhum deck ainda</h3><p>Crie uma decklist a partir do catálogo — você não precisa possuir as cartas.</p><button class="btn btn--primary" type="button" data-new2>${icon('plus')} Criar deck</button></div>`}
    </div>`);
    hydrateImages(main);
    main.querySelector('[data-new]').addEventListener('click', create);
    main.querySelector('[data-new2]')?.addEventListener('click', create);
  };
  await paint();
  if (ctx.query.novo === '1') { setQuery({ novo: '' }); create(); }
  return on('data:changed', paint);
}
