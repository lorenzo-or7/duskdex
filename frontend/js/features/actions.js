// Fluxos de ação reutilizados por várias telas (catálogo, detalhe, coleção, wishlist, decks).
import { html, render, raw } from '../core/html.js';
import { icon } from '../core/icons.js';
import { openModal } from '../components/modal.js';
import { cardArt, hydrateImages, finishLabel } from '../components/card.js';
import { toast, toastError } from '../components/toast.js';
import { data, changed, card as cachedCard } from '../api/index.js';
import { availableVariants, LANG_LABELS, langLabel } from '../api/tcgdex.js';
import { navigate } from '../router.js';
import { pickCopy } from '../components/card-picker.js';
import { CONDITIONS } from './conditions.js';

/** <option>s com a árvore de locais (indentada). Exclui locais de sistema ocultos, fichários e decks por padrão. */
export function locationOptions(locations, selected, { allowBinders = false, allowDecks = false } = {}) {
  const children = (pid) => locations.filter((l) => (l.parentId || null) === pid && !l.hidden && (allowBinders || !l.binderId) && (allowDecks || !l.deckId)).sort((a, b) => (a.system ? -1 : 0) - (b.system ? -1 : 0) || a.name.localeCompare(b.name));
  const out = [];
  const walk = (pid, depth) => children(pid).forEach((l) => {
    out.push(html`<option value="${l.id}" ${l.id === selected ? 'selected' : ''}>${raw('&nbsp;&nbsp;'.repeat(depth))}${depth ? '└ ' : ''}${l.name}</option>`);
    walk(l.id, depth + 1);
  });
  walk(null, 0);
  return out;
}

const FINISHES = ['normal', 'reverse', 'holo', 'firstEdition'];

/** Cadastro rápido (uma ou várias cartas) com prévia e confirmação. */
export async function addToCollectionFlow(snaps, { defaultLocationId = null } = {}) {
  const db = data();
  const locations = await db.listLocations();
  const items = snaps.map((s) => {
    const avail = availableVariants(s);
    return { snap: s, qty: 1, lang: s.lang || 'en', finish: avail?.[0] || 'normal', condition: 'NM', avail };
  });
  return new Promise((resolve) => {
    let result = null;
    const m = openModal({
      title: snaps.length > 1 ? `Adicionar ${snaps.length} cartas à coleção` : 'Adicionar à coleção',
      size: snaps.length > 1 ? 'lg' : 'md',
      body: html`<div class="stack stack--lg">
        <div class="card-list" data-items></div>
        <label class="field"><span class="field__label">Onde as cartas vão ficar?</span>
          <select class="select" data-loc>${locationOptions(locations, defaultLocationId || db.inboxId)}</select>
          <span class="field__hint">Para colocar direto em um fichário físico, cadastre aqui e posicione no editor do fichário.</span></label>
        <div class="alert" data-preview></div>
      </div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>${icon('check')} Confirmar cadastro</button>`,
      onClose: () => resolve(result),
    });
    const box = m.body.querySelector('[data-items]');
    const paint = () => {
      render(box, html`${items.map((it, i) => html`<div class="card-row" style="grid-template-columns:52px minmax(0,1fr)">
        <div style="width:52px">${cardArt(it.snap)}</div>
        <div class="stack" style="gap:8px">
          <div><div class="card-row__name">${it.snap.name}</div><div class="card-row__meta"><span>${it.snap.set?.name || it.snap.setLabel || ''} ${it.snap.localId ? `#${it.snap.localId}` : ''}</span>${it.snap.partial ? html`<span class="badge badge--warning">dados parciais</span>` : ''}</div></div>
          <div class="row" style="gap:8px">
            <select class="select" style="width:auto;height:34px" data-finish="${i}" aria-label="Versão">${FINISHES.map((f) => html`<option value="${f}" ${it.finish === f ? 'selected' : ''} ${it.avail && !it.avail.includes(f) ? 'disabled' : ''}>${finishLabel(f)}${it.avail && !it.avail.includes(f) ? ' (não consta)' : ''}</option>`)}</select>
            <select class="select" style="width:auto;height:34px" data-cond="${i}" aria-label="Estado de conservação" title="Estado de conservação">${CONDITIONS.map((c) => html`<option value="${c.id}" ${it.condition === c.id ? 'selected' : ''}>${c.id} · ${c.label}</option>`)}</select>
            <select class="select" style="width:auto;height:34px" data-lang="${i}" aria-label="Idioma da carta física">${Object.keys(LANG_LABELS).map((c) => html`<option value="${c}" ${it.lang === c ? 'selected' : ''}>${langLabel(c)}</option>`)}</select>
            <div class="stepper stepper--sm"><button type="button" data-dec="${i}" aria-label="Diminuir">${icon('minus')}</button><input type="number" min="1" max="99" value="${it.qty}" data-qty="${i}" aria-label="Quantidade"><button type="button" data-inc="${i}" aria-label="Aumentar">${icon('plus')}</button></div>
          </div>
        </div></div>`)}`);
      hydrateImages(box);
      preview();
    };
    const preview = () => {
      const total = items.reduce((n, i) => n + i.qty, 0);
      const loc = locations.find((l) => l.id === m.body.querySelector('[data-loc]').value);
      render(m.body.querySelector('[data-preview]'), html`${icon('info')}<div><strong>Prévia:</strong> serão criadas <strong>${total}</strong> cópia(s) individual(is) em “${loc?.name || '—'}”. Cada unidade recebe um identificador próprio e entra no histórico como aquisição.</div>`);
    };
    box.addEventListener('click', (e) => {
      const dec = e.target.closest('[data-dec]'); const inc = e.target.closest('[data-inc]');
      if (dec) { const it = items[dec.dataset.dec]; it.qty = Math.max(1, it.qty - 1); paint(); }
      if (inc) { const it = items[inc.dataset.inc]; it.qty = Math.min(99, it.qty + 1); paint(); }
    });
    box.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.qty) { items[t.dataset.qty].qty = Math.max(1, Math.min(99, parseInt(t.value, 10) || 1)); paint(); }
      if (t.dataset.finish) items[t.dataset.finish].finish = t.value;
      if (t.dataset.cond) items[t.dataset.cond].condition = t.value;
      if (t.dataset.lang) items[t.dataset.lang].lang = t.value;
    });
    m.body.querySelector('[data-loc]').addEventListener('change', preview);
    m.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const res = await db.addCopies(items.map((it) => ({ cardKey: it.snap.key, cardId: it.snap.id, lang: it.lang, finish: it.finish, condition: it.condition, qty: it.qty, custom: it.snap.source === 'custom' })), { locationId: m.body.querySelector('[data-loc]').value });
        result = res;
        changed('collection');
        const n = items.reduce((a, i) => a + i.qty, 0);
        toast({ type: 'success', title: 'Salvo na coleção', text: `${n} cópia(s) cadastrada(s)${db.mode === 'demo' ? ' neste navegador' : ' no servidor'}.`, action: { label: 'Ver coleção', onClick: () => navigate('/colecao') } });
        m.close();
      } catch (err) { toastError(err); e.target.disabled = false; }
    });
    paint();
  });
}

export async function addToWishlist(snap, qty = 1) {
  try {
    await data().addWishlist({ cardKey: snap.key, cardId: snap.id, qty });
    changed('wishlist');
    toast({ type: 'success', title: 'Adicionada à Wishlist', text: snap.name, action: { label: 'Ver Wishlist', onClick: () => navigate('/wishlist') } });
  } catch (e) { toastError(e); }
}

/** Escolhe um bolso vazio (ou com fantasma) em um fichário. Retorna { pageId, index } ou null. */
export function pickSlot(binder, { allowGhost = true, allowLocked = false, title = 'Escolha o bolso' } = {}) {
  return new Promise((resolve) => {
    let result = null; let pi = binder.pages.findIndex((p) => p.slots.some((s) => s.kind === 'empty' && !s.locked));
    if (pi < 0) pi = 0;
    const m = openModal({ title, size: 'md', body: html`<div data-pick></div>`, onClose: () => resolve(result) });
    const paint = () => {
      const p = binder.pages[pi];
      render(m.body.querySelector('[data-pick]'), html`
        <div class="row row--between" style="margin-bottom:10px"><button class="btn btn--sm" type="button" data-prev ${pi === 0 ? 'disabled' : ''}>${icon('chevronLeft')}</button><strong>Página ${pi + 1} de ${binder.pages.length}</strong><button class="btn btn--sm" type="button" data-next ${pi >= binder.pages.length - 1 ? 'disabled' : ''}>${icon('chevronRight')}</button></div>
        <div class="sheet" style="--sheet-color:${binder.appearance.sheetColor}"><div class="sheet__grid" style="--cols:${p.cols}">
          ${p.slots.map((s, i) => {
    const ok = (s.kind === 'empty' || (allowGhost && s.kind === 'ghost')) && (allowLocked || !s.locked);
    return html`<button type="button" class="pocket ${s.kind === 'empty' ? 'pocket--empty' : 'pocket--filled'} ${s.kind === 'ghost' ? 'pocket--ghost' : ''} ${s.locked ? 'is-locked' : ''}" data-i="${i}" ${ok ? '' : 'disabled'} style="${ok ? 'cursor:pointer' : 'opacity:.35'}" aria-label="Bolso ${i + 1}${ok ? '' : ' (indisponível)'}">
              ${s.kind !== 'empty' && s.cardKey ? cardArt(cachedCard(s.cardKey)) : html`<span class="pocket__empty-num">${i + 1}</span>`}${s.locked ? html`<span class="pocket__lock">${icon('lock')}</span>` : ''}</button>`;
  })}
        </div></div><p class="text-xs muted mt-3">Bolsos desabilitados já têm conteúdo${allowLocked ? '' : ' ou estão bloqueados'}.</p>`);
      hydrateImages(m.body);
      m.body.querySelector('[data-prev]').onclick = () => { pi--; paint(); };
      m.body.querySelector('[data-next]').onclick = () => { pi++; paint(); };
      m.body.querySelectorAll('[data-i]:not([disabled])').forEach((b) => b.addEventListener('click', () => { result = { pageId: p.id, index: Number(b.dataset.i) }; m.close(); }));
    };
    paint();
  });
}

/** Adiciona uma carta a um fichário: fantasma, referência virtual ou cópia física. */
export async function addToBinderFlow(snap) {
  const db = data();
  const [binders, copies] = await Promise.all([db.listBinders(), db.listCopies()]);
  if (!binders.length) {
    toast({ type: 'info', title: 'Você ainda não tem fichários', text: 'Crie um fichário primeiro.', action: { label: 'Criar fichário', onClick: () => navigate('/ficharios?novo=1') } });
    return;
  }
  const mine = copies.filter((c) => c.cardId === snap.id && c.status !== 'removed' && !c.deckAssembled);
  const choice = await new Promise((resolve) => {
    let out = null;
    const m = openModal({
      title: 'Adicionar a um fichário',
      body: html`<div class="stack">
        <label class="field"><span class="field__label">Fichário</span><select class="select" data-b>${binders.map((b) => html`<option value="${b.id}">${b.name} · ${b.type === 'physical' ? 'físico' : 'virtual'}</option>`)}</select></label>
        <fieldset class="stack" style="border:0;padding:0;margin:0" data-kinds></fieldset>
      </div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>Escolher bolso</button>`,
      onClose: () => resolve(out),
    });
    const sel = m.body.querySelector('[data-b]');
    const paintKinds = () => {
      const b = binders.find((x) => x.id === sel.value);
      const opts = b.type === 'physical'
        ? [['copy', `Carta física da minha coleção (${mine.length} cópia(s) disponível(is))`, !mine.length], ['ghost', 'Carta fantasma (planejada, ainda não possuída)', false]]
        : [['virtual', 'Referência virtual (não consome cópias físicas)', false], ['ghost', 'Carta fantasma (desejada)', false]];
      render(m.body.querySelector('[data-kinds]'), html`<legend class="field__label" style="margin-bottom:6px">Como adicionar</legend>${opts.map(([v, l, dis], i) => html`<label class="mode-option"><input type="radio" name="kind" value="${v}" ${(!dis && (i === 0 || opts[0][2])) ? 'checked' : ''} ${dis ? 'disabled' : ''}><span>${l}</span></label>`)}`);
    };
    sel.addEventListener('change', paintKinds);
    paintKinds();
    m.foot.querySelector('[data-ok]').addEventListener('click', () => {
      const kind = m.body.querySelector('input[name="kind"]:checked')?.value;
      if (!kind) return;
      out = { binder: binders.find((x) => x.id === sel.value), kind };
      m.close();
    });
  });
  if (!choice) return;
  const pos = await pickSlot(choice.binder, { allowGhost: choice.kind === 'copy', allowLocked: choice.kind === 'ghost' });
  if (!pos) return;
  try {
    let op;
    if (choice.kind === 'copy') {
      const copy = mine.length === 1 ? mine[0] : await pickCopy({ title: `Qual cópia de ${snap.name}?`, binderId: choice.binder.id });
      if (!copy) return;
      if (copy.cardId !== snap.id) { toast({ type: 'warning', text: 'A cópia escolhida é de outra carta.' }); }
      op = { op: 'place', ...pos, copyId: copy.id };
    } else {
      op = { op: 'set', ...pos, slot: { kind: choice.kind, cardKey: snap.key } };
    }
    await db.binderOps(choice.binder.id, [op], { expectedVersion: choice.binder.version, label: 'Adição pelo catálogo' });
    changed('binders');
    toast({ type: 'success', title: 'Fichário atualizado', text: `${snap.name} em “${choice.binder.name}”.`, action: { label: 'Abrir', onClick: () => navigate(`/ficharios/${choice.binder.id}`) } });
  } catch (e) { toastError(e); }
}

/** Adiciona a carta a um deck existente ou novo. */
export async function addToDeckFlow(snap) {
  const db = data();
  const decks = await db.listDecks();
  const out = await new Promise((resolve) => {
    let r = null;
    const m = openModal({
      title: 'Adicionar a um deck',
      body: html`<div class="stack">
        <label class="field"><span class="field__label">Deck</span><select class="select" data-d>${decks.map((d) => html`<option value="${d.id}">${d.name}</option>`)}<option value="__new">+ Novo deck…</option></select></label>
        <label class="field" data-newname ${decks.length ? 'hidden' : ''}><span class="field__label">Nome do novo deck</span><input class="input" data-name maxlength="80" placeholder="Ex.: Darkrai Control"></label>
        <label class="field"><span class="field__label">Quantidade</span><input class="input" type="number" min="1" max="60" value="1" data-q></label>
      </div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>Adicionar</button>`,
      onClose: () => resolve(r),
    });
    const sel = m.body.querySelector('[data-d]');
    if (!decks.length) sel.value = '__new';
    sel.addEventListener('change', () => { m.body.querySelector('[data-newname]').hidden = sel.value !== '__new'; });
    m.foot.querySelector('[data-ok]').addEventListener('click', () => {
      r = { deckId: sel.value, name: m.body.querySelector('[data-name]').value.trim(), qty: Math.max(1, Math.min(60, parseInt(m.body.querySelector('[data-q]').value, 10) || 1)) };
      if (r.deckId === '__new' && !r.name) { m.body.querySelector('[data-name]').setAttribute('aria-invalid', 'true'); r = null; return; }
      m.close();
    });
  });
  if (!out) return;
  try {
    let deck = out.deckId === '__new' ? { name: out.name, format: 'standard', cards: [] } : await db.getDeck(out.deckId);
    const line = deck.cards.find((l) => l.cardKey === snap.key);
    if (line) line.qty = Math.min(60, line.qty + out.qty); else deck.cards.push({ cardKey: snap.key, cardId: snap.id, qty: out.qty });
    deck = await db.saveDeck(deck);
    changed('decks');
    toast({ type: 'success', title: 'Deck atualizado', text: `${out.qty}× ${snap.name} em “${deck.name}”.`, action: { label: 'Abrir deck', onClick: () => navigate(`/decks/${deck.id}`) } });
  } catch (e) { toastError(e); }
}
