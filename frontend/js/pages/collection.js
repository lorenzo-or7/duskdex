import { html, render, debounce, normalize, timeAgo, formatDateTime } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { prefs } from '../core/prefs.js';
import { loadAll, copyWhere } from '../stores/state.js';
import { groupCopies } from '../features/domain.js';
import { cardTile, cardArt, hydrateImages, finishLabel, langBadge } from '../components/card.js';
import { pickCards } from '../components/card-picker.js';
import { addToCollectionFlow, locationOptions } from '../features/actions.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { navigate, setQuery } from '../router.js';
import { langLabel } from '../api/tcgdex.js';
import { on } from '../core/events.js';
import { moveFlow } from './inventory.js';
import { conditionBadge, CONDITIONS } from '../features/conditions.js';

export default async function collection(ctx, main) {
  const db = data();
  const st = {
    q: ctx.query.q || '', set: ctx.query.set || '', rarity: '', lang: '', finish: '', loc: ctx.query.local || '',
    sort: ctx.query.ordem === 'recentes' ? 'recent' : (['recent', 'name', 'set', 'qty'].includes(ctx.query.ordem) ? ctx.query.ordem : 'recent'), view: prefs.get('collectionView') || 'grid',
    selecting: false, selected: new Set(), trade: ctx.query.troca === '1',
  };
  const tradeOn = db.capabilities.trades === true;
  let s = null; let entries = [];

  render(main, html`<div class="page page--wide">
    <div class="page-head"><div><div class="page-head__eyebrow">Minha coleção</div><h1>Minha Coleção</h1><p data-summary class="muted">Carregando…</p></div>
      <div class="btn-group">
        <button class="btn" type="button" data-custom>${icon('pencil')} Carta personalizada</button>
        <button class="btn btn--primary" type="button" data-add>${icon('plus')} Adicionar cartas</button>
      </div></div>
    ${db.mode === 'demo' ? html`<div class="alert" style="margin-bottom:18px">${icon('database')}<div>Sem conta, estas cartas ficam salvas <strong>só neste navegador</strong>. <a href="#/registrar">Crie uma conta</a> para guardá-las no servidor (dá para importar o que já está aqui).</div></div>` : ''}
    <div class="toolbar">
      <div class="input-group">${icon('search')}<input class="input" type="search" placeholder="Buscar por nome ou número" value="${st.q}" data-q aria-label="Buscar na coleção"></div>
      <select class="select" style="width:auto" data-f="set" aria-label="Expansão"></select>
      <select class="select" style="width:auto" data-f="rarity" aria-label="Raridade"></select>
      <select class="select" style="width:auto" data-f="lang" aria-label="Idioma"></select>
      <select class="select" style="width:auto" data-f="finish" aria-label="Versão"></select>
      <select class="select" style="width:auto" data-f="loc" aria-label="Local"></select>
      <select class="select" style="width:auto" data-f="sort" aria-label="Ordenação">
        <option value="recent">Mais recentes</option><option value="name">Nome</option><option value="set">Expansão e número</option><option value="qty">Quantidade</option>
      </select>
      <div class="segmented" role="group" aria-label="Visualização"><button type="button" data-view="grid" aria-pressed="${st.view === 'grid'}" aria-label="Grade">${icon('grid')}</button><button type="button" data-view="list" aria-pressed="${st.view === 'list'}" aria-label="Lista">${icon('list')}</button></div>
      ${tradeOn ? html`<button class="btn" type="button" data-tradefilter aria-pressed="${st.trade}" title="Mostrar só as cópias marcadas para troca">${icon('repeat')} Para troca</button>` : ''}
      <button class="btn" type="button" data-selectmode aria-pressed="false">${icon('select')} Selecionar</button>
    </div>
    <div data-selbar></div>
    <div data-body></div>
  </div>`);
  const $ = (q) => main.querySelector(q);
  const body = $('[data-body]');

  const load = async () => {
    s = await loadAll(['copies', 'binders', 'locations', 'decks', 'wishlist']);
    entries = groupCopies(s.copies);
    paintFilters();
    paint();
  };

  const paintFilters = () => {
    const cards = entries.map((e) => card(e.cardKey)).filter(Boolean);
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    const sets = uniq(cards.map((c) => c.set?.id ? `${c.set.id}|${c.set.name}` : null));
    const opt = (sel, label, list, cur, fmt = (x) => x) => render($(`[data-f="${sel}"]`), html`<option value="">${label}</option>${list.map((v) => html`<option value="${v.split('|')[0]}" ${cur === v.split('|')[0] ? 'selected' : ''}>${fmt(v)}</option>`)}`);
    opt('set', 'Todas as expansões', sets, st.set, (v) => v.split('|')[1]);
    opt('rarity', 'Todas as raridades', uniq(cards.map((c) => c.rarity)), st.rarity);
    opt('lang', 'Todos os idiomas', uniq(entries.map((e) => e.lang)), st.lang, langLabel);
    opt('finish', 'Todas as versões', uniq(entries.map((e) => e.finish)), st.finish, finishLabel);
    render($('[data-f="loc"]'), html`<option value="">Todos os locais</option>${locationOptions(s.locations, st.loc, { allowBinders: true, allowDecks: true })}`);
    $('[data-f="sort"]').value = st.sort;
  };

  const filtered = () => {
    const q = normalize(st.q);
    let list = entries.filter((e) => {
      const c = card(e.cardKey);
      if (q && !(normalize(c?.name).includes(q) || String(c?.localId || '') === st.q)) return false;
      if (st.set && c?.set?.id !== st.set) return false;
      if (st.rarity && c?.rarity !== st.rarity) return false;
      if (st.lang && e.lang !== st.lang) return false;
      if (st.finish && e.finish !== st.finish) return false;
      if (st.trade && !e.copies.some((cp) => cp.forTrade)) return false;
      if (st.loc) {
        const inLoc = (cp) => { let id = cp.locationId; let g = 0; while (id && g++ < 20) { if (id === st.loc) return true; id = s.locations.find((l) => l.id === id)?.parentId; } return false; };
        if (!e.copies.some(inLoc)) return false;
      }
      return true;
    });
    const name = (e) => card(e.cardKey)?.name || '';
    const setKey = (e) => { const c = card(e.cardKey); return `${c?.set?.id || '~'}|${String(c?.localId || '').padStart(5, '0')}`; };
    list = list.sort((a, b) => ({
      recent: () => (a.lastAdded < b.lastAdded ? 1 : -1),
      name: () => name(a).localeCompare(name(b)),
      set: () => setKey(a).localeCompare(setKey(b)),
      qty: () => b.copies.length - a.copies.length,
    })[st.sort]());
    return list;
  };

  const paint = () => {
    const total = entries.reduce((n, e) => n + e.copies.length, 0);
    $('[data-summary]').textContent = `${total} carta(s) física(s) · ${entries.length} entrada(s) distintas (carta + idioma + versão)`;
    const list = filtered();
    if (!entries.length) {
      render(body, html`<div class="state"><div class="state__icon">${icon('layers')}</div><h3>Sua coleção está vazia</h3><p>Pesquise uma carta no catálogo, escolha a versão e a quantidade. Cada unidade vira uma cópia individual.</p><button class="btn btn--primary" type="button" data-add2>${icon('plus')} Adicionar primeira carta</button></div>`);
      body.querySelector('[data-add2]').addEventListener('click', openAdd);
      return;
    }
    if (!list.length) { render(body, html`<div class="state"><div class="state__icon">${icon('filter')}</div><h3>Nada com esses filtros</h3><p>Ajuste a busca ou limpe os filtros.</p></div>`); return; }
    if (st.view === 'grid') {
      render(body, html`<div class="card-grid">${list.map((e, i) => cardTile(card(e.cardKey), {
        qty: e.copies.length, selectable: st.selecting, selected: st.selected.has(e.key), attrs: `data-key="${e.key}"`, index: i,
        meta: [langLabel(e.lang), finishLabel(e.finish), e.copies.some((cp) => cp.forTrade) ? `${e.copies.filter((cp) => cp.forTrade).length} p/ troca` : null].filter(Boolean).join(' · '),
      }))}</div>`);
    } else {
      render(body, html`<div class="card-list">${list.map((e) => {
        const c = card(e.cardKey);
        const where = [...new Set(e.copies.map((cp) => copyWhere(cp, s)))];
        return html`<div class="card-row ${st.selected.has(e.key) ? 'is-selected' : ''}" data-key="${e.key}">
          ${st.selecting ? html`<input type="checkbox" class="checkbox" data-check ${st.selected.has(e.key) ? 'checked' : ''} aria-label="Selecionar">` : html`<span></span>`}
          <div style="width:48px">${cardArt(c)}</div>
          <div class="card-row__main" data-open><div class="card-row__name">${c?.name || e.cardKey} ${e.custom ? html`<span class="badge badge--crimson">personalizada</span>` : ''}</div>
            <div class="card-row__meta"><span>${c?.set?.name || c?.setLabel || ''} ${c?.localId ? `#${c.localId}` : ''}</span><span>${langLabel(e.lang)}</span><span>${finishLabel(e.finish)}</span><span class="cond-badges">${[...new Set(e.copies.map((cp) => cp.condition || 'NM'))].map((k) => conditionBadge(k))}</span><span title="${where.join(' | ')}">${icon('pin')} ${where[0]}${where.length > 1 ? ` +${where.length - 1}` : ''}</span></div></div>
          <div class="stepper stepper--sm"><button type="button" data-dec aria-label="Remover uma cópia">${icon('minus')}</button><output>${e.copies.length}</output><button type="button" data-inc aria-label="Adicionar uma cópia">${icon('plus')}</button></div>
        </div>`;
      })}</div>`);
    }
    hydrateImages(body);
  };

  // ---------- eventos
  body.addEventListener('click', async (ev) => {
    const row = ev.target.closest('[data-key]');
    if (!row) return;
    const entry = entries.find((e) => e.key === row.dataset.key);
    if (!entry) return;
    if (ev.target.closest('[data-inc]')) return changeQty(entry, +1);
    if (ev.target.closest('[data-dec]')) return changeQty(entry, -1);
    if (st.selecting || ev.target.closest('[data-select],[data-check]')) {
      if (st.selected.has(entry.key)) st.selected.delete(entry.key); else st.selected.add(entry.key);
      paint(); paintSelbar(); return;
    }
    if (ev.target.closest('[data-open]')) openDetail(entry);
  });
  $('[data-q]').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); setQuery({ q: st.q }); paint(); }, 200));
  main.querySelectorAll('[data-f]').forEach((sel) => sel.addEventListener('change', () => { st[sel.dataset.f] = sel.value; paint(); }));
  main.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    st.view = b.dataset.view; prefs.set('collectionView', st.view);
    main.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint();
  }));
  $('[data-tradefilter]')?.addEventListener('click', (e) => { st.trade = !st.trade; e.currentTarget.setAttribute('aria-pressed', String(st.trade)); setQuery({ troca: st.trade ? '1' : '' }); paint(); });
  $('[data-selectmode]').addEventListener('click', (e) => { st.selecting = !st.selecting; st.selected.clear(); e.currentTarget.setAttribute('aria-pressed', String(st.selecting)); paint(); paintSelbar(); });

  const openAdd = async () => {
    const snaps = await pickCards({ title: 'Adicionar cartas à coleção', multi: true, confirmLabel: 'Continuar' });
    if (snaps?.length && await addToCollectionFlow(snaps)) load();
  };
  $('[data-add]').addEventListener('click', openAdd);
  $('[data-custom]').addEventListener('click', async () => {
    const snaps = await pickCards({ title: 'Nova carta personalizada', sources: ['custom'] });
    if (snaps?.length && await addToCollectionFlow(snaps)) load();
  });

  const changeQty = async (entry, delta) => {
    try {
      if (delta > 0) {
        await db.addCopies([{ cardKey: entry.cardKey, cardId: entry.cardId, lang: entry.lang, finish: entry.finish, qty: 1, custom: entry.custom }], { label: 'Cópia adicionada pela coleção' });
        toast({ type: 'success', text: 'Mais uma cópia cadastrada em “Sem local definido”.' });
      } else {
        const free = entry.copies.filter((c) => !c.slot && !c.reservedFor && !c.deckAssembled).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        let target = free[0];
        if (!target) {
          const ok = await confirmDialog({ title: 'Remover uma cópia', message: 'Todas as cópias desta carta estão em fichários, reservadas ou em decks. A cópia removida liberará o bolso ou a reserva correspondente.', details: html`<div class="locs">${entry.copies.map((c) => html`<div class="loc-line">${icon('pin')}${copyWhere(c, s)}</div>`)}</div>`, confirmLabel: 'Remover a mais recente', danger: true });
          if (!ok) return;
          target = entry.copies.filter((c) => !c.deckAssembled).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
          if (!target) { toast({ type: 'warning', text: 'As cópias estão montadas em deck físico. Desmonte o deck primeiro.' }); return; }
        }
        await db.removeCopies([target.id], { reason: 'Cópia removida pela coleção' });
        toast({ type: 'success', text: 'Uma cópia removida. O histórico guarda a operação.' });
      }
      changed('collection'); load();
    } catch (e) { toastError(e); }
  };

  const paintSelbar = () => {
    const box = $('[data-selbar]');
    if (!st.selecting) { box.innerHTML = ''; return; }
    const chosen = entries.filter((e) => st.selected.has(e.key));
    const nCopies = chosen.reduce((n, e) => n + e.copies.length, 0);
    render(box, html`<div class="selection-bar"><strong>${chosen.length} entrada(s) · ${nCopies} cópia(s)</strong><span class="grow"></span>
      <button class="btn btn--sm" type="button" data-all>Selecionar visíveis</button>
      <button class="btn btn--sm" type="button" data-move ${chosen.length && db.capabilities.inventory ? '' : 'disabled'} title="">${icon('move')} Mover</button>
      ${tradeOn ? html`<button class="btn btn--sm" type="button" data-trade="1" ${chosen.length ? '' : 'disabled'} title="Outros colecionadores verão estas cópias (sem a localização) e poderão propor trocas">${icon('repeat')} Marcar para troca</button>
      <button class="btn btn--sm" type="button" data-trade="0" ${chosen.length ? '' : 'disabled'}>Desmarcar troca</button>` : ''}
      <button class="btn btn--sm btn--danger" type="button" data-remove ${chosen.length ? '' : 'disabled'}>${icon('trash')} Remover</button>
      <button class="btn btn--sm btn--ghost" type="button" data-cancel>Cancelar</button></div>`);
    box.querySelector('[data-cancel]').addEventListener('click', () => $('[data-selectmode]').click());
    box.querySelector('[data-all]').addEventListener('click', () => { filtered().forEach((e) => st.selected.add(e.key)); paint(); paintSelbar(); });
    box.querySelector('[data-move]').addEventListener('click', async () => {
      const ids = chosen.flatMap((e) => e.copies.map((c) => c.id));
      if (await moveFlow(ids)) { $('[data-selectmode]').click(); load(); }
    });
    box.querySelectorAll('[data-trade]').forEach((b) => b.addEventListener('click', async () => {
      const on = b.dataset.trade === '1';
      const ids = chosen.flatMap((e) => e.copies).filter((c) => !c.custom).map((c) => c.id);
      if (!ids.length) { toast({ type: 'info', text: 'Cartas personalizadas não entram em trocas.' }); return; }
      if (on && !(await confirmTradeConditions(chosen.flatMap((e) => e.copies).filter((c) => !c.custom)))) return;
      try { const r = await db.setForTrade(ids, on); toast({ type: 'success', text: on ? `${r.updated} cópia(s) disponíveis para troca.` : `${r.updated} cópia(s) fora das trocas.` }); changed('collection'); $('[data-selectmode]').click(); load(); } catch (e) { toastError(e); }
    }));
    box.querySelector('[data-remove]').addEventListener('click', async () => {
      const blocked = chosen.flatMap((e) => e.copies).filter((c) => c.deckAssembled);
      const ok = await confirmDialog({
        title: `Remover ${nCopies} cópia(s)?`, danger: true, confirmLabel: 'Remover da coleção',
        message: 'As cópias saem da coleção (vendidas, trocadas ou perdidas). Bolsos e reservas são liberados. O histórico mantém o registro e a operação pode ser revertida no Inventário.',
        details: blocked.length ? html`<div class="alert alert--warning">${icon('alert')}<div>${blocked.length} cópia(s) estão montadas em deck e serão ignoradas.</div></div>` : null,
      });
      if (!ok) return;
      try {
        await db.removeCopies(chosen.flatMap((e) => e.copies).filter((c) => !c.deckAssembled).map((c) => c.id));
        toast({ type: 'success', text: 'Cópias removidas da coleção.' });
        changed('collection'); $('[data-selectmode]').click(); load();
      } catch (e) { toastError(e); }
    });
  };

  const openDetail = async (entry) => {
    const c = card(entry.cardKey);
    const batches = db.listBatches ? await db.listBatches().catch(() => []) : [];
    const ids = new Set(entry.copies.map((x) => x.id));
    const hist = batches.flatMap((b) => b.movements.filter((m) => ids.has(m.copyId)).map((m) => ({ b, m }))).slice(0, 12);
    const locName = (id) => s.locations.find((l) => l.id === id)?.name || (id ? '—' : 'Nova aquisição');
    const m = openModal({
      title: c?.name || 'Carta', drawer: true,
      body: html`<div class="stack stack--lg">
        <div style="max-width:220px;margin:0 auto;width:100%">${cardArt(c, { quality: 'high' })}</div>
        <div class="row" style="gap:6px">${langBadge(entry.lang)}<span class="badge">${finishLabel(entry.finish)}</span>${c?.rarity ? html`<span class="badge">${c.rarity}</span>` : ''}${entry.custom ? html`<span class="badge badge--crimson">personalizada</span>` : ''}</div>
        <p class="muted text-sm">${c?.set?.name || c?.setLabel || ''} ${c?.localId ? `· nº ${c.localId}` : ''}</p>
        <section><h3 class="field__label" style="margin-bottom:8px">${entry.copies.length} cópia(s) · onde estão</h3>
          <div class="locs">${entry.copies.map((cp, i) => html`<div class="loc-line">${icon(cp.slot ? 'book' : cp.deckAssembled ? 'swords' : 'pin')}<div class="grow"><div>${copyWhere(cp, s)}</div><div class="text-xs subtle">Cópia ${i + 1} · <span class="mono">${cp.id.slice(-8)}</span> · desde ${timeAgo(cp.createdAt)}${cp.reservedFor ? ' · reservada para deck' : ''}${cp.forTrade ? ' · para troca' : ''}${cp.viaTrade ? ' · recebida em troca' : ''}</div></div>
            ${cp.slot ? html`<a class="btn btn--sm btn--ghost" href="#/ficharios/${cp.slot.binderId}">Abrir</a>` : ''}</div>`)}</div></section>
        <section><h3 class="field__label" style="margin-bottom:8px">Histórico recente</h3>
          ${hist.length ? html`<ul class="timeline">${hist.map(({ b, m: mv }) => html`<li><span class="timeline__icon">${icon(b.type === 'acquire' ? 'plus' : b.type === 'remove' ? 'trash' : b.type === 'revert' ? 'undo' : 'move')}</span><div><div class="timeline__text">${b.label}</div><div class="timeline__time">${locName(mv.from.locationId)} → ${locName(mv.to.locationId)} · ${formatDateTime(b.createdAt)}</div></div></li>`)}</ul>` : html`<p class="text-sm muted">Sem movimentações registradas.</p>`}
        </section>
      </div>`,
      footer: html`${c && c.source !== 'custom' ? html`<a class="btn btn--ghost" href="#/carta/${encodeURIComponent(c.id)}?lang=${c.lang}">${icon('eye')} Página da carta</a>` : ''}<span class="spacer"></span>
        <button class="btn" type="button" data-dec>${icon('minus')} Remover 1</button><button class="btn btn--primary" type="button" data-inc>${icon('plus')} Adicionar 1</button>`,
    });
    hydrateImages(m.body);
    m.foot.querySelector('[data-inc]').addEventListener('click', async () => { m.close(); await changeQty(entry, +1); });
    m.foot.querySelector('[data-dec]').addEventListener('click', async () => { m.close(); await changeQty(entry, -1); });
    m.foot.querySelector('a')?.addEventListener('click', () => m.close());
  };

  await load();
  if (ctx.query.add === '1') { setQuery({ add: '' }); openAdd(); }
  const off = on('data:changed', (scope) => { if (scope !== 'collection') load(); });
  return off;
}

export { navigate };

/**
 * Antes de oferecer cópias para troca, confirma o estado de conservação de cada uma
 * (é o que os outros colecionadores vão ver). Ajustes são salvos antes de marcar.
 */
function confirmTradeConditions(copies) {
  const db = data();
  const cond = new Map(copies.map((c) => [c.id, c.condition || 'NM']));
  return new Promise((resolve) => {
    let ok = false;
    const m = openModal({
      title: 'Confirme o estado das cartas', size: 'md',
      body: html`<div class="stack">
        <p class="text-sm muted">Quem se interessar pelas suas cartas vai ver o estado de cada uma. Confira antes de oferecer:</p>
        <div class="card-list cond-confirm">${copies.slice(0, 200).map((c) => { const cd = card(c.cardKey); return html`<div class="card-row" style="grid-template-columns:40px minmax(0,1fr) auto">
          <div style="width:40px">${cardArt(cd)}</div>
          <div><div class="card-row__name">${cd?.name || c.cardKey}</div><div class="card-row__meta"><span>${langLabel(c.lang)}</span><span>${finishLabel(c.finish)}</span></div></div>
          <select class="select select--xs" data-cond-for="${c.id}" aria-label="Estado de conservação">${CONDITIONS.map((k) => html`<option value="${k.id}" ${cond.get(c.id) === k.id ? 'selected' : ''}>${k.id} · ${k.label}</option>`)}</select></div>`; })}</div>
        ${copies.length > 200 ? html`<p class="text-xs muted">Mostrando 200 de ${copies.length}; as demais mantêm o estado atual.</p>` : ''}
        <details class="text-sm"><summary class="muted" style="cursor:pointer">O que significa cada estado?</summary><ul class="cond-legend">${CONDITIONS.map((k) => html`<li>${conditionBadge(k.id)} <strong>${k.label}</strong> — ${k.hint}</li>`)}</ul></details>
      </div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>${icon('repeat')} Confirmar e marcar para troca</button>`,
      onClose: () => resolve(ok),
    });
    hydrateImages(m.body);
    m.body.addEventListener('change', (e) => { const id = e.target.dataset.condFor; if (id) cond.set(id, e.target.value); });
    m.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const byCond = new Map();
        for (const c of copies) { const v = cond.get(c.id); if (v !== (c.condition || 'NM')) { if (!byCond.has(v)) byCond.set(v, []); byCond.get(v).push(c.id); } }
        for (const [v, ids] of byCond) await db.setCondition(ids, v);
        ok = true; m.close();
      } catch (err) { toastError(err); e.currentTarget.disabled = false; }
    });
  });
}
