import { html, render, normalize, timeAgo } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { loadAll, plannedIn, ownedByCardId } from '../stores/state.js';
import { analyzeDeck } from '../features/domain.js';
import { cardArt, hydrateImages } from '../components/card.js';
import { pickCards } from '../components/card-picker.js';
import { addToCollectionFlow, pickSlot } from '../features/actions.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { navigate } from '../router.js';
import { on } from '../core/events.js';

const PRIO = { alta: ['Alta', 'badge--crimson'], normal: ['Normal', ''], baixa: ['Baixa', 'badge--info'] };

export default async function wishlist(ctx, main) {
  const db = data();
  const st = { q: '', prio: '', status: 'open' };
  let s;

  const load = async () => { s = await loadAll(['wishlist', 'copies', 'binders', 'decks']); paint(); };

  const paint = () => {
    const owned = ownedByCardId(s.copies);
    const items = s.wishlist.map((w) => {
      const c = card(w.cardKey);
      const have = owned.get(w.cardId) || 0;
      return { w, c, have, missing: Math.max(0, w.qty - have), planned: plannedIn(w.cardId, s.binders), decks: s.decks.filter((d) => d.cards.some((l) => l.cardId === w.cardId)) };
    });
    const shown = items.filter((i) => (!st.q || normalize(i.c?.name).includes(normalize(st.q))) && (!st.prio || i.w.priority === st.prio) && (st.status === 'all' || (st.status === 'open' ? i.missing > 0 : i.missing === 0)));
    const wishIds = new Set(s.wishlist.map((w) => w.cardId));
    const deckMissing = [];
    for (const d of s.decks) {
      for (const l of analyzeDeck(d, s.copies, card).lines) if (l.missing && !wishIds.has(l.cardId)) deckMissing.push({ deck: d, line: l });
    }
    render(main, html`<div class="page page--wide">
      <div class="page-head"><div><div class="page-head__eyebrow">Desejos</div><h1>Wishlist</h1><p>Cartas que você quer conseguir. Integrada a fichários (fantasmas) e decks. Itens desejados nunca contam como possuídos.</p></div>
        <button class="btn btn--primary" type="button" data-add>${icon('plus')} Adicionar carta</button></div>
      <div class="toolbar">
        <div class="input-group">${icon('search')}<input class="input" type="search" placeholder="Buscar na Wishlist" value="${st.q}" data-q aria-label="Buscar na Wishlist"></div>
        <select class="select" style="width:auto" data-prio aria-label="Prioridade"><option value="">Todas as prioridades</option>${Object.entries(PRIO).map(([k, [l]]) => html`<option value="${k}" ${st.prio === k ? 'selected' : ''}>${l}</option>`)}</select>
        <div class="segmented" role="group" aria-label="Situação">${[['open', 'Em aberto'], ['done', 'Conseguidas'], ['all', 'Todas']].map(([k, l]) => html`<button type="button" data-status="${k}" aria-pressed="${st.status === k}">${l}</button>`)}</div>
      </div>
      <div class="deck-layout deck-layout--narrow-aside">
        <section>
          ${shown.length ? html`<div class="card-list">${shown.map((i) => html`<div class="card-row" style="grid-template-columns:64px minmax(0,1fr) auto;align-items:start;padding:14px" data-id="${i.w.id}">
            <div style="width:64px">${cardArt(i.c)}</div>
            <div class="stack" style="gap:6px;min-width:0">
              <div><a class="card-row__name" href="#/carta/${encodeURIComponent(i.c?.id || i.w.cardId)}?lang=${i.c?.lang || 'en'}" style="color:inherit">${i.c?.name || i.w.cardId}</a> <span class="badge ${PRIO[i.w.priority]?.[1] || ''}">${PRIO[i.w.priority]?.[0] || i.w.priority}</span></div>
              <div class="card-row__meta"><span>${i.c?.set?.name || ''} ${i.c?.localId ? `#${i.c.localId}` : ''}</span><span>deseja ${i.w.qty} · possui ${i.have}</span>${i.missing ? html`<span style="color:var(--danger)">faltam ${i.missing}</span>` : html`<span style="color:var(--success)">${icon('check')} conseguida</span>`}<span>adicionada ${timeAgo(i.w.createdAt)}</span></div>
              ${i.w.note ? html`<p class="text-sm muted">“${i.w.note}”</p>` : ''}
              ${i.planned.length || i.decks.length ? html`<div class="chips">${i.planned.map((p) => html`<a class="chip" href="#/ficharios/${p.binder.id}?pagina=${p.page + 1}">${icon(p.kind === 'ghost' ? 'ghost' : 'eye')} ${p.binder.name} · p.${p.page + 1}</a>`)}${i.decks.map((d) => html`<a class="chip" href="#/decks/${d.id}">${icon('swords')} ${d.name}</a>`)}</div>` : html`<span class="text-xs subtle">Ainda não planejada em fichários ou decks.</span>`}
            </div>
            <div class="stack" style="gap:6px;align-items:flex-end">
              <button class="btn btn--sm btn--primary" type="button" data-got>${icon('check')} Adquiri</button>
              <button class="btn btn--sm" type="button" data-ghost>${icon('ghost')} Fantasma</button>
              <div class="row" style="gap:4px"><button class="icon-btn" type="button" data-edit aria-label="Editar">${icon('pencil')}</button><button class="icon-btn" type="button" data-rm aria-label="Remover">${icon('trash')}</button></div>
            </div></div>`)}</div>`
    : html`<div class="state"><div class="state__icon">${icon('heart')}</div><h3>${s.wishlist.length ? 'Nada com esses filtros' : 'Sua Wishlist está vazia'}</h3><p>Adicione cartas pelo catálogo, pela página da carta ou a partir das faltantes dos seus decks.</p></div>`}
        </section>
        <aside class="stack stack--lg">
          <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('swords')} Faltantes dos decks</h2><span class="badge">${deckMissing.length}</span></div>
            ${deckMissing.length ? html`<div class="stack" style="gap:8px">${deckMissing.slice(0, 12).map((x) => html`<div class="row" style="gap:10px;flex-wrap:nowrap"><div style="width:34px;flex:none">${cardArt(x.line.card)}</div><div class="grow"><div class="ellipsis text-sm" style="font-weight:700">${x.line.card?.name || x.line.cardId}</div><div class="text-xs muted">${x.deck.name} · faltam ${x.line.missing}</div></div><button class="btn btn--sm" type="button" data-dm="${x.deck.id}|${x.line.cardKey}">${icon('plus')}</button></div>`)}</div>`
    : html`<p class="text-sm muted">Nenhuma carta faltante fora da Wishlist.</p>`}
          </section>
        </aside>
      </div></div>`);
    hydrateImages(main);

    const $ = (q) => main.querySelector(q);
    $('[data-q]').addEventListener('input', (e) => { st.q = e.target.value; paintKeepFocus(); });
    $('[data-prio]').addEventListener('change', (e) => { st.prio = e.target.value; paint(); });
    main.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.status; paint(); }));
    $('[data-add]').addEventListener('click', async () => {
      const snaps = await pickCards({ title: 'Adicionar à Wishlist', multi: true, sources: ['catalog', 'samples'], confirmLabel: 'Adicionar' });
      if (!snaps?.length) return;
      for (const sn of snaps) await db.addWishlist({ cardKey: sn.key, cardId: sn.id, qty: 1 });
      changed('wishlist'); toast({ type: 'success', text: `${snaps.length} carta(s) na Wishlist.` }); load();
    });
    main.querySelectorAll('[data-dm]').forEach((b) => b.addEventListener('click', async () => {
      const [deckId, key] = b.dataset.dm.split('|');
      const x = deckMissing.find((d) => d.deck.id === deckId && d.line.cardKey === key);
      await db.addWishlist({ cardKey: key, cardId: x.line.cardId, qty: x.line.missing, note: `Para o deck “${x.deck.name}”` });
      changed('wishlist'); load();
    }));
    main.querySelectorAll('.card-row[data-id]').forEach((row) => {
      const it = items.find((i) => i.w.id === row.dataset.id);
      row.querySelector('[data-rm]').addEventListener('click', async () => { if (await confirmDialog({ title: 'Remover da Wishlist?', message: it.c?.name || '', confirmLabel: 'Remover' })) { await db.removeWishlist(it.w.id); changed('wishlist'); load(); } });
      row.querySelector('[data-edit]').addEventListener('click', () => editItem(it));
      row.querySelector('[data-ghost]').addEventListener('click', () => ghostFlow(it));
      row.querySelector('[data-got]').addEventListener('click', () => acquiredFlow(it));
    });
  };
  const paintKeepFocus = () => { paint(); const q = main.querySelector('[data-q]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); };

  const editItem = (it) => {
    const m = openModal({
      title: 'Editar desejo',
      body: html`<div class="form-grid"><label class="field"><span class="field__label">Quantidade desejada</span><input class="input" type="number" min="1" max="99" value="${it.w.qty}" data-q></label>
        <label class="field"><span class="field__label">Prioridade</span><select class="select" data-p>${Object.entries(PRIO).map(([k, [l]]) => html`<option value="${k}" ${it.w.priority === k ? 'selected' : ''}>${l}</option>`)}</select></label>
        <label class="field span-2"><span class="field__label">Observação</span><input class="input" maxlength="140" value="${it.w.note || ''}" data-n></label></div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>Salvar</button>`,
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', async () => {
      try { await db.updateWishlist(it.w.id, { qty: Number(m.body.querySelector('[data-q]').value), priority: m.body.querySelector('[data-p]').value, note: m.body.querySelector('[data-n]').value }); changed('wishlist'); m.close(); load(); } catch (e) { toastError(e); }
    });
  };

  const chooseBinder = (title) => new Promise((resolve) => {
    let r = null;
    const m = openModal({ title, body: s.binders.length ? html`<div class="stack">${s.binders.map((b) => html`<button class="mode-option" type="button" data-b="${b.id}" style="text-align:left;color:var(--text)">${icon('book')}<span><strong>${b.name}</strong><br><span class="text-xs muted">${b.type === 'physical' ? 'Físico' : 'Virtual'} · ${b.pages.length} páginas</span></span></button>`)}</div>` : html`<p class="muted">Você ainda não tem fichários.</p>`, onClose: () => resolve(r) });
    m.body.querySelectorAll('[data-b]').forEach((x) => x.addEventListener('click', () => { r = s.binders.find((b) => b.id === x.dataset.b); m.close(); }));
  });

  const ghostFlow = async (it) => {
    const b = await chooseBinder('Planejar como fantasma em…');
    if (!b) return;
    const pos = await pickSlot(b, { allowGhost: false, allowLocked: true, title: 'Bolso para a carta fantasma' });
    if (!pos) return;
    try {
      await db.binderOps(b.id, [{ op: 'set', ...pos, slot: { kind: 'ghost', cardKey: it.w.cardKey } }], { expectedVersion: b.version, label: 'Fantasma da Wishlist' });
      changed('binders'); toast({ type: 'success', text: `Fantasma criado em “${b.name}”.`, action: { label: 'Abrir', onClick: () => navigate(`/ficharios/${b.id}`) } }); load();
    } catch (e) { toastError(e); }
  };

  /** Após adquirir: cadastra as cópias e sugere preencher bolsos fantasmas — sem nunca converter fantasma em cópia automaticamente. */
  const acquiredFlow = async (it) => {
    const res = await addToCollectionFlow([it.c]);
    if (!res) return;
    await load();
    const ghosts = plannedIn(it.w.cardId, s.binders).filter((p) => p.kind === 'ghost' && p.binder.type === 'physical');
    const newCopies = res.copies || [];
    if (ghosts.length && newCopies.length) {
      const ok = await confirmDialog({
        title: 'Preencher bolso planejado?',
        message: html`<p class="muted">Esta carta estava planejada como fantasma em ${ghosts.length} bolso(s). Deseja colocar a cópia recém-cadastrada no primeiro deles?</p>`,
        details: html`<div class="locs">${ghosts.map((g) => html`<div class="loc-line">${icon('ghost')}${g.binder.name} · pág. ${g.page + 1}, bolso ${g.index + 1}</div>`)}</div>`,
        confirmLabel: 'Colocar no fichário', cancelLabel: 'Agora não',
      });
      if (ok) {
        const g = ghosts[0];
        try {
          await db.binderOps(g.binder.id, [{ op: 'place', pageId: g.pageId, index: g.index, copyId: newCopies[0].id }], { expectedVersion: g.binder.version, label: 'Carta adquirida no lugar do fantasma' });
          changed('binders'); toast({ type: 'success', text: `Colocada em “${g.binder.name}”.` });
        } catch (e) { toastError(e); }
      }
    }
    if (it.missing <= newCopies.length && await confirmDialog({ title: 'Remover da Wishlist?', message: 'Você já tem a quantidade desejada desta carta.', confirmLabel: 'Remover', cancelLabel: 'Manter' })) {
      await db.removeWishlist(it.w.id); changed('wishlist');
    }
    load();
  };

  await load();
  return on('data:changed', (sc) => { if (sc !== 'wishlist') load(); });
}
