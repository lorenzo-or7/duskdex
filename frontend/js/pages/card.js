import { html, render, formatDate } from '../core/html.js';
import { icon } from '../core/icons.js';
import * as tcg from '../api/tcgdex.js';
import { data, card as cached, rememberCards } from '../api/index.js';
import { cardArt, hydrateImages, zoomCard, finishLabel } from '../components/card.js';
import { loadAll, copyWhere, plannedIn, deckNeeds } from '../stores/state.js';
import { addToCollectionFlow, addToWishlist, addToBinderFlow, addToDeckFlow } from '../features/actions.js';
import { cardKeyOf } from '../features/domain.js';
import { on } from '../core/events.js';
import { CONDITIONS } from '../features/conditions.js';
import { toastError } from '../components/toast.js';

const CAT = { Pokemon: 'Pokémon', Trainer: 'Treinador', Energy: 'Energia' };

export default async function cardPage(ctx, main) {
  const id = ctx.params.id;
  const lang = ctx.query.lang || 'en';
  let snap = null; let notice = null;
  try {
    const { card, lang: got, fallbackFrom } = await tcg.getCard(id, lang);
    snap = tcg.toSnapshot(card, got, { fallbackFrom });
    snap.key = cardKeyOf(card.id, got);
    if (fallbackFrom) notice = { type: 'warning', text: `Esta carta não tem dados em ${tcg.langLabel(fallbackFrom)} na TCGdex. Exibindo a versão em ${tcg.langLabel(got)}.` };
    if (cached(snap.key)) rememberCards([snap]).catch(() => {}); // atualiza o snapshot salvo
  } catch (e) {
    snap = cached(cardKeyOf(id, lang)) || cached(cardKeyOf(id, 'en'));
    if (!snap) {
      render(main, html`<div class="page"><div class="state state--error"><div class="state__icon">${icon('offline')}</div><h3>Não foi possível carregar a carta</h3><p>${e.message}</p><div class="btn-group"><a class="btn" href="#/catalogo">${icon('arrowLeft')} Voltar ao catálogo</a></div></div></div>`);
      return;
    }
    notice = { type: 'warning', text: `TCGdex indisponível (${e.message}). Exibindo dados salvos localmente${snap.source === 'demo-seed' ? ' — carta da coleção de exemplo' : ''}.` };
  }

  const paint = async () => {
    const s = await loadAll(['copies', 'binders', 'locations', 'decks', 'wishlist']);
    const mine = s.copies.filter((c) => c.cardId === snap.id && c.status !== 'removed');
    const wish = s.wishlist.find((w) => w.cardId === snap.id);
    const planned = plannedIn(snap.id, s.binders);
    const needs = deckNeeds(snap.id, s.decks, s.copies);
    const variants = tcg.availableVariants(snap);
    const attrs = [
      ['Número', snap.localId ? `${snap.localId}${snap.set?.cardCount?.official ? ` / ${snap.set.cardCount.official}` : ''}` : '—'],
      ['Expansão', snap.set?.name || '—'],
      ['Idioma', tcg.langLabel(snap.lang)],
      ['Raridade', snap.rarity || '—'],
      ['Categoria', CAT[snap.category] || snap.category || '—'],
      ['Tipo', snap.types?.length ? snap.types.join(', ') : (snap.energyType || snap.trainerType || '—')],
      snap.hp ? ['HP', snap.hp] : null,
      snap.stage ? ['Estágio', snap.stage] : null,
      ['Ilustração', snap.illustrator || '—'],
      snap.regulationMark ? ['Marca de regulação', snap.regulationMark] : null,
      snap.dexId?.length ? ['Pokédex nacional', snap.dexId.map((d) => `#${d}`).join(', ')] : null,
      snap.updated ? ['Atualizado na TCGdex', formatDate(snap.updated)] : null,
    ].filter(Boolean);

    render(main, html`<div class="page">
      <a class="btn btn--ghost btn--sm" href="#/catalogo" style="margin-bottom:16px">${icon('arrowLeft')} Catálogo</a>
      ${notice ? html`<div class="alert alert--${notice.type}" style="margin-bottom:20px">${icon('info')}<div>${notice.text}</div></div>` : ''}
      <div class="card-detail">
        <div class="card-detail__art"><button type="button" class="card-tile__btn" data-zoom aria-label="Ampliar imagem">${cardArt(snap, { quality: 'high' })}</button>
          <p class="text-xs subtle" style="text-align:center;margin-top:10px">Clique para ampliar · imagem: TCGdex</p></div>
        <div class="stack stack--lg">
          <div>
            <div class="row" style="gap:8px;margin-bottom:8px">${snap.category ? html`<span class="badge badge--primary">${CAT[snap.category] || snap.category}</span>` : ''}${snap.rarity ? html`<span class="badge">${tcg.rarityLabel(snap.rarity)}</span>` : ''}${snap.source === 'demo-seed' ? html`<span class="badge badge--demo">exemplo demo</span>` : ''}${snap.partial ? html`<span class="badge badge--warning">dados parciais</span>` : ''}</div>
            <h1>${snap.name}</h1>
            <p class="muted">${snap.set?.name || ''} ${snap.localId ? `· nº ${snap.localId}` : ''} · <span class="mono">${snap.id}</span></p>
          </div>
          <div class="btn-group">
            <button class="btn btn--primary" type="button" data-act="collection">${icon('plus')} Adicionar à coleção</button>
            <button class="btn" type="button" data-act="wish">${icon('heart')} ${wish ? 'Na Wishlist' : 'Wishlist'}</button>
            <button class="btn" type="button" data-act="binder">${icon('book')} Fichário</button>
            <button class="btn" type="button" data-act="deck">${icon('swords')} Deck</button>
          </div>

          <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('layers')} Na sua coleção</h2><span class="badge ${mine.length ? 'badge--success' : ''}">${mine.length} cópia(s)</span></div>
            ${mine.length ? html`<div class="locs">${mine.map((c) => html`<div class="loc-line">${icon(c.slot ? 'book' : c.deckAssembled ? 'swords' : 'pin')}<span class="grow">${copyWhere(c, s)}</span><span class="badge">${c.lang.toUpperCase()}</span><span class="badge">${finishLabel(c.finish)}</span>
              <select class="select select--xs" data-copy-cond="${c.id}" aria-label="Estado de conservação desta cópia" title="Estado de conservação (M, NM, SP, MP, HP, D, HD)">${CONDITIONS.map((k) => html`<option value="${k.id}" ${(c.condition || 'NM') === k.id ? 'selected' : ''} title="${k.label}">${k.id} · ${k.label}</option>`)}</select>
              ${c.reservedFor ? html`<span class="badge badge--warning">reservada</span>` : ''}</div>`)}</div>`
    : html`<p class="muted text-sm">Você ainda não tem esta carta.</p>`}
            ${planned.length || needs.length ? html`<div class="divider"></div><div class="stack" style="gap:6px">
              ${planned.map((p) => html`<div class="loc-line">${icon(p.kind === 'ghost' ? 'ghost' : 'eye')}<span class="grow">${p.kind === 'ghost' ? 'Fantasma' : 'Referência'} em <a href="#/ficharios/${p.binder.id}?pagina=${p.page + 1}">${p.binder.name}</a> · pág. ${p.page + 1}, bolso ${p.index + 1}</span></div>`)}
              ${needs.map((n) => html`<div class="loc-line">${icon('swords')}<span class="grow">Deck <a href="#/decks/${n.deck.id}">${n.deck.name}</a> usa ${n.qty}×${n.missing ? ` · faltam ${n.missing}` : ''}</span></div>`)}
            </div>` : ''}
          </section>

          <section><h2 class="panel__title" style="margin-bottom:12px">${icon('info')} Dados oficiais disponíveis</h2>
            <dl class="attr-grid">${attrs.map(([k, v]) => html`<div class="attr"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></section>

          ${variants ? html`<section><h3 class="field__label" style="margin-bottom:8px">Versões conhecidas</h3><div class="chips">${Object.entries(snap.variants).map(([k, v]) => html`<span class="badge ${v ? 'badge--primary' : ''}" style="${v ? '' : 'opacity:.5;text-decoration:line-through'}">${tcg.variantLabels[k] || k}</span>`)}</div></section>` : ''}

          ${snap.abilities?.length || snap.attacks?.length || snap.effect ? html`<section class="stack">
            ${snap.abilities.map((a) => html`<div class="attack"><div class="attack__head"><span>${a.type || 'Habilidade'}: ${a.name}</span></div>${a.effect ? html`<p>${a.effect}</p>` : ''}</div>`)}
            ${snap.attacks.map((a) => html`<div class="attack"><div class="attack__head"><span>${a.name} <span class="text-xs muted">${(a.cost || []).join(' · ')}</span></span><span>${a.damage ?? ''}</span></div>${a.effect ? html`<p>${a.effect}</p>` : ''}</div>`)}
            ${snap.effect ? html`<div class="attack"><div class="attack__head"><span>Efeito</span></div><p>${snap.effect}</p></div>` : ''}
          </section>` : ''}

          ${snap.legal ? html`<div class="alert alert--warning">${icon('alert')}<div>A TCGdex indica <strong>Standard: ${snap.legal.standard ? 'sim' : 'não'}</strong> · <strong>Expanded: ${snap.legal.expanded ? 'sim' : 'não'}</strong>. Isso é um indício, não prova de legalidade em torneios (rotação, banimentos e erratas mudam).</div></div>` : ''}

          <section><h3 class="field__label" style="margin-bottom:8px">Outros idiomas</h3><div class="chips" data-langs><span class="text-sm muted">Carregando idiomas…</span></div></section>
        </div>
      </div></div>`);
    hydrateImages(main);
    main.querySelectorAll('[data-copy-cond]').forEach((sel) => sel.addEventListener('change', async () => {
      sel.disabled = true;
      try { await data().setCondition([sel.dataset.copyCond], sel.value); paint(); } catch (e) { toastError(e); sel.disabled = false; }
    }));
    main.querySelector('[data-zoom]').addEventListener('click', () => zoomCard(snap, snap.source === 'custom' ? null : tcg.cardImageUrl(snap.image, 'high')));
    main.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const saved = cached(snap.key) || (await rememberCards([snap]))[0];
      const a = b.dataset.act;
      if (a === 'collection') { if (await addToCollectionFlow([saved])) paint(); }
      if (a === 'wish') { await addToWishlist(saved); paint(); }
      if (a === 'binder') await addToBinderFlow(saved);
      if (a === 'deck') await addToDeckFlow(saved);
    }));
    tcg.discoverLanguages().then((langs) => {
      const box = main.querySelector('[data-langs]');
      if (!box) return;
      render(box, html`${langs.map((l) => html`<a class="chip" href="#/carta/${encodeURIComponent(snap.id)}?lang=${l.code}" aria-pressed="${l.code === snap.lang}">${l.code.toUpperCase()}</a>`)}`);
    }).catch(() => { const box = main.querySelector('[data-langs]'); if (box) box.textContent = 'Lista de idiomas indisponível (sem conexão com a TCGdex).'; });
  };
  await paint();
  return on('data:changed', paint);
}
