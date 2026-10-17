import { html, render, timeAgo, fmtInt, plural } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card } from '../api/index.js';
import { loadAll, activeCopies } from '../stores/state.js';
import { cardTile, hydrateImages, cardArt } from '../components/card.js';
import { binderStats, setProgress, analyzeDeck } from '../features/domain.js';
import { navigate } from '../router.js';
import { pickCards } from '../components/card-picker.js';
import { addToCollectionFlow } from '../features/actions.js';
import { on } from '../core/events.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export default async function dashboard(ctx, main) {
  const paint = async () => {
    const db = data();
    const s = await loadAll(['copies', 'binders', 'decks', 'wishlist', 'activity', 'profile', 'locations']);
    const copies = activeCopies(s.copies);
    const unique = new Set(copies.map((c) => c.cardId)).size;
    const sets = setProgress(copies, card);
    const recent = [...copies].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const recentCards = []; const seen = new Set();
    for (const c of recent) { if (!seen.has(c.cardKey)) { seen.add(c.cardKey); recentCards.push(c); } if (recentCards.length >= 10) break; }
    const favBinders = s.binders.filter((b) => b.favorite).concat(s.binders.filter((b) => !b.favorite)).slice(0, 3);
    const owned = (id) => copies.filter((c) => c.cardId === id).length;
    const wishOpen = s.wishlist.filter((w) => owned(w.cardId) < w.qty);
    const inbox = copies.filter((c) => c.locationId === db.inboxId).length;
    const name = s.profile?.displayName || data().user?.displayName || 'colecionador(a)';
    const holo = copies.filter((c) => c.finish === 'holo' || c.finish === 'reverse').length;

    render(main, html`<div class="page page--wide"><div class="dash">
      <section class="dash__hero greet">
        <div style="position:relative;z-index:1">
          <div class="greet__eyebrow">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>${greeting()}, ${name.split(' ')[0]}.</h1>
          <p>${copies.length ? `Sua coleção tem ${plural(copies.length, 'carta física', 'cartas físicas')} em ${plural(s.binders.length, 'fichário', 'fichários')} e outros locais.` : 'Sua coleção está vazia. Comece pesquisando uma carta no catálogo.'}</p>
        </div>
        <div class="btn-group">
          <button class="btn btn--primary" type="button" data-add>${icon('plus')} Adicionar cartas</button>
          <a class="btn btn--outline" href="#/catalogo">${icon('search')} Catálogo</a>
        </div>
      </section>
      ${!copies.length && !s.binders.length && db.mode === 'demo' ? html`<section class="panel onboarding">
        <div><h2 class="panel__title">${icon('compass')} Primeiros passos</h2>
          <p class="text-sm muted">Você está usando o DuskDex sem conta: tudo fica salvo neste navegador. Cadastre suas cartas pelo catálogo, ou carregue uma coleção de exemplo (fictícia) para ver fichários, inventário e decks funcionando.</p></div>
        <div class="btn-group"><button class="btn" type="button" data-examples>${icon('sparkles')} Carregar exemplo</button><a class="btn btn--ghost" href="#/registrar">${icon('userPlus')} Criar conta</a></div></section>` : ''}

      <section class="dash__kpis" aria-label="Resumo da coleção">
        <a class="kpi" href="#/colecao" style="text-decoration:none;color:inherit"><span class="kpi__icon">${icon('layers')}</span><div class="stat"><span class="stat__value">${fmtInt(copies.length)}</span><span class="stat__label">Cartas físicas</span><span class="stat__meta">${fmtInt(unique)} impressões diferentes · ${fmtInt(holo)} holo/reverse</span></div></a>
        <a class="kpi" href="#/ficharios" style="text-decoration:none;color:inherit"><span class="kpi__icon">${icon('book')}</span><div class="stat"><span class="stat__value">${fmtInt(s.binders.length)}</span><span class="stat__label">Fichários</span><span class="stat__meta">${s.binders.filter((b) => b.type === 'physical').length} físicos · ${s.binders.filter((b) => b.type === 'virtual').length} virtuais</span></div></a>
        <a class="kpi" href="#/decks" style="text-decoration:none;color:inherit"><span class="kpi__icon">${icon('swords')}</span><div class="stat"><span class="stat__value">${fmtInt(s.decks.length)}</span><span class="stat__label">Decks</span><span class="stat__meta">${s.decks.filter((d) => d.status === 'assembled').length} montado(s) fisicamente</span></div></a>
        <a class="kpi kpi--crimson" href="#/wishlist" style="text-decoration:none;color:inherit"><span class="kpi__icon">${icon('heart')}</span><div class="stat"><span class="stat__value">${fmtInt(wishOpen.length)}</span><span class="stat__label">Desejos em aberto</span><span class="stat__meta">${s.wishlist.length - wishOpen.length} já conseguida(s)</span></div></a>
      </section>

      <div class="dash__main">
        <section class="panel">
          <div class="panel__head"><h2 class="panel__title">${icon('sparkles')} Adicionadas recentemente</h2><a class="btn btn--sm btn--ghost" href="#/colecao?ordem=recentes">Ver todas ${icon('chevronRight')}</a></div>
          ${recentCards.length ? html`<div class="strip">${recentCards.map((c, i) => cardTile(card(c.cardKey), { qty: owned(c.cardId), attrs: `data-card="${c.cardKey}"`, meta: timeAgo(c.createdAt), index: i }))}</div>`
    : html`<div class="state"><div class="state__icon">${icon('layers')}</div><h3>Nenhuma carta ainda</h3><p>As cartas que você cadastrar aparecem aqui.</p></div>`}
        </section>

        <section class="panel">
          <div class="panel__head"><h2 class="panel__title">${icon('target')} Progresso por expansão</h2><a class="btn btn--sm btn--ghost" href="#/objetivos">Objetivos ${icon('chevronRight')}</a></div>
          ${sets.length ? html`<div class="stack">${sets.slice(0, 5).map((st) => html`<div class="progress-row">
              <div class="progress-row__top"><span><strong>${st.name}</strong> <span class="muted text-xs">${st.id}</span></span><span>${st.unique}${st.official ? ` / ${st.official}` : ''} ${st.progress != null ? `· ${st.progress}%` : ''}</span></div>
              <div class="progress"><div class="progress__bar" style="width:${st.progress ?? 0}%"></div></div></div>`)}
              <p class="text-xs subtle">Calculado com cópias físicas reais (impressões diferentes ÷ total oficial da expansão). Fantasmas e imagens não contam.</p></div>`
    : html`<p class="muted text-sm">Cadastre cartas para acompanhar o progresso de cada expansão.</p>`}
        </section>

        <section class="panel">
          <div class="panel__head"><h2 class="panel__title">${icon('book')} Fichários favoritos</h2><a class="btn btn--sm btn--ghost" href="#/ficharios">Todos ${icon('chevronRight')}</a></div>
          ${favBinders.length ? html`<div class="binder-cards" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">${favBinders.map((b) => {
    const st = binderStats(b);
    const cover = b.appearance.coverCardKey ? card(b.appearance.coverCardKey) : null;
    return html`<a class="binder-card" href="#/ficharios/${b.id}">
              <div class="binder-cover" data-style="${b.appearance.style}" style="--binder-color:${b.appearance.color}"><div class="binder-cover__rings"><span></span><span></span><span></span></div>${cover ? html`<div class="binder-cover__art">${cardArt(cover)}</div>` : ''}<div class="binder-cover__title">${b.name}</div></div>
              <div class="binder-card__meta"><span class="binder-card__info"><span>${b.type === 'physical' ? 'Físico' : 'Virtual'}</span><span>${st.filled}/${st.slots} bolsos</span></span><div class="progress progress--sm"><div class="progress__bar" style="width:${st.progress}%"></div></div></div></a>`;
  })}</div>` : html`<div class="state"><div class="state__icon">${icon('book')}</div><h3>Nenhum fichário</h3><p>Crie seu primeiro fichário físico ou virtual.</p><a class="btn btn--primary" href="#/ficharios?novo=1">${icon('plus')} Criar fichário</a></div>`}
        </section>
      </div>

      <div class="dash__side">
        <section class="panel">
          <div class="panel__head"><h2 class="panel__title">${icon('wand')} Ações rápidas</h2></div>
          <div class="quick">
            <button type="button" data-add>${icon('plus')} Cadastrar cartas</button>
            <a href="#/ficharios?novo=1">${icon('book')} Novo fichário</a>
            <a href="#/decks?novo=1">${icon('swords')} Novo deck</a>
            <a href="#/inventario">${icon('package')} Organizar inventário${inbox ? html` <span class="badge badge--warning" style="margin-left:auto">${inbox}</span>` : ''}</a>
          </div>
          ${inbox ? html`<p class="text-xs muted mt-3">${inbox} carta(s) ainda estão em “Sem local definido”.</p>` : ''}
        </section>

        <section class="panel">
          <div class="panel__head"><h2 class="panel__title">${icon('heart')} Wishlist</h2><a class="btn btn--sm btn--ghost" href="#/wishlist">Abrir ${icon('chevronRight')}</a></div>
          ${wishOpen.length ? html`<div class="stack" style="gap:8px">${wishOpen.slice(0, 5).map((w) => {
    const cd = card(w.cardKey);
    return html`<a class="collector" href="#/carta/${encodeURIComponent(cd?.id || w.cardId)}?lang=${cd?.lang || 'en'}" style="text-decoration:none;color:inherit;padding:6px"><div style="width:36px;flex:none">${cardArt(cd)}</div><div class="grow"><div class="ellipsis" style="font-weight:700;font-size:var(--fs-sm)">${cd?.name || w.cardId}</div><div class="text-xs muted">${cd?.set?.name || ''} · faltam ${w.qty - owned(w.cardId)}</div></div>${w.priority === 'alta' ? html`<span class="badge badge--crimson">alta</span>` : ''}</a>`;
  })}</div>` : html`<p class="muted text-sm">Nada pendente na Wishlist.</p>`}
        </section>

        <section class="panel">
          <div class="panel__head"><h2 class="panel__title">${icon('history')} Atividade recente</h2><a class="btn btn--sm btn--ghost" href="#/inventario?aba=historico">Histórico</a></div>
          ${s.activity.length ? html`<ul class="timeline">${s.activity.slice(0, 7).map((a) => html`<li><span class="timeline__icon">${icon(a.icon || 'info')}</span><div><div class="timeline__text">${a.text}</div><div class="timeline__time">${timeAgo(a.at)}</div></div></li>`)}</ul>`
    : html`<p class="muted text-sm">Sem atividades ainda.</p>`}
        </section>

        ${s.decks.length ? html`<section class="panel">
          <div class="panel__head"><h2 class="panel__title">${icon('swords')} Decks</h2></div>
          <div class="stack">${s.decks.slice(0, 3).map((d) => {
    const a = analyzeDeck(d, s.copies, card);
    return html`<a href="#/decks/${d.id}" class="progress-row" style="text-decoration:none;color:inherit"><div class="progress-row__top"><strong>${d.name}</strong><span>${a.have}/${a.need} cartas</span></div><div class="progress progress--sm"><div class="progress__bar" style="width:${a.progress}%"></div></div></a>`;
  })}</div></section>` : ''}
      </div>
    </div></div>`);
    hydrateImages(main);
    main.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      const snaps = await pickCards({ title: 'Adicionar cartas à coleção', multi: true, confirmLabel: 'Continuar' });
      if (snaps?.length) { await addToCollectionFlow(snaps); paint(); }
    }));
    main.querySelector('[data-examples]')?.addEventListener('click', async () => {
      const { confirmDialog } = await import('../components/modal.js');
      const { prefs } = await import('../core/prefs.js');
      if (!await confirmDialog({ title: 'Carregar a coleção de exemplo?', message: 'Cartas, fichários, decks e wishlist fictícios serão criados neste navegador, rotulados como exemplo. Você pode apagá-los depois em Configurações → Dados e modo.', confirmLabel: 'Carregar exemplo' })) return;
      await db.reset();
      prefs.set('guestStart', 'examples');
      location.reload();
    });
    main.querySelectorAll('[data-card]').forEach((t) => t.querySelector('[data-open]')?.addEventListener('click', () => {
      const cd = card(t.dataset.card);
      if (cd && cd.source !== 'custom') navigate(`/carta/${encodeURIComponent(cd.id)}?lang=${cd.lang}`);
    }));
  };
  await paint();
  return on('data:changed', paint);
}
