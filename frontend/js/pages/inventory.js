import { html, render, formatDateTime, uid, timeAgo } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { loadAll, copyWhere, locationPath } from '../stores/state.js';
import { cardArt, hydrateImages, finishLabel } from '../components/card.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { locationOptions } from '../features/actions.js';
import { LOCATION_KINDS } from '../api/demo-adapter.js';
import { setQuery } from '../router.js';
import { on } from '../core/events.js';

const KIND_ICON = { system: 'info', room: 'home', shelf: 'folder', drawer: 'box', box: 'box', folder: 'folder', divider: 'layout', binder: 'book', deck_box: 'swords', custom: 'pin' };
const BATCH_ICON = { acquire: 'plus', move: 'move', remove: 'trash', reorganize: 'book', deck: 'swords', revert: 'undo' };
const BATCH_LABEL = { acquire: 'Aquisição', move: 'Movimentação', remove: 'Remoção', reorganize: 'Fichário', deck: 'Deck', revert: 'Reversão' };

/** Fluxo de movimentação com PRÉVIA obrigatória e confirmação. Retorna o lote criado ou null. */
export async function moveFlow(copyIds, { defaultDest = null } = {}) {
  const db = data();
  if (!db.capabilities.inventory) { toast({ type: 'info', text: 'Movimentações não estão disponíveis neste modo.' }); return null; }
  const locations = await db.listLocations();
  return new Promise((resolve) => {
    let result = null; let preview = null;
    const key = uid('idem_');
    const m = openModal({
      title: `Mover ${copyIds.length} carta(s)`, size: 'lg',
      body: html`<div class="stack stack--lg">
        <label class="field"><span class="field__label">Destino</span><select class="select" data-dest>${locationOptions(locations, defaultDest || db.inboxId)}</select>
          <span class="field__hint">Para colocar cartas em bolsos de um fichário físico, use o editor do fichário. Para decks, use a montagem do deck.</span></label>
        <div data-preview><div class="center-loader" style="padding:20px"><span class="loader"><span class="loader__eclipse"></span>Gerando prévia…</span></div></div>
      </div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok disabled>${icon('check')} Confirmar movimentação</button>`,
      onClose: () => resolve(result),
    });
    const ok = m.foot.querySelector('[data-ok]');
    const run = async () => {
      ok.disabled = true;
      try {
        preview = await db.previewMove(copyIds, m.body.querySelector('[data-dest]').value);
        render(m.body.querySelector('[data-preview]'), html`
          <h3 class="field__label" style="margin-bottom:8px">Prévia</h3>
          ${preview.capacityWarn ? html`<div class="alert alert--warning" style="margin-bottom:10px">${icon('alert')}<div>${preview.capacityWarn}</div></div>` : ''}
          ${preview.items.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Carta</th><th>Origem</th><th>Destino</th></tr></thead><tbody>
            ${preview.items.map((it) => html`<tr><td><strong>${card(it.copy.cardKey)?.name || '—'}</strong> <span class="text-xs muted">${finishLabel(it.copy.finish)}</span>${it.warning ? html`<div class="text-xs" style="color:var(--warning)">${it.warning}</div>` : ''}</td><td class="text-sm">${it.from}</td><td class="text-sm">${preview.dest.name}</td></tr>`)}
          </tbody></table></div>` : html`<p class="muted">Nenhuma carta será movida.</p>`}
          ${preview.blocked.length ? html`<div class="alert alert--danger mt-3">${icon('alert')}<div><strong>${preview.blocked.length} não serão movidas:</strong><ul style="margin:6px 0 0;padding-left:18px">${preview.blocked.map((b) => html`<li>${card(b.copy.cardKey)?.name || '—'} — ${b.reason}</li>`)}</ul></div></div>` : ''}`);
        ok.disabled = !preview.items.length;
      } catch (e) { render(m.body.querySelector('[data-preview]'), html`<div class="alert alert--danger">${icon('alert')}<div>${e.message}</div></div>`); }
    };
    m.body.querySelector('[data-dest]').addEventListener('change', run);
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try {
        result = await db.commitMove(preview.items.map((i) => i.copy.id), preview.dest.id, { token: preview.token.split(',').filter((t) => preview.items.some((i) => t.startsWith(i.copy.id + '@'))).join(','), idempotencyKey: key });
        changed('inventory');
        toast({ type: 'success', title: 'Movimentação registrada', text: `${result.movements.length} carta(s) agora em “${preview.dest.name}”. Pode ser revertida no histórico.` });
        m.close();
      } catch (e) { toastError(e); if (e.code === 'CONFLICT') run(); else ok.disabled = false; }
    });
    run();
  });
}

function locationForm(locations, loc = null, parentId = null) {
  return new Promise((resolve) => {
    let result = null;
    const kinds = Object.entries(LOCATION_KINDS).filter(([k]) => !['system', 'binder', 'deck_box'].includes(k) || k === loc?.kind);
    const m = openModal({
      title: loc ? 'Editar local' : 'Novo local',
      body: html`<form class="form-grid" data-form>
        <label class="field span-2"><span class="field__label">Nome *</span><input class="input" name="name" required maxlength="60" value="${loc?.name || ''}" placeholder="Ex.: Caixa de holos" autofocus></label>
        <label class="field"><span class="field__label">Tipo</span><select class="select" name="kind" ${loc?.binderId || loc?.deckId ? 'disabled' : ''}>${kinds.map(([k, l]) => html`<option value="${k}" ${(loc?.kind || 'box') === k ? 'selected' : ''}>${l}</option>`)}</select></label>
        <label class="field"><span class="field__label">Dentro de</span><select class="select" name="parentId"><option value="">— Nível principal —</option>${locationOptions(locations.filter((l) => !l.system && l.id !== loc?.id), loc ? loc.parentId : parentId, { allowBinders: false })}</select></label>
        <label class="field"><span class="field__label">Capacidade (opcional)</span><input class="input" name="capacity" type="number" min="1" max="100000" value="${loc?.capacity || ''}"></label>
        <label class="field span-2"><span class="field__label">Descrição</span><textarea class="textarea" name="description" maxlength="300">${loc?.description || ''}</textarea></label>
      </form>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>Salvar</button>`,
      onClose: () => resolve(result),
    });
    const submit = async () => {
      const fd = new FormData(m.body.querySelector('form'));
      const payload = { name: String(fd.get('name') || '').trim(), parentId: fd.get('parentId') || null, description: String(fd.get('description') || ''), capacity: fd.get('capacity') ? Number(fd.get('capacity')) : null };
      if (!loc?.binderId && !loc?.deckId) payload.kind = fd.get('kind');
      try {
        result = loc ? await data().updateLocation(loc.id, payload) : await data().createLocation(payload);
        changed('inventory'); m.close();
      } catch (e) { toastError(e); }
    };
    m.foot.querySelector('[data-ok]').addEventListener('click', submit);
    m.body.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  });
}

/** Prévia e execução de reversão (total ou parcial). */
async function revertFlow(batch) {
  const db = data();
  let pv;
  try { pv = await db.previewRevert(batch.id); } catch (e) { toastError(e); return; }
  const s = await loadAll(['locations', 'binders', 'decks']);
  const where = (side) => (side.slot ? (() => { const b = s.binders.find((x) => x.id === side.slot.binderId); return b ? `${b.name} · pág. ${b.pages.findIndex((p) => p.id === side.slot.pageId) + 1} · bolso ${side.slot.index + 1}` : 'Fichário excluído'; })() : side.locationId ? locationPath(side.locationId, s.locations) || '—' : 'Fora da coleção (nova aquisição)');
  return new Promise((resolve) => {
    let done = null;
    const m = openModal({
      title: 'Reverter operação', size: 'lg',
      body: html`<div class="stack">
        <p class="muted">“${batch.label}” · ${formatDateTime(batch.createdAt)}. A reversão cria uma <strong>nova operação compensatória</strong>; o histórico original não é apagado. Itens com conflito não podem ser revertidos.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th style="width:36px"></th><th>Carta</th><th>Voltaria para</th><th>Situação</th></tr></thead><tbody>
          ${pv.items.map((it) => html`<tr><td><input type="checkbox" class="checkbox" data-mv="${it.movement.id}" ${it.conflicts.length ? 'disabled' : 'checked'} aria-label="Incluir"></td>
            <td><strong>${card(it.movement.cardKey)?.name || '—'}</strong></td><td class="text-sm">${where(it.movement.from)}</td>
            <td class="text-sm">${it.conflicts.length ? html`<span style="color:var(--danger)">${icon('alert')} ${it.conflicts.join(' ')}</span>` : html`<span style="color:var(--success)">Pode ser revertido</span>`}</td></tr>`)}
        </tbody></table></div>
      </div>`,
      footer: html`<span class="text-sm muted" data-n></span><span class="spacer"></span><button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--crimson" type="button" data-ok>${icon('undo')} Reverter selecionados</button>`,
      onClose: () => resolve(done),
    });
    const upd = () => {
      const n = m.body.querySelectorAll('[data-mv]:checked').length;
      m.foot.querySelector('[data-n]').textContent = `${n} de ${pv.items.length} movimento(s)`;
      m.foot.querySelector('[data-ok]').disabled = !n;
    };
    m.body.addEventListener('change', upd); upd();
    m.foot.querySelector('[data-ok]').addEventListener('click', async () => {
      const ids = [...m.body.querySelectorAll('[data-mv]:checked')].map((x) => x.dataset.mv);
      const ok = await confirmDialog({ title: 'Confirmar reversão física', message: `Confirme que você vai devolver fisicamente ${ids.length} carta(s) aos locais de origem.`, confirmLabel: 'Já devolvi / vou devolver' });
      if (!ok) return;
      try {
        done = await db.revertBatch(batch.id, ids);
        changed('inventory');
        toast({ type: 'success', title: 'Operação revertida', text: `${done.movements.length} movimento(s) compensado(s).` });
        m.close();
      } catch (e) { toastError(e, 'Reversão bloqueada'); }
    });
  });
}

export default async function inventory(ctx, main) {
  const db = data();
  const st = { tab: ctx.query.aba === 'historico' ? 'history' : 'locations', sel: ctx.query.local || db.inboxId, sub: true, selected: new Set(), type: '' };
  let s;

  const load = async () => {
    s = await loadAll(['copies', 'locations', 'binders', 'decks', 'batches']);
    if (!s.locations.some((l) => l.id === st.sel)) st.sel = s.locations.find((l) => !l.hidden)?.id;
    paint();
  };

  const descendants = (id) => { const out = [id]; for (let i = 0; i < out.length; i++) s.locations.filter((l) => l.parentId === out[i]).forEach((l) => out.push(l.id)); return out; };
  const countIn = (id) => { const ids = new Set(descendants(id)); return s.copies.filter((c) => c.status !== 'removed' && ids.has(c.locationId)).length; };

  const tree = (pid) => {
    const kids = s.locations.filter((l) => (l.parentId || null) === pid && !l.hidden).sort((a, b) => (b.system ? 1 : 0) - (a.system ? 1 : 0) || a.name.localeCompare(b.name));
    if (!kids.length) return '';
    return html`<ul class="tree" role="${pid ? 'group' : 'tree'}">${kids.map((l) => html`<li role="treeitem" aria-selected="${l.id === st.sel}">
      <button class="tree__node" type="button" data-loc="${l.id}" aria-selected="${l.id === st.sel}">${icon(KIND_ICON[l.kind] || 'pin')}<span class="ellipsis">${l.name}</span><span class="tree__count">${countIn(l.id)}</span></button>
      ${tree(l.id)}</li>`)}</ul>`;
  };

  const paint = () => {
    render(main, html`<div class="page page--wide">
      <div class="page-head page-head--art" data-art="inventory"><div><div class="page-head__eyebrow">Armazenamento físico</div><h1>Inventário</h1><p>Locais, cartas em cada local, movimentações com prévia e histórico com reversão segura.</p></div>
        <div class="btn-group"><button class="btn btn--primary" type="button" data-newloc>${icon('plus')} Novo local</button></div></div>

      <div class="tabs" role="tablist"><button class="tab" role="tab" type="button" data-tab="locations" aria-selected="${st.tab === 'locations'}">${icon('box')} Locais</button><button class="tab" role="tab" type="button" data-tab="history" aria-selected="${st.tab === 'history'}">${icon('history')} Histórico</button></div>
      <div data-pane></div></div>`);
    main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; setQuery({ aba: st.tab === 'history' ? 'historico' : '' }); paint(); }));
    main.querySelector('[data-newloc]').addEventListener('click', async () => { const l = await locationForm(s.locations, null, st.sel && !s.locations.find((x) => x.id === st.sel)?.system ? st.sel : null); if (l) { st.sel = l.id; load(); } });
    if (st.tab === 'locations') paintLocations(); else paintHistory();
  };

  const paintLocations = () => {
    const pane = main.querySelector('[data-pane]');
    const loc = s.locations.find((l) => l.id === st.sel);
    const ids = st.sub ? new Set(descendants(st.sel)) : new Set([st.sel]);
    const here = s.copies.filter((c) => c.status !== 'removed' && ids.has(c.locationId))
      .sort((a, b) => (a.slot && b.slot ? (a.slot.pageId === b.slot.pageId ? a.slot.index - b.slot.index : 0) : 0) || String(card(a.cardKey)?.name).localeCompare(String(card(b.cardKey)?.name)));
    const binder = loc?.binderId ? s.binders.find((b) => b.id === loc.binderId) : null;
    render(pane, html`<div class="inventory-layout">
      <aside class="panel inventory-tree"><div class="panel__head" style="margin:4px 6px 10px"><h2 class="panel__title">${icon('package')} Locais</h2></div>${tree(null)}</aside>
      <section class="stack stack--lg">
        ${loc ? html`<div class="panel"><div class="row row--between"><div>
            <div class="text-xs muted">${locationPath(loc.id, s.locations)}</div>
            <h2 style="font-family:var(--font-display);font-size:1.8rem;font-weight:600">${loc.name}</h2>
            <div class="row" style="gap:6px;margin-top:6px"><span class="badge">${LOCATION_KINDS[loc.kind] || loc.kind}</span>${loc.capacity ? html`<span class="badge ${countIn(loc.id) > loc.capacity ? 'badge--danger' : ''}">${countIn(loc.id)} / ${loc.capacity}</span>` : ''}${binder ? html`<a class="badge badge--primary" href="#/ficharios/${binder.id}">Abrir fichário</a>` : ''}</div>
            ${loc.description ? html`<p class="muted text-sm mt-2">${loc.description}</p>` : ''}</div>
            <div class="btn-group">${!loc.system ? html`<button class="btn btn--sm" type="button" data-sub-new>${icon('plus')} Sublocal</button><button class="btn btn--sm" type="button" data-edit>${icon('pencil')} Editar</button><button class="btn btn--sm btn--danger" type="button" data-del>${icon('trash')}</button>` : ''}</div></div></div>` : ''}
        <div class="row row--between">
          <label class="checkbox"><input type="checkbox" data-subtoggle ${st.sub ? 'checked' : ''}> Incluir sublocais</label>
          <div class="btn-group"><span class="text-sm muted">${st.selected.size} selecionada(s)</span>
            <button class="btn btn--sm" type="button" data-selall>Selecionar todas</button>
            <button class="btn btn--sm btn--primary" type="button" data-move ${st.selected.size && db.capabilities.inventory ? '' : 'disabled'}>${icon('move')} Mover selecionadas</button></div>
        </div>
        ${here.length ? html`<div class="card-list">${here.map((c) => {
    const cd = card(c.cardKey);
    return html`<label class="card-row ${st.selected.has(c.id) ? 'is-selected' : ''}" style="cursor:pointer"><input type="checkbox" data-copy="${c.id}" ${st.selected.has(c.id) ? 'checked' : ''} ${c.deckAssembled ? 'disabled' : ''} aria-label="Selecionar ${cd?.name || ''}">
            <div style="width:48px">${cardArt(cd)}</div>
            <div class="card-row__main"><div class="card-row__name">${cd?.name || '—'}</div><div class="card-row__meta"><span>${cd?.set?.name || ''} ${cd?.localId ? `#${cd.localId}` : ''}</span><span>${c.lang.toUpperCase()} · ${finishLabel(c.finish)}</span><span>${icon('pin')} ${copyWhere(c, s)}</span>${c.reservedFor ? html`<span class="badge badge--warning">reservada</span>` : ''}${c.deckAssembled ? html`<span class="badge badge--crimson">em deck</span>` : ''}</div></div><span></span></label>`;
  })}</div>` : html`<div class="state"><div class="state__icon">${icon('box')}</div><h3>Nenhuma carta aqui</h3><p>Mova cartas para este local a partir da coleção ou de outro local.</p></div>`}
      </section></div>`);
    hydrateImages(pane);
    pane.querySelectorAll('[data-loc]').forEach((b) => b.addEventListener('click', () => { st.sel = b.dataset.loc; st.selected.clear(); setQuery({ local: st.sel }); paintLocations(); }));
    pane.querySelector('[data-subtoggle]').addEventListener('change', (e) => { st.sub = e.target.checked; paintLocations(); });
    pane.querySelectorAll('[data-copy]').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) st.selected.add(cb.dataset.copy); else st.selected.delete(cb.dataset.copy); paintLocations(); }));
    pane.querySelector('[data-selall]').addEventListener('click', () => { here.filter((c) => !c.deckAssembled).forEach((c) => st.selected.add(c.id)); paintLocations(); });
    pane.querySelector('[data-move]').addEventListener('click', async () => { if (await moveFlow([...st.selected])) { st.selected.clear(); load(); } });
    pane.querySelector('[data-edit]')?.addEventListener('click', async () => { if (await locationForm(s.locations, loc)) load(); });
    pane.querySelector('[data-sub-new]')?.addEventListener('click', async () => { const l = await locationForm(s.locations, null, loc.id); if (l) { st.sel = l.id; load(); } });
    pane.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: `Excluir “${loc.name}”?`, message: 'Só é possível excluir locais vazios e sem sublocais.', danger: true, confirmLabel: 'Excluir' })) return;
      try { await db.deleteLocation(loc.id); changed('inventory'); st.sel = db.inboxId; load(); } catch (e) { toastError(e); }
    });
  };

  const paintHistory = () => {
    const pane = main.querySelector('[data-pane]');
    const batches = s.batches.filter((b) => !st.type || b.type === st.type);
    const lname = (side) => (side.slot ? (() => { const b = s.binders.find((x) => x.id === side.slot.binderId); return b ? `${b.name} · p.${b.pages.findIndex((p) => p.id === side.slot.pageId) + 1} · b.${side.slot.index + 1}` : 'fichário excluído'; })() : side.locationId ? (s.locations.find((l) => l.id === side.locationId)?.name || 'local excluído') : 'aquisição');
    render(pane, html`<div class="toolbar"><select class="select" style="width:auto" data-type aria-label="Tipo de operação"><option value="">Todas as operações</option>${Object.entries(BATCH_LABEL).map(([k, v]) => html`<option value="${k}" ${st.type === k ? 'selected' : ''}>${v}</option>`)}</select><span class="text-sm muted">${batches.length} operação(ões) · o histórico nunca é apagado por reversões</span></div>
      ${batches.length ? html`<div class="stack">${batches.slice(0, 120).map((b) => {
    const reverted = (b.revertedMovementIds || []).length;
    return html`<details class="panel" style="padding:14px 18px">
          <summary class="row" style="cursor:pointer;list-style:none;gap:12px"><span class="timeline__icon">${icon(BATCH_ICON[b.type] || 'info')}</span>
            <div class="grow"><strong>${b.label}</strong><div class="text-xs muted">${BATCH_LABEL[b.type] || b.type} · ${b.movements.length} carta(s) · ${formatDateTime(b.createdAt)} (${timeAgo(b.createdAt)})</div></div>
            ${reverted ? html`<span class="badge badge--warning">${reverted === b.movements.length ? 'revertida' : `${reverted} revertido(s)`}</span>` : ''}
            ${b.revertsBatchId ? html`<span class="badge">compensatória</span>` : ''}
            ${db.capabilities.revert && b.type !== 'revert' && reverted < b.movements.length ? html`<button class="btn btn--sm" type="button" data-revert="${b.id}">${icon('undo')} Reverter</button>` : ''}
          </summary>
          <div class="table-wrap mt-3"><table class="table"><thead><tr><th>Carta</th><th>Origem</th><th>Destino</th></tr></thead><tbody>
            ${b.movements.map((mv) => html`<tr style="${(b.revertedMovementIds || []).includes(mv.id) ? 'opacity:.55' : ''}"><td>${card(mv.cardKey)?.name || '—'} <span class="mono text-xs muted">${mv.copyId.slice(-6)}</span></td><td class="text-sm">${lname(mv.from)}</td><td class="text-sm">${lname(mv.to)}</td></tr>`)}
          </tbody></table></div></details>`;
  })}</div>` : html`<div class="state"><div class="state__icon">${icon('history')}</div><h3>Sem operações</h3><p>Cadastros, movimentações e remoções aparecerão aqui.</p></div>`}`);
    pane.querySelector('[data-type]').addEventListener('change', (e) => { st.type = e.target.value; paintHistory(); });
    pane.querySelectorAll('[data-revert]').forEach((btn) => btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const b = s.batches.find((x) => x.id === btn.dataset.revert);
      if (await revertFlow(b)) load();
    }));
  };

  await load();
  return on('data:changed', (scope) => { if (scope !== 'inventory') load(); });
}
