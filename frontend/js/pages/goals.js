import { html, render } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card } from '../api/index.js';
import { loadAll } from '../stores/state.js';
import { setProgress, speciesProgress, binderStats } from '../features/domain.js';
import { cardTile, hydrateImages } from '../components/card.js';
import { openModal } from '../components/modal.js';
import { toastError } from '../components/toast.js';
import * as tcg from '../api/tcgdex.js';
import { addToWishlist } from '../features/actions.js';
import { resolveSnapshot } from '../components/card-picker.js';
import { on } from '../core/events.js';

export default async function goals(ctx, main) {
  const st = { lang: '' };
  let s;
  const load = async () => { s = await loadAll(['copies', 'binders', 'wishlist']); paint(); };

  const paint = () => {
    const active = s.copies.filter((c) => c.status !== 'removed' && (!st.lang || c.lang === st.lang));
    const langs = [...new Set(s.copies.filter((c) => c.status !== 'removed').map((c) => c.lang))];
    const sets = setProgress(active, card);
    const species = speciesProgress(active, card);
    const totalSpecies = species.reduce((n, g) => n + g.owned, 0);
    const binders = s.binders.map((b) => ({ b, st: binderStats(b) }));
    const wishDone = s.wishlist.filter((w) => active.filter((c) => c.cardId === w.cardId).length >= w.qty).length;
    render(main, html`<div class="page page--wide">
      <div class="page-head page-head--art" data-art="universe"><div><div class="page-head__eyebrow">Central de progresso</div><h1>Objetivos</h1><p>Indicadores calculados automaticamente com suas cópias físicas reais. Cartas fantasmas, referências virtuais e imagens personalizadas nunca contam como possuídas.</p></div>
        <label class="field" style="min-width:200px"><span class="field__label">Contexto: idioma das cópias</span><select class="select" data-lang><option value="">Todos os idiomas</option>${langs.map((l) => html`<option value="${l}" ${st.lang === l ? 'selected' : ''}>${tcg.langLabel(l)}</option>`)}</select></label></div>

      <div class="dash__kpis" style="margin-bottom:24px">
        <div class="kpi"><span class="kpi__icon">${icon('layers')}</span><div class="stat"><span class="stat__value">${new Set(active.map((c) => c.cardId)).size}</span><span class="stat__label">Impressões diferentes</span></div></div>
        <div class="kpi"><span class="kpi__icon">${icon('grid')}</span><div class="stat"><span class="stat__value">${sets.length}</span><span class="stat__label">Expansões iniciadas</span><span class="stat__meta">${sets.filter((x) => x.progress === 100).length} completas</span></div></div>
        <div class="kpi"><span class="kpi__icon">${icon('sparkles')}</span><div class="stat"><span class="stat__value">${totalSpecies}</span><span class="stat__label">Espécies da Pokédex</span><span class="stat__meta">via campo dexId da TCGdex</span></div></div>
        <div class="kpi kpi--crimson"><span class="kpi__icon">${icon('heart')}</span><div class="stat"><span class="stat__value">${wishDone}/${s.wishlist.length}</span><span class="stat__label">Desejos realizados</span></div></div>
      </div>

      <section style="margin-bottom:28px"><h2 class="panel__title" style="margin-bottom:14px">${icon('target')} Completar expansões</h2>
        ${sets.length ? html`<div class="gen-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${sets.map((x) => html`<div class="goal-card">
          <div class="ring" style="--p:${x.progress ?? 0}"><span>${x.progress != null ? `${x.progress}%` : '—'}</span></div>
          <div class="stack" style="gap:6px;min-width:0"><strong class="ellipsis">${x.name}</strong><span class="text-sm muted">${x.unique}${x.official ? ` de ${x.official} cartas oficiais` : ' cartas (total oficial desconhecido)'}</span>
            <button class="btn btn--sm" type="button" data-missing="${x.id}" style="align-self:flex-start">${icon('search')} Ver faltantes</button></div></div>`)}</div>`
    : html`<div class="state"><div class="state__icon">${icon('target')}</div><h3>Nenhuma expansão iniciada</h3><p>Cadastre cartas para acompanhar o progresso de cada expansão.</p></div>`}
        <p class="text-xs subtle mt-3">Progresso = impressões diferentes possuídas ÷ total oficial informado pela TCGdex (cartas secretas acima do total oficial podem fazer passar de 100%; o valor é limitado a 100%).</p>
      </section>

      <div class="grid-2">
        <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('sparkles')} Espécies por geração</h2></div>
          <div class="stack">${species.map((g) => html`<div class="progress-row"><div class="progress-row__top"><span><strong>Geração ${g.gen}</strong> <span class="muted text-xs">${g.label} · #${g.from}–${g.to}</span></span><span>${g.owned}/${g.size}</span></div><div class="progress progress--sm"><div class="progress__bar" style="width:${g.progress}%"></div></div></div>`)}</div>
          <p class="text-xs subtle mt-3">Usa os números da Pokédex Nacional do campo <span class="mono">dexId</span>. Cartas sem esse dado (Treinador, Energia, dados parciais) não entram.</p></section>
        <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('book')} Preenchimento dos fichários</h2></div>
          ${binders.length ? html`<div class="stack">${binders.map(({ b, st: bs }) => html`<a class="progress-row" href="#/ficharios/${b.id}" style="text-decoration:none;color:inherit"><div class="progress-row__top"><span><strong>${b.name}</strong> <span class="muted text-xs">${b.type === 'physical' ? 'físico' : 'virtual'}</span></span><span>${bs.filled}/${bs.slots} · ${bs.progress}%</span></div><div class="progress progress--sm"><div class="progress__bar" style="width:${bs.progress}%"></div></div>${bs.ghost ? html`<span class="text-xs muted">${bs.ghost} bolso(s) planejado(s) com fantasma — completar a página ${bs.ghost === 1 ? 'exige 1 carta' : `exige ${bs.ghost} cartas`}</span>` : ''}</a>`)}</div>`
    : html`<p class="muted text-sm">Nenhum fichário ainda.</p>`}</section>
      </div>
    </div>`);
    main.querySelector('[data-lang]').addEventListener('change', (e) => { st.lang = e.target.value; paint(); });
    main.querySelectorAll('[data-missing]').forEach((b) => b.addEventListener('click', () => showMissing(b.dataset.missing, active)));
  };

  const showMissing = async (setId, active) => {
    const owned = new Set(active.map((c) => c.cardId));
    const lang = st.lang || active.find((c) => card(c.cardKey)?.set?.id === setId)?.lang || 'en';
    const m = openModal({ title: 'Cartas faltantes', size: 'xl', body: html`<div class="center-loader"><span class="loader"><span class="loader__eclipse"></span>Consultando a expansão na TCGdex…</span></div>` });
    try {
      const set = await tcg.getSet(lang, setId);
      const missing = (set.cards || []).filter((c) => !owned.has(c.id));
      m.setTitle(`${set.name} · faltam ${missing.length} de ${(set.cards || []).length}`);
      m.setBody(html`<p class="text-sm muted" style="margin-bottom:12px">Lista oficial da TCGdex em ${tcg.langLabel(lang)}. Clique em uma carta para adicioná-la à Wishlist.</p>
        ${missing.length ? html`<div class="card-grid card-grid--sm">${missing.map((c, i) => cardTile({ ...c, set: { id: set.id, name: set.name } }, { attrs: `data-id="${c.id}"`, index: i, meta: `#${c.localId}` }))}</div>` : html`<div class="alert alert--success">${icon('check')}<div>Expansão completa!</div></div>`}`);
      hydrateImages(m.body);
      m.body.querySelectorAll('[data-id]').forEach((t) => t.addEventListener('click', async () => {
        const brief = missing.find((c) => c.id === t.dataset.id);
        const snap = await resolveSnapshot(brief, lang);
        await addToWishlist(snap);
        t.style.opacity = '.4';
      }));
    } catch (e) {
      m.setBody(html`<div class="state state--error"><div class="state__icon">${icon('offline')}</div><h3>Não foi possível consultar a expansão</h3><p>${e.message}</p><p class="text-xs">A lista de faltantes depende da TCGdex (lista oficial de cartas da expansão).</p></div>`);
      if (e.kind !== 'network') toastError(e);
    }
  };

  await load();
  return on('data:changed', load);
}
