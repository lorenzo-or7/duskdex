// #/d/:id — decklist pública ou não listada (somente leitura, sem dados de inventário).
import { html, render } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, rememberCards } from '../api/index.js';
import { community } from '../api/community.js';
import { cardArt, hydrateImages, zoomCard } from '../components/card.js';
import { validateDeck } from '../features/domain.js';
import { avatar } from './community.js';
import { toast, toastError } from '../components/toast.js';
import { navigate } from '../router.js';

const GROUPS = [['Pokemon', 'Pokémon'], ['Trainer', 'Treinador'], ['Energy', 'Energia'], ['?', 'Outras']];

export default async function publicDeck(ctx, main) {
  if (!await community.available()) {
    render(main, html`<div class="page"><div class="state"><div class="state__icon">${icon('swords')}</div><h3>Decks públicos precisam do servidor DuskDex</h3></div></div>`);
    return;
  }
  let d;
  try { d = await community.publicDeck(ctx.params.id); } catch (e) {
    render(main, html`<div class="page"><div class="state"><div class="state__icon">${icon('swords')}</div><h3>Deck indisponível</h3><p>${e.message}</p><a class="btn" href="#/comunidade">Comunidade</a></div></div>`);
    return;
  }
  const snaps = new Map(d.snapshots.map((c) => [c.key, c]));
  const v = validateDeck(d, (k) => snaps.get(k));
  const lines = d.cards.map((l) => ({ ...l, card: snaps.get(l.cardKey) }));
  const groups = GROUPS.map(([k, label]) => ({ label, lines: lines.filter((l) => (l.card?.category || '?') === k) })).filter((g) => g.lines.length);
  const total = lines.reduce((n, l) => n + l.qty, 0);
  const fmt = d.format === 'standard' ? 'Standard' : d.format === 'expanded' ? 'Expanded' : 'Livre';

  render(main, html`<div class="page page--wide">
    <a class="btn btn--ghost btn--sm" href="#/u/${d.owner.username}" style="margin-bottom:14px">${icon('arrowLeft')} @${d.owner.username}</a>
    <div class="page-head"><div><div class="page-head__eyebrow">Deck ${fmt} · ${total} cartas</div><h1>${d.name}</h1>${d.description ? html`<p style="white-space:pre-line">${d.description}</p>` : ''}
      <a class="row text-sm muted" style="gap:8px;color:inherit;margin-top:8px" href="#/u/${d.owner.username}">${avatar(d.owner, 'avatar--xs')}${d.owner.displayName}</a></div>
      <div class="btn-group">${data().mode === 'server' && data().user && !d.isOwner ? html`<button class="btn btn--primary" type="button" data-copy>${icon('copy')} Copiar para meus decks</button>` : ''}${d.isOwner ? html`<a class="btn" href="#/decks/${d.id}">${icon('pencil')} Abrir no editor</a>` : ''}
        <button class="btn" type="button" data-text>${icon('download')} Lista em texto</button></div></div>
    <div class="deck-layout">
      <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('list')} Lista</h2></div>
        <div class="deck-list">${groups.map((g) => html`<div class="deck-group"><h3><span>${g.label}</span><span>${g.lines.reduce((n, l) => n + l.qty, 0)}</span></h3>
          ${g.lines.map((l) => html`<div class="deck-line"><button type="button" class="card-tile__btn" data-zoom="${l.cardKey}" aria-label="Ampliar ${l.card?.name || ''}">${cardArt(l.card)}</button>
            <div style="min-width:0"><div class="deck-line__name">${l.card?.name || l.cardId} <span class="text-xs muted">${l.card?.set?.name || ''} ${l.card?.localId ? `#${l.card.localId}` : ''}</span></div></div>
            <strong class="deck-line__qty">×${l.qty}</strong></div>`)}</div>`)}</div></section>
      <aside class="stack stack--lg"><section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('shield')} Validação</h2><span class="badge ${v.structural === 'valid' ? 'badge--success' : v.structural === 'invalid' ? 'badge--danger' : 'badge--warning'}">${v.structural === 'valid' ? 'Estruturalmente válido' : v.structural === 'invalid' ? 'Inválido' : 'Parcial'}</span></div>
        <div class="validity">${v.checks.map((c) => html`<div class="validity__item validity__item--${c.status === 'ok' ? 'ok' : c.status === 'bad' ? 'bad' : 'unknown'}">${icon(c.status === 'ok' ? 'check' : c.status === 'bad' ? 'x' : 'alert')}<span>${c.text}</span></div>`)}</div></section></aside>
    </div></div>`);
  hydrateImages(main);
  main.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => zoomCard(snaps.get(b.dataset.zoom))));
  main.querySelector('[data-text]').addEventListener('click', async () => {
    const text = lines.map((l) => `${l.qty} ${l.card?.name || l.cardId} ${l.card?.set?.id ? l.card.set.id.toUpperCase() : ''} ${l.card?.localId || ''}`.trim()).join('\n');
    try { await navigator.clipboard.writeText(text); toast({ type: 'success', text: 'Lista copiada para a área de transferência.' }); } catch { toast({ type: 'info', text }); }
  });
  main.querySelector('[data-copy]')?.addEventListener('click', async () => {
    try {
      await rememberCards(d.snapshots.filter((c) => c.source !== 'custom'));
      const nd = await data().saveDeck({ name: `${d.name} (de @${d.owner.username})`, description: d.description, format: d.format, cards: d.cards.filter((l) => !l.cardKey.startsWith('custom:')) });
      toast({ type: 'success', text: 'Deck copiado para os seus decks.' });
      navigate(`/decks/${nd.id}`);
    } catch (e) { toastError(e); }
  });
}
