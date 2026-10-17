import { html, render, raw, escape } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { prefs } from '../core/prefs.js';
import { binderStats, planAutoArrange, LAYOUTS, SLOT_KINDS } from '../features/domain.js';
import { cardArt, hydrateImages, zoomCard, assetObjectUrl, assetUrlCached, finishLabel } from '../components/card.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { openMenu } from '../components/menu.js';
import { toast, toastError } from '../components/toast.js';
import { pickCards, pickCopy } from '../components/card-picker.js';
import { locationOptions } from '../features/actions.js';
import { navigate, setQuery } from '../router.js';
import { binderForm } from './binders.js';
import { cardImageUrl } from '../api/tcgdex.js';
import { cropStyle, panoramaTileStyle } from '../features/image-tools.js';
import { chooseImageForSlot } from './library.js';
import { on } from '../core/events.js';

const isMobile = () => matchMedia('(max-width: 767px)').matches;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isLight = (hex) => {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
};
const refKey = (pageId, index) => `${pageId}:${index}`;

export default async function binderPage(ctx, main) {
  const db = data();
  let b = await db.getBinder(ctx.params.id);
  if (!b) {
    render(main, html`<div class="page"><div class="state state--error"><div class="state__icon">${icon('book')}</div><h3>Fichário não encontrado</h3><p>Ele pode ter sido excluído${db.mode === 'demo' ? ' ou os dados de exemplo foram reiniciados' : ''}.</p><a class="btn btn--primary" href="#/ficharios">Ver fichários</a></div></div>`);
    return;
  }
  const pref = prefs.get('binderView');
  const st = {
    view: pref === 'book' || pref === 'single' ? pref : (isMobile() ? 'single' : 'book'),
    page: Math.max(0, Math.min(b.pages.length - 1, (Number(ctx.query.pagina) || 1) - 1)),
    edit: ctx.query.editar === '1',
    multi: false,
    selected: new Set(),
    origin: null,
    undo: [],
    busy: false,
  };
  let copies = new Map(); let assets = new Map(); let wishIds = new Set();
  const loadAux = async () => {
    const [cps, ast, wl] = await Promise.all([db.listCopies(), db.listAssets(), db.listWishlist()]);
    copies = new Map(cps.map((c) => [c.id, c]));
    assets = new Map(ast.map((a) => [a.id, a]));
    wishIds = new Set(wl.map((w) => w.cardId));
  };
  await loadAux();

  const perSpread = () => (st.view === 'book' && !isMobile() ? 2 : 1);
  // "Primeira página à direita": no livro, o primeiro par é verso da capa (índice -1) + pág. 1.
  const off = () => (perSpread() === 2 && b.appearance.firstPageRight ? 1 : 0);
  const spreadStart = () => {
    if (perSpread() !== 2) return st.page;
    const v = st.page + off();
    return v - (v % 2) - off();
  };
  const minStart = () => -off();

  // ------------------------------------------------------------ render helpers
  const pocketHtml = (page, slot, i) => {
    const sk = refKey(page.id, i);
    const cd = slot.cardKey ? card(slot.cardKey) : null;
    const cls = ['pocket', slot.kind === 'empty' ? 'pocket--empty' : 'pocket--filled', `pocket--${slot.kind}`, slot.locked ? 'is-locked' : '', st.selected.has(sk) ? 'is-selected' : '', st.origin === sk ? 'is-origin' : ''].join(' ');
    let inner = '';
    let label = `Bolso ${i + 1}: ${SLOT_KINDS[slot.kind] || slot.kind}`;
    if (slot.kind === 'empty') inner = html`<span class="pocket__empty-num">${i + 1}</span>`;
    else if (slot.kind === 'image') {
      const a = assets.get(slot.assetId);
      const style = a ? (slot.panorama ? panoramaTileStyle(a, slot.panorama, slot.panorama.row, slot.panorama.col) : cropStyle(a, slot.crop)) : '';
      inner = html`<div class="pocket__image">${a ? (assetUrlCached(slot.assetId) ? html`<img alt="" src="${assetUrlCached(slot.assetId)}" decoding="sync" style="position:absolute;max-width:none;${raw(escape(style))}">` : html`<img alt="" data-asset-img="${slot.assetId}" style="position:absolute;max-width:none;${raw(escape(style))}">`) : html`<span class="pocket__empty-num">?</span>`}</div><span class="pocket__tag pocket__tag--image">${icon('image')}${slot.panorama ? 'Panorama' : 'Arte'}</span>`;
      label += a ? ` (${a.name})` : ' (imagem indisponível)';
    } else {
      inner = html`${cardArt(cd)}${slot.kind === 'ghost' ? html`<span class="pocket__tag pocket__tag--ghost">${icon('ghost')}${wishIds.has(cd?.id) ? 'Desejada' : 'Fantasma'}</span>` : ''}${slot.kind === 'virtual' ? html`<span class="pocket__tag pocket__tag--virtual">${icon('eye')}Ref.</span>` : ''}`;
      label += `: ${cd?.name || 'carta'}`;
      if (slot.kind === 'copy') { const cp = copies.get(slot.copyId); if (cp) label += ` (${cp.lang.toUpperCase()}, ${finishLabel(cp.finish)})`; }
    }
    return html`<div role="button" tabindex="0" class="${cls}" data-slot-style="${b.appearance.slotStyle || 'rounded'}" data-page="${page.id}" data-index="${i}" aria-label="${label}${slot.locked ? ' — bloqueado' : ''}" draggable="${st.edit && slot.kind !== 'empty' && !isMobile() ? 'true' : 'false'}">${inner}${slot.locked ? html`<span class="pocket__lock" aria-hidden="true">${icon('lock')}</span>` : ''}</div>`;
  };

  const sheetHtml = (pi) => {
    if (pi < 0) return html`<div class="sheet sheet--blank sheet--cover-inner" style="--sheet-color:${b.appearance.sheetColor}"><span>Verso da capa</span></div>`;
    const page = b.pages[pi];
    if (!page) return html`<div class="sheet sheet--blank" style="--sheet-color:${b.appearance.sheetColor}"><span>Contracapa</span></div>`;
    return html`<div class="sheet ${isLight(b.appearance.sheetColor) ? 'sheet--light' : ''}" style="--sheet-color:${b.appearance.sheetColor}" data-sheet="${pi}">
      <div class="sheet__label"><span>Pág. ${pi + 1}</span><span>${page.cols}×${page.rows}${page.rows !== b.layout.rows || page.cols !== b.layout.cols ? ' · especial' : ''}</span></div>
      <div class="sheet__grid" style="--cols:${page.cols}">${page.slots.map((s, i) => pocketHtml(page, s, i))}</div></div>`;
  };

  const stageHtml = () => {
    const start = spreadStart();
    if (perSpread() === 2) return html`<div class="book" data-book>${sheetHtml(start)}${sheetHtml(start + 1)}</div>`;
    return html`<div class="book book--single" data-book>${sheetHtml(start)}</div>`;
  };

  const pageLabel = () => {
    if (perSpread() !== 2) return `Pág. ${st.page + 1} de ${b.pages.length}`;
    const a = spreadStart();
    if (a < 0) return `Capa · pág. 1 de ${b.pages.length}`;
    const z = Math.min(a + 2, b.pages.length);
    return z === a + 1 ? `Pág. ${z} de ${b.pages.length}` : `Págs. ${a + 1}–${z} de ${b.pages.length}`;
  };

  const thumbs = () => html`<div class="page-thumbs" role="tablist" aria-label="Páginas">${b.pages.map((p, pi) => html`<button type="button" class="page-thumb" role="tab" style="--cols:${p.cols};--sheet-color:${b.appearance.sheetColor}" data-goto="${pi}" aria-current="${pi === st.page || (perSpread() === 2 && pi === spreadStart() + 1)}" aria-label="Ir para a página ${pi + 1}">
      ${p.slots.map((s) => raw(`<i class="${s.kind === 'copy' || s.kind === 'virtual' ? 'f' : s.kind === 'ghost' ? 'g' : s.kind === 'image' ? 'm' : ''}"></i>`))}<span class="page-thumb__n">${pi + 1}</span></button>`)}</div>`;

  // ------------------------------------------------------------ main render
  const paint = () => {
    const s = binderStats(b);
    render(main, html`<div class="page page--wide binder-shell ${st.edit ? 'is-editing' : 'view-only'} ${st.spectate ? 'is-spectator' : ''} ${st.spectateEnter ? 'spectate-enter' : ''}" style="--binder-color:${b.appearance.color};--sheet-color:${b.appearance.sheetColor}">
      <div class="row" style="margin-bottom:6px"><a class="btn btn--ghost btn--sm" href="#/ficharios">${icon('arrowLeft')} Fichários</a></div>
      <div class="page-head" style="margin-bottom:16px"><div>
          <div class="page-head__eyebrow">${b.type === 'physical' ? 'Fichário físico' : 'Fichário virtual'} · ${b.visibility === 'public' ? 'público' : b.visibility === 'unlisted' ? 'não listado' : 'privado'}</div>
          <h1>${b.name}</h1>
          ${b.description ? html`<p>${b.description}</p>` : ''}
          <div class="row text-sm muted" style="margin-top:8px;gap:14px"><span>${b.pages.length} páginas · ${s.slots} bolsos</span><span>${b.type === 'physical' ? `${s.copy} cartas físicas` : `${s.virtual} referências`}</span><span>${s.ghost} fantasma(s)</span><span>${s.image} arte(s)</span><span>${s.locked} bloqueado(s)</span></div>
        </div>
        <div class="btn-group">
          <button class="icon-btn" type="button" data-fav aria-pressed="${!!b.favorite}" aria-label="${b.favorite ? 'Remover dos favoritos' : 'Favoritar'}" title="Favorito">${icon('star')}</button>
          <button class="btn" type="button" data-spectate title="Ver o fichário em tela cheia, sem marcações">${icon('eye')} Espectador</button>
          <button class="btn" type="button" data-settings>${icon('palette')} Personalizar</button>
          <button class="btn" type="button" data-more aria-label="Mais ações">${icon('more')}</button>
          <button class="btn ${st.edit ? 'btn--crimson' : 'btn--primary'}" type="button" data-edit aria-pressed="${st.edit}">${st.edit ? html`${icon('check')} Concluir edição` : html`${icon('pencil')} Organizar`}</button>
        </div></div>

      <div class="binder-toolbar">
        <div class="segmented" role="group" aria-label="Modo de visualização"><button type="button" data-view="book" aria-pressed="${st.view === 'book'}">${icon('book')} Livro</button><button type="button" data-view="single" aria-pressed="${st.view === 'single'}">${icon('file')} Página única</button></div>
        <div class="page-nav"><button class="btn btn--icon btn--sm" type="button" data-prev aria-label="Página anterior" ${spreadStart() <= minStart() ? 'disabled' : ''}>${icon('chevronLeft')}</button><span class="page-nav__label" aria-live="polite">${pageLabel()}</span><button class="btn btn--icon btn--sm" type="button" data-next aria-label="Próxima página" ${spreadStart() + perSpread() >= b.pages.length ? 'disabled' : ''}>${icon('chevronRight')}</button></div>
        <span class="spacer"></span>
        ${st.edit ? html`<div class="btn-group">
          <button class="btn btn--sm" type="button" data-multi aria-pressed="${st.multi}">${icon('select')} ${st.multi ? 'Seleção ativa' : 'Selecionar vários'}</button>
          <button class="btn btn--sm" type="button" data-auto>${icon('wand')} Organizar automaticamente</button>
          <button class="btn btn--sm" type="button" data-pagetools>${icon('layout')} Página</button>
          <button class="btn btn--sm" type="button" data-pano ${db.capabilities.assets ? '' : 'disabled'} title="${db.capabilities.assets ? 'Montar arte panorâmica' : 'Indisponível neste modo'}">${icon('image')} Panorama</button>
          <button class="btn btn--sm" type="button" data-undo ${st.undo.length ? '' : 'disabled'} title="${st.undo.at(-1)?.label || 'Nada para desfazer'}">${icon('undo')} Desfazer</button>
        </div>` : ''}
      </div>

      ${st.edit ? html`<div class="alert" style="margin-bottom:6px">${icon('hand')}<div>${isMobile() ? html`Toque em um bolso para ver as ações. Para mover, escolha <strong>Mover / trocar</strong> e depois toque no destino.` : html`Arraste cartas entre bolsos para mover ou trocar. Clique em um bolso para mais ações; use <span class="kbd">Shift</span>+clique para selecionar vários.`}${b.type === 'physical' ? ' Mudanças de cartas físicas entram no histórico do inventário.' : ''}</div></div>` : ''}
      ${st.origin ? html`<div class="selection-bar">${icon('move')}<span>Escolha o bolso de destino (vazio = mover; ocupado = trocar).</span><span class="grow"></span><button class="btn btn--sm btn--ghost" type="button" data-cancel-origin>Cancelar</button></div>` : ''}
      ${st.selected.size ? html`<div class="selection-bar"><strong>${st.selected.size} bolso(s)</strong><span class="grow"></span>
          <button class="btn btn--sm" type="button" data-batch="lock">${icon('lock')} Bloquear</button>
          <button class="btn btn--sm" type="button" data-batch="unlock">${icon('unlock')} Desbloquear</button>
          <button class="btn btn--sm btn--danger" type="button" data-batch="clear">${icon('trash')} Esvaziar</button>
          <button class="btn btn--sm btn--ghost" type="button" data-batch="none">Limpar seleção</button></div>` : ''}

      <div class="binder-side">
        <div>
          <div class="binder-stage" data-stage>${stageHtml()}${st.spectate ? html`
            <div class="spectate-ui">
              <button class="spectate-ui__close" type="button" data-spectate-exit aria-label="Sair do modo espectador">${icon('x')}</button>
              <button class="spectate-ui__nav spectate-ui__nav--prev" type="button" data-prev aria-label="Página anterior" ${spreadStart() <= minStart() ? 'disabled' : ''}>${icon('chevronLeft')}</button>
              <button class="spectate-ui__nav spectate-ui__nav--next" type="button" data-next aria-label="Próxima página" ${spreadStart() + perSpread() >= b.pages.length ? 'disabled' : ''}>${icon('chevronRight')}</button>
              <div class="spectate-ui__label"><strong>${b.name}</strong><span>${pageLabel()}</span></div>
            </div>` : ''}</div>
          ${thumbs()}
        </div>
        <aside class="editor-panel">
          <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('target')} Progresso</h2><span class="badge badge--primary">${s.progress}%</span></div>
            <div class="progress"><div class="progress__bar" style="width:${s.progress}%"></div></div>
            <p class="text-xs muted mt-2">${b.type === 'physical' ? 'Bolsos com carta física real ÷ total de bolsos. Fantasmas e imagens não contam como possuídas.' : 'Bolsos planejados (referências, artes) ÷ total de bolsos.'}</p></section>
          <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('info')} Legenda</h2></div>
            <div class="legend">
              <span><i style="background:var(--primary)"></i>${b.type === 'physical' ? 'Carta física (cópia da coleção)' : 'Referência virtual'}</span>
              <span><i style="border:1.5px dashed #D8BDE5"></i>Carta fantasma — planejada, não possuída</span>
              <span><i style="background:#e9b872"></i>Imagem personalizada / panorama</span>
              <span><i style="box-shadow:0 0 0 1.5px var(--crimson)"></i>Bolso bloqueado (aceita só fantasma)</span>
            </div></section>
          ${b.type === 'physical' && b.locationId ? html`<section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('package')} Inventário</h2></div><p class="text-sm muted">Este fichário é um local do inventário. Cada cópia ocupa um único bolso — colocá-la aqui a retira automaticamente de onde estava.</p><a class="btn btn--sm mt-3" href="#/inventario?local=${b.locationId}">Ver no inventário</a></section>` : ''}
        </aside>
      </div>
    </div>`);
    hydrateImages(main);
    hydrateAssets(main);
    bind();
  };

  const hydrateAssets = (root) => {
    root.querySelectorAll('img[data-asset-img]').forEach(async (img) => {
      const url = await assetObjectUrl(img.dataset.assetImg);
      if (url) img.src = url;
    });
  };

  // ------------------------------------------------------------ navegação / virada
  const go = (dir) => {
    const ps = perSpread();
    const start = spreadStart();
    const target = start + dir * ps;
    if (target < minStart() || target >= b.pages.length) return;
    if (st.view === 'book' && !reduced() && !st.busy) {
      flip(dir, start, target);
    } else {
      st.page = Math.max(0, target); setQuery({ pagina: st.page + 1, keepScroll: '' }); paint();
    }
  };

  const flip = (dir, start, target) => {
    const stage = main.querySelector('[data-stage]');
    const book = stage.querySelector('[data-book]');
    st.busy = true;
    const leaf = document.createElement('div');
    if (perSpread() === 2) {
      leaf.className = `leaf ${dir < 0 ? 'leaf--back' : ''}`;
      const front = dir > 0 ? sheetHtml(start + 1) : sheetHtml(start);
      const back = dir > 0 ? sheetHtml(target) : sheetHtml(target + 1);
      render(leaf, html`<div class="leaf__face">${front}</div><div class="leaf__face leaf__face--back">${back}</div>`);
      // base: lado que fica visível embaixo da folha
      const sheets = book.querySelectorAll(':scope > .sheet');
      if (dir > 0) sheets[1].outerHTML = String(sheetHtml(target + 1));
      else sheets[0].outerHTML = String(sheetHtml(target));
    } else {
      leaf.className = 'leaf'; leaf.style.left = '10px'; leaf.style.width = 'calc(100% - 20px)';
      leaf.style.top = '10px'; leaf.style.bottom = '10px';
      render(leaf, html`<div class="leaf__face">${sheetHtml(start)}</div><div class="leaf__face leaf__face--back">${sheetHtml(target)}</div>`);
      book.querySelector('.sheet').outerHTML = String(sheetHtml(target));
    }
    book.appendChild(leaf);
    hydrateImages(book); hydrateAssets(book);
    requestAnimationFrame(() => leaf.classList.add(dir > 0 ? 'is-turning-next' : 'is-turning-prev'));
    const token = (st.flipToken = (st.flipToken || 0) + 1);
    let finished = false;
    const done = () => {
      if (finished || token !== st.flipToken) return;
      finished = true; st.busy = false; st.page = Math.max(0, target); setQuery({ pagina: st.page + 1 }); paint();
    };
    leaf.addEventListener('animationend', done, { once: true });
    setTimeout(done, 1200);
  };

  // ------------------------------------------------------------ operações
  const apply = async (ops, { label = 'Edição', undoOps = null, quiet = false } = {}) => {
    try {
      const res = await db.binderOps(b.id, ops, { expectedVersion: b.version, label });
      b = res.binder;
      if (res.batch) st.undo.push({ label, batchId: res.batch.id });
      else if (undoOps) st.undo.push({ label, ops: undoOps });
      if (st.undo.length > 30) st.undo.shift();
      if (res.batch || ops.some((o) => o.op === 'place' || o.op === 'unplace')) await loadAux();
      changed('binders');
      if (!quiet) toast({ type: 'success', text: `${label} — salvo${db.mode === 'demo' ? ' localmente' : ''}.`, timeout: 2200 });
      paint();
      return true;
    } catch (e) {
      if (e.code === 'CONFLICT') {
        toast({ type: 'warning', title: 'Conflito entre abas/dispositivos', text: 'O fichário foi alterado em outro lugar. Recarregamos a versão mais recente; refaça a alteração.' });
        b = await db.getBinder(b.id); await loadAux(); paint();
      } else toastError(e);
      return false;
    }
  };

  const undo = async () => {
    const last = st.undo.pop();
    if (!last) return;
    try {
      if (last.batchId) {
        if (!db.capabilities.revert) { toast({ type: 'info', text: 'Desfazer movimentações físicas não está disponível neste modo.' }); return; }
        const pv = await db.previewRevert(last.batchId);
        const okIds = pv.items.filter((i) => !i.conflicts.length).map((i) => i.movement.id);
        if (!okIds.length) { toast({ type: 'warning', title: 'Não foi possível desfazer', text: pv.items[0]?.conflicts[0] || 'Conflito com alterações posteriores.' }); return; }
        await db.revertBatch(last.batchId, okIds);
        b = await db.getBinder(b.id); await loadAux(); changed('binders');
        toast({ type: 'success', text: `Desfeito: ${last.label}` });
        paint();
      } else {
        await apply(last.ops, { label: `Desfazer ${last.label.toLowerCase()}`, quiet: true });
        st.undo.pop(); // a própria reversão não entra na pilha
        paint();
      }
    } catch (e) { toastError(e); }
  };

  const slotAt = (pageId, index) => b.pages.find((p) => p.id === pageId)?.slots[index];
  const snapshotSlot = (pageId, index) => { const s = slotAt(pageId, index); return { ...s }; };

  const setSlot = (pageId, index, slot, label) => {
    const prev = snapshotSlot(pageId, index);
    const undoOps = prev.kind === 'copy' ? null : [{ op: 'set', pageId, index, slot: prev.kind === 'empty' ? { kind: 'empty' } : prev }];
    return apply([{ op: 'set', pageId, index, slot }], { label, undoOps });
  };

  const moveOrSwap = (from, to) => {
    if (from.pageId === to.pageId && from.index === to.index) return null;
    const dest = slotAt(to.pageId, to.index);
    const op = dest.kind === 'empty' ? 'move' : 'swap';
    return apply([{ op, a: from, b: to }], { label: op === 'move' ? 'Carta movida' : 'Cartas trocadas', undoOps: [{ op: 'swap', a: from, b: to }] });
  };

  const unplaceFlow = async (pageId, index) => {
    const locations = await db.listLocations();
    const cd = card(slotAt(pageId, index).cardKey);
    const res = await new Promise((resolve) => {
      let r = null;
      const m = openModal({
        title: 'Retirar carta física',
        body: html`<div class="stack"><p class="muted">Para onde <strong>${cd?.name || 'a carta'}</strong> vai fisicamente?</p>
          <select class="select" data-dest>${locationOptions(locations, db.inboxId)}</select>
          <label class="checkbox"><input type="checkbox" data-ghost checked> Deixar uma carta fantasma no bolso (lembrete do planejamento)</label></div>`,
        footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>Confirmar retirada</button>`,
        onClose: () => resolve(r),
      });
      m.foot.querySelector('[data-ok]').addEventListener('click', () => { r = { to: m.body.querySelector('[data-dest]').value, ghost: m.body.querySelector('[data-ghost]').checked }; m.close(); });
    });
    if (res) apply([{ op: 'unplace', pageId, index, toLocationId: res.to, leaveGhost: res.ghost }], { label: 'Carta retirada do fichário' });
  };

  const placeCopy = async (pageId, index) => {
    const copy = await pickCopy({ title: 'Colocar carta física', binderId: b.id });
    if (!copy) return;
    if (copy.slot && copy.slot.binderId !== b.id) {
      const ok = await confirmDialog({ title: 'Mover de outro fichário?', message: 'Esta cópia está em outro fichário físico. Ela será retirada de lá (o bolso de origem fica vazio) e colocada aqui, na mesma operação.', confirmLabel: 'Mover para cá' });
      if (!ok) return;
    }
    apply([{ op: 'place', pageId, index, copyId: copy.id }], { label: 'Carta física posicionada' });
  };

  /** Bolsos que recebem várias cartas em sequência: o clicado e, depois, os próximos vazios em ordem de leitura. */
  const slotsFrom = (pageId, index, kind, count) => {
    const out = [{ pageId, index }];
    let pi = b.pages.findIndex((p) => p.id === pageId);
    let si = index + 1;
    for (; pi < b.pages.length && out.length < count; pi++, si = 0) {
      const page = b.pages[pi];
      for (; si < page.slots.length && out.length < count; si++) {
        const s = page.slots[si];
        if (s.kind === 'empty' && (kind === 'ghost' || !s.locked)) out.push({ pageId: page.id, index: si });
      }
    }
    return out;
  };

  const pickCardFor = async (pageId, index, kind) => {
    const sources = kind === 'ghost' ? ['catalog', 'samples', 'collection'] : ['catalog', 'collection', 'samples', 'custom'];
    const snaps = await pickCards({ title: kind === 'ghost' ? 'Cartas fantasmas (planejadas)' : 'Referências virtuais', sources, multi: true, confirmLabel: 'Colocar nos bolsos' });
    if (!snaps?.length) return;
    const targets = slotsFrom(pageId, index, kind, snaps.length);
    const ops = targets.map((t, i) => ({ op: 'set', pageId: t.pageId, index: t.index, slot: { kind, cardKey: snaps[i].key } }));
    const undoOps = targets.map((t) => {
      const prev = snapshotSlot(t.pageId, t.index);
      return { op: 'set', pageId: t.pageId, index: t.index, slot: prev.kind === 'empty' || prev.kind === 'copy' ? { kind: 'empty' } : prev };
    });
    const what = kind === 'ghost' ? 'carta(s) fantasma(s)' : 'referência(s)';
    await apply(ops, { label: targets.length > 1 ? `${targets.length} ${what} adicionada(s) em ordem` : kind === 'ghost' ? 'Carta fantasma adicionada' : 'Referência adicionada', undoOps });
    const left = snaps.length - targets.length;
    if (left > 0) toast({ type: 'warning', title: `${left} carta(s) não couberam`, text: 'Não há mais bolsos vazios a partir daqui. Adicione páginas e selecione as restantes.' });
  };

  const imageFor = async (pageId, index) => {
    const res = await chooseImageForSlot(slotAt(pageId, index));
    if (res) { await loadAux(); setSlot(pageId, index, { kind: 'image', assetId: res.assetId, crop: res.crop }, 'Imagem aplicada'); }
  };

  /**
   * Substituir o conteúdo de um bolso em um passo só: escolhe o novo conteúdo e aplica
   * "esvaziar + colocar" na MESMA operação atômica (se algo falhar, nada muda).
   * Carta física retirada precisa de destino real no inventário.
   */
  const replaceFlow = async (pageId, index) => {
    const s = slotAt(pageId, index);
    const physical = b.type === 'physical';
    const opts = [
      physical && { id: 'copy', icon: 'layers', label: 'Carta física da coleção', hint: 'Uma cópia que você possui', disabled: s.locked },
      !physical && { id: 'virtual', icon: 'eye', label: 'Referência virtual', hint: 'Qualquer carta do catálogo', disabled: s.locked },
      { id: 'ghost', icon: 'ghost', label: 'Carta fantasma', hint: 'Planejada, ainda não possuída' },
      { id: 'image', icon: 'image', label: 'Imagem própria', hint: db.capabilities.assets ? 'Da biblioteca ou enviada agora' : 'Indisponível neste modo', disabled: s.locked || !db.capabilities.assets },
    ].filter(Boolean);
    const locations = s.kind === 'copy' ? await db.listLocations() : null;
    const cd = s.cardKey ? card(s.cardKey) : null;
    const choice = await new Promise((resolve) => {
      let r = null;
      const m = openModal({
        title: 'Substituir conteúdo do bolso',
        body: html`<div class="stack">
          <p class="muted text-sm">Bolso ${index + 1} · atual: <strong>${cd?.name || SLOT_KINDS[s.kind]}</strong>. Escolha o que entra no lugar.</p>
          <div class="replace-opts">${opts.map((o) => html`<button class="replace-opt" type="button" data-opt="${o.id}" ${o.disabled ? 'disabled' : ''}>${icon(o.icon)}<span><strong>${o.label}</strong><small>${o.disabled && s.locked ? 'Bolso bloqueado: só aceita fantasma' : o.hint}</small></span></button>`)}</div>
          ${locations ? html`<label class="field"><span class="field__label">Para onde vai a carta física que sai?</span><select class="select" data-dest>${locationOptions(locations, db.inboxId)}</select><span class="field__hint">A retirada entra no histórico do inventário e pode ser desfeita.</span></label>` : ''}
        </div>`,
        footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button>`,
        onClose: () => resolve(r),
      });
      m.body.querySelectorAll('[data-opt]').forEach((o) => o.addEventListener('click', () => {
        r = { kind: o.dataset.opt, to: m.body.querySelector('[data-dest]')?.value || null }; m.close();
      }));
    });
    if (!choice) return;

    let put = null; let what = '';
    if (choice.kind === 'copy') {
      const copy = await pickCopy({ title: 'Substituir por carta física', binderId: b.id });
      if (!copy) return;
      if (copy.slot && copy.slot.binderId === b.id && copy.slot.pageId === pageId && copy.slot.index === index) return;
      put = { op: 'place', pageId, index, copyId: copy.id }; what = 'carta física';
    } else if (choice.kind === 'image') {
      const res = await chooseImageForSlot({ kind: 'empty' });
      if (!res) return;
      await loadAux();
      put = { op: 'set', pageId, index, slot: { kind: 'image', assetId: res.assetId, crop: res.crop } }; what = 'imagem';
    } else {
      const snaps = await pickCards({ title: choice.kind === 'ghost' ? 'Substituir por carta fantasma' : 'Substituir por referência', sources: choice.kind === 'ghost' ? ['catalog', 'samples', 'collection'] : ['catalog', 'collection', 'samples', 'custom'], confirmLabel: 'Substituir' });
      if (!snaps?.length) return;
      put = { op: 'set', pageId, index, slot: { kind: choice.kind, cardKey: snaps[0].key } }; what = choice.kind === 'ghost' ? 'carta fantasma' : 'referência';
    }
    const clear = s.kind === 'copy'
      ? { op: 'unplace', pageId, index, toLocationId: choice.to, leaveGhost: false }
      : { op: 'set', pageId, index, slot: { kind: 'empty' } };
    // Sem carta física envolvida, desfazer = restaurar o bolso como estava.
    const undoOps = s.kind === 'copy' || put.op === 'place' ? null : [{ op: 'set', pageId, index, slot: { ...s } }];
    await apply([clear, put], { label: `Bolso substituído por ${what}`, undoOps });
  };

  const slotMenu = (btn) => {
    const pageId = btn.dataset.page; const index = Number(btn.dataset.index);
    const s = slotAt(pageId, index);
    const cd = s.cardKey ? card(s.cardKey) : null;
    const items = [];
    items.push({ heading: true, label: `Bolso ${index + 1} · ${SLOT_KINDS[s.kind]}${s.locked ? ' · bloqueado' : ''}` });
    if (s.kind === 'empty' || s.kind === 'ghost') {
      if (b.type === 'physical') items.push({ label: s.kind === 'ghost' ? 'Colocar a carta física (adquirida)' : 'Colocar carta física', icon: 'layers', onClick: () => placeCopy(pageId, index), disabled: s.locked, hint: s.locked ? 'Desbloqueie o bolso primeiro' : '' });
      if (b.type === 'virtual' && s.kind === 'empty') items.push({ label: 'Referência virtual', icon: 'eye', onClick: () => pickCardFor(pageId, index, 'virtual'), disabled: s.locked });
      items.push({ label: s.kind === 'ghost' ? 'Trocar carta fantasma' : 'Carta fantasma', icon: 'ghost', onClick: () => pickCardFor(pageId, index, 'ghost') });
      if (s.kind === 'empty') items.push({ label: 'Imagem própria', icon: 'image', onClick: () => imageFor(pageId, index), disabled: s.locked || !db.capabilities.assets, hint: !db.capabilities.assets ? 'Indisponível neste modo' : '' });
    }
    if (s.kind !== 'empty') {
      if (cd) items.push({ label: 'Ampliar carta', icon: 'zoom', onClick: () => zoomCard(cd, cd.source === 'custom' ? null : cardImageUrl(cd.image, 'high')) });
      if (cd && cd.source !== 'custom') items.push({ label: 'Página da carta', icon: 'info', onClick: () => navigate(`/carta/${encodeURIComponent(cd.id)}?lang=${cd.lang}`) });
      items.push({ label: 'Substituir…', icon: 'swap', onClick: () => replaceFlow(pageId, index) });
      items.push({ label: 'Mover / trocar de lugar', icon: 'move', onClick: () => { st.origin = refKey(pageId, index); paint(); } });
      if (s.kind === 'image' && !s.panorama) items.push({ label: 'Ajustar recorte', icon: 'crop', onClick: async () => { const r = await chooseImageForSlot(s, { assetId: s.assetId }); if (r) setSlot(pageId, index, { kind: 'image', assetId: r.assetId, crop: r.crop }, 'Recorte ajustado'); } });
      items.push({ separator: true });
      if (s.kind === 'copy') items.push({ label: 'Retirar carta física…', icon: 'logout', onClick: () => unplaceFlow(pageId, index) });
      else items.push({ label: s.panorama ? 'Remover este recorte' : 'Esvaziar bolso', icon: 'trash', danger: true, onClick: () => setSlot(pageId, index, { kind: 'empty' }, 'Bolso esvaziado') });
    }
    if (s.kind === 'empty' || s.kind === 'ghost') items.push({ label: s.locked ? 'Desbloquear bolso' : 'Bloquear / reservar bolso', icon: s.locked ? 'unlock' : 'lock', onClick: () => apply([{ op: 'lock', pageId, index, locked: !s.locked }], { label: s.locked ? 'Bolso desbloqueado' : 'Bolso bloqueado', undoOps: [{ op: 'lock', pageId, index, locked: s.locked }] }) });
    openMenu(btn, items);
  };

  // ------------------------------------------------------------ eventos
  const bind = () => {
    const $ = (q) => main.querySelector(q);
    $('[data-spectate]')?.addEventListener('click', () => setSpectate(true));
    main.querySelector('[data-spectate-exit]')?.addEventListener('click', () => setSpectate(false));
    main.querySelectorAll('.spectate-ui [data-prev]').forEach((b2) => b2.addEventListener('click', () => go(-1)));
    main.querySelectorAll('.spectate-ui [data-next]').forEach((b2) => b2.addEventListener('click', () => go(1)));
    $('[data-edit]').addEventListener('click', () => { st.edit = !st.edit; st.selected.clear(); st.origin = null; st.multi = false; if (st.edit && isMobile()) st.view = 'single'; setQuery({ editar: st.edit ? '1' : '' }); paint(); });
    main.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => { st.view = btn.dataset.view; prefs.set('binderView', st.view); paint(); }));
    $('[data-prev]').addEventListener('click', () => go(-1));
    $('[data-next]').addEventListener('click', () => go(1));
    main.querySelectorAll('[data-goto]').forEach((t) => t.addEventListener('click', () => { st.page = Number(t.dataset.goto); setQuery({ pagina: st.page + 1 }); paint(); }));
    $('[data-fav]').addEventListener('click', async () => { try { b = await db.updateBinderMeta(b.id, { favorite: !b.favorite }, b.version); changed('binders'); paint(); } catch (e) { toastError(e); } });
    $('[data-settings]').addEventListener('click', async () => { const nb = await binderForm(b); if (nb) { b = nb; paint(); } });
    $('[data-more]').addEventListener('click', (e) => openMenu(e.currentTarget, [
      { label: 'Usar como inspiração (cópia virtual)', icon: 'copy', onClick: duplicate },
      { label: 'Biblioteca de imagens', icon: 'image', onClick: () => navigate('/imagens') },
      { separator: true },
      { label: 'Excluir fichário…', icon: 'trash', danger: true, onClick: removeBinder },
    ]));
    $('[data-cancel-origin]')?.addEventListener('click', () => { st.origin = null; paint(); });
    $('[data-multi]')?.addEventListener('click', () => { st.multi = !st.multi; if (!st.multi) st.selected.clear(); paint(); });
    $('[data-undo]')?.addEventListener('click', undo);
    $('[data-auto]')?.addEventListener('click', autoArrange);
    $('[data-pagetools]')?.addEventListener('click', (e) => pageTools(e.currentTarget));
    $('[data-pano]')?.addEventListener('click', () => navigate(`/ficharios/${b.id}/panorama?pagina=${st.page + 1}`));
    main.querySelectorAll('[data-batch]').forEach((btn) => btn.addEventListener('click', () => batchAction(btn.dataset.batch)));

    const stage = $('[data-stage]');
    stage.addEventListener('click', (e) => {
      const pk = e.target.closest('.pocket');
      if (!pk || st.busy) return;
      const pageId = pk.dataset.page; const index = Number(pk.dataset.index);
      const s = slotAt(pageId, index);
      if (!st.edit) {
        if (s.kind !== 'empty' && s.kind !== 'image') { const cd = card(s.cardKey); zoomCard(cd, cd?.source === 'custom' ? null : cardImageUrl(cd?.image, 'high')); }
        return;
      }
      if (st.origin) {
        const [opg, oi] = st.origin.split(':'); st.origin = null;
        moveOrSwap({ pageId: opg, index: Number(oi) }, { pageId, index }) || paint();
        return;
      }
      if (st.multi || e.shiftKey || e.ctrlKey || e.metaKey) {
        const k = refKey(pageId, index);
        if (st.selected.has(k)) st.selected.delete(k); else st.selected.add(k);
        paint();
        return;
      }
      slotMenu(pk);
    });

    stage.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('pocket')) { e.preventDefault(); e.target.click(); }
    });
    stage.querySelectorAll('img').forEach((img) => { img.draggable = false; });

    // Arrastar e soltar (desktop)
    let dragFrom = null;
    stage.addEventListener('dragstart', (e) => {
      const pk = e.target.closest('.pocket'); if (!pk || !st.edit) return;
      dragFrom = { pageId: pk.dataset.page, index: Number(pk.dataset.index) };
      pk.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', refKey(dragFrom.pageId, dragFrom.index));
    });
    stage.addEventListener('dragend', (e) => { e.target.closest?.('.pocket')?.classList.remove('is-dragging'); stage.querySelectorAll('.is-drop').forEach((x) => x.classList.remove('is-drop')); });
    stage.addEventListener('dragover', (e) => { const pk = e.target.closest('.pocket'); if (pk && dragFrom) { e.preventDefault(); stage.querySelectorAll('.is-drop').forEach((x) => x !== pk && x.classList.remove('is-drop')); pk.classList.add('is-drop'); } });
    stage.addEventListener('dragleave', (e) => { e.target.closest?.('.pocket')?.classList.remove('is-drop'); });
    stage.addEventListener('drop', (e) => {
      const pk = e.target.closest('.pocket'); if (!pk || !dragFrom) return;
      e.preventDefault();
      const to = { pageId: pk.dataset.page, index: Number(pk.dataset.index) };
      const from = dragFrom; dragFrom = null;
      moveOrSwap(from, to);
    });

    // Gesto de deslizar (toque) para virar página
    let tx0 = null; let ty0 = null;
    stage.addEventListener('touchstart', (e) => { if (st.edit) return; tx0 = e.touches[0].clientX; ty0 = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (tx0 == null) return;
      const dx = e.changedTouches[0].clientX - tx0; const dy = e.changedTouches[0].clientY - ty0;
      tx0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    });
  };

  const onKey = (e) => {
    if (e.target.closest('input,textarea,select,.modal-root')) return;
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'Escape' && st.spectate) { setSpectate(false); return; }
    if (e.key === 'Escape' && (st.origin || st.selected.size)) { st.origin = null; st.selected.clear(); paint(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && st.edit) { e.preventDefault(); undo(); }
  };
  document.addEventListener('keydown', onKey);

  // Modo espectador: fichário em tela cheia, sem marcações de edição.
  const setSpectate = (on) => {
    st.spectate = on;
    if (on) { st.edit = false; st.selected.clear(); st.origin = null; }
    document.documentElement.classList.toggle('dd-noscroll', on);
    st.spectateEnter = on; // a entrada anima uma vez; virar páginas depois não repete o fade
    paint();
    st.spectateEnter = false;
    if (on) main.querySelector('[data-spectate-exit]')?.focus({ preventScroll: true });
    else main.querySelector('[data-spectate]')?.focus({ preventScroll: true });
  };

  // ------------------------------------------------------------ ações em lote (com prévia)
  const batchAction = async (kind) => {
    if (kind === 'none') { st.selected.clear(); paint(); return; }
    const refs = [...st.selected].map((k) => { const [pageId, i] = k.split(':'); return { pageId, index: Number(i) }; });
    if (kind === 'lock' || kind === 'unlock') {
      const ok = refs.filter((r) => { const s = slotAt(r.pageId, r.index); return kind === 'unlock' ? s.locked : !s.locked && (s.kind === 'empty' || s.kind === 'ghost'); });
      if (!ok.length) { toast({ type: 'info', text: kind === 'lock' ? 'Só bolsos vazios ou com fantasma podem ser bloqueados.' : 'Nenhum bolso selecionado está bloqueado.' }); return; }
      st.selected.clear();
      await apply(ok.map((r) => ({ op: 'lock', ...r, locked: kind === 'lock' })), { label: `${ok.length} bolso(s) ${kind === 'lock' ? 'bloqueado(s)' : 'desbloqueado(s)'}`, undoOps: ok.map((r) => ({ op: 'lock', ...r, locked: kind !== 'lock' })) });
      return;
    }
    // esvaziar
    const items = refs.map((r) => ({ ...r, slot: slotAt(r.pageId, r.index) })).filter((x) => x.slot.kind !== 'empty');
    if (!items.length) { toast({ type: 'info', text: 'Os bolsos selecionados já estão vazios.' }); return; }
    const physical = items.filter((x) => x.slot.kind === 'copy');
    const locations = physical.length ? await db.listLocations() : [];
    const res = await new Promise((resolve) => {
      let r = null;
      const m = openModal({
        title: `Esvaziar ${items.length} bolso(s)`, size: 'lg',
        body: html`<div class="stack"><p class="muted">Prévia das alterações:</p>
          <div class="table-wrap"><table class="table"><thead><tr><th>Bolso</th><th>Conteúdo</th><th>Resultado</th></tr></thead><tbody>
          ${items.map((x) => html`<tr><td>Pág. ${b.pages.findIndex((p) => p.id === x.pageId) + 1} · ${x.index + 1}</td><td>${SLOT_KINDS[x.slot.kind]}${x.slot.cardKey ? ` · ${card(x.slot.cardKey)?.name || ''}` : ''}</td><td>${x.slot.kind === 'copy' ? 'Carta física retirada para o destino abaixo' : 'Bolso vazio'}</td></tr>`)}
          </tbody></table></div>
          ${physical.length ? html`<label class="field"><span class="field__label">Destino físico das ${physical.length} carta(s) retirada(s)</span><select class="select" data-dest>${locationOptions(locations, db.inboxId)}</select></label>
          <label class="checkbox"><input type="checkbox" data-ghost checked> Deixar cartas fantasmas no lugar das físicas</label>` : ''}</div>`,
        footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--crimson" type="button" data-ok>Confirmar</button>`,
        onClose: () => resolve(r),
      });
      m.foot.querySelector('[data-ok]').addEventListener('click', () => { r = { dest: m.body.querySelector('[data-dest]')?.value, ghost: m.body.querySelector('[data-ghost]')?.checked }; m.close(); });
    });
    if (!res) return;
    st.selected.clear();
    await apply(items.map((x) => (x.slot.kind === 'copy' ? { op: 'unplace', pageId: x.pageId, index: x.index, toLocationId: res.dest, leaveGhost: res.ghost } : { op: 'set', pageId: x.pageId, index: x.index, slot: { kind: 'empty' } })), { label: `${items.length} bolso(s) esvaziado(s)` });
  };

  // ------------------------------------------------------------ organização automática (sempre com prévia)
  const autoArrange = async () => {
    const res = await new Promise((resolve) => {
      let r = null; let plan = null;
      const m = openModal({
        title: 'Organizar automaticamente', size: 'xl',
        body: html`<div class="stack stack--lg"><div class="form-grid">
            <label class="field"><span class="field__label">Critério</span><select class="select" data-crit><option value="name">Nome</option><option value="set">Expansão e número</option><option value="number">Número da carta</option><option value="rarity">Raridade</option><option value="type">Tipo</option><option value="lang">Idioma</option></select></label>
            <label class="field"><span class="field__label">Alcance</span><select class="select" data-scope><option value="page">Somente a página ${st.page + 1}</option><option value="all">Fichário inteiro (${b.pages.length} páginas)</option></select></label></div>
          <div data-plan></div></div>`,
        footer: html`<span class="text-sm muted" data-sum></span><span class="spacer"></span><button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok disabled>Aplicar organização</button>`,
        onClose: () => resolve(r),
      });
      const build = () => {
        const crit = m.body.querySelector('[data-crit]').value;
        const pages = m.body.querySelector('[data-scope]').value === 'page' ? [st.page] : null;
        plan = planAutoArrange(b, { criterion: crit, pages, resolveCard: (slot) => (slot.cardKey ? card(slot.cardKey) : null) });
        const phys = plan.changed.filter((mv) => mv.slot.kind === 'copy');
        const previewPages = (pages || b.pages.map((_, i) => i)).slice(0, 4);
        const after = b.pages.map((p) => ({ ...p, slots: p.slots.map((x) => ({ ...x })) }));
        for (const mv of plan.moves) after[mv.from.page].slots[mv.from.index] = { kind: 'empty', locked: false };
        for (const mv of plan.moves) after[mv.to.page].slots[mv.to.index] = { ...mv.slot };
        const mini = (p) => html`<div class="sheet" style="--sheet-color:${b.appearance.sheetColor};padding:8px"><div class="sheet__grid" style="--cols:${p.cols};gap:4px">${p.slots.map((x, i) => html`<div class="pocket ${x.kind === 'empty' ? 'pocket--empty' : ''} ${x.kind === 'ghost' ? 'pocket--ghost' : ''} ${x.locked ? 'is-locked' : ''}">${x.cardKey ? cardArt(card(x.cardKey)) : html`<span class="pocket__empty-num">${i + 1}</span>`}</div>`)}</div></div>`;
        render(m.body.querySelector('[data-plan]'), html`
          ${plan.changed.length ? '' : html`<div class="alert alert--success">${icon('check')}<div>Já está organizado por este critério.</div></div>`}
          <div class="grid-2">${previewPages.map((pi) => html`<div class="stack" style="gap:6px"><span class="text-sm"><strong>Página ${pi + 1}</strong> — antes → depois</span><div class="grid-2" style="gap:8px">${mini(b.pages[pi])}${mini(after[pi])}</div></div>`)}</div>
          ${previewPages.length < (pages || b.pages).length ? html`<p class="text-xs muted">Mostrando as 4 primeiras páginas.</p>` : ''}
          <p class="text-sm muted">Bolsos bloqueados não se movem. Fantasmas e imagens acompanham a ordenação; bolsos sem carta vão para o fim.</p>
          ${phys.length ? html`<div class="alert alert--warning">${icon('alert')}<div><strong>Lista de reorganização física (${phys.length} carta(s)):</strong> ao aplicar, reposicione as cartas no fichário real conforme abaixo. A mudança é registrada no histórico e pode ser desfeita.
            <ol style="margin:8px 0 0;padding-left:18px;max-height:180px;overflow:auto">${phys.map((mv) => html`<li>${card(mv.slot.cardKey)?.name || '—'}: pág. ${mv.from.page + 1}, bolso ${mv.from.index + 1} → pág. ${mv.to.page + 1}, bolso ${mv.to.index + 1}</li>`)}</ol></div></div>` : ''}`);
        hydrateImages(m.body);
        m.foot.querySelector('[data-sum]').textContent = `${plan.changed.length} bolso(s) mudam de posição`;
        m.foot.querySelector('[data-ok]').disabled = !plan.changed.length;
      };
      m.body.querySelector('[data-crit]').addEventListener('change', build);
      m.body.querySelector('[data-scope]').addEventListener('change', build);
      m.foot.querySelector('[data-ok]').addEventListener('click', () => { r = plan; m.close(); });
      build();
    });
    if (!res) return;
    const moves = res.moves.map((mv) => ({ from: { pageId: b.pages[mv.from.page].id, index: mv.from.index }, to: { pageId: b.pages[mv.to.page].id, index: mv.to.index } }));
    const phys = res.changed.some((mv) => mv.slot.kind === 'copy');
    if (phys && !await confirmDialog({ title: 'Confirmar reorganização física', message: 'Cartas físicas mudarão de bolso. Confirme que você fará (ou já fez) essa reorganização no fichário real.', confirmLabel: 'Aplicar' })) return;
    apply([{ op: 'arrange', moves }], { label: 'Organização automática' });
  };

  // ------------------------------------------------------------ páginas
  const pageTools = (anchor) => {
    const page = b.pages[st.page];
    openMenu(anchor, [
      { heading: true, label: `Página ${st.page + 1}` },
      { label: 'Adicionar página depois desta', icon: 'plus', onClick: () => apply([{ op: 'addPage', afterPageId: page.id }], { label: 'Página adicionada' }).then((ok) => ok && (st.page++, paint())) },
      { label: 'Adicionar página especial…', icon: 'layout', onClick: () => layoutDialog(null) },
      { label: `Mudar formato desta página (${page.cols}×${page.rows})…`, icon: 'grid', onClick: () => layoutDialog(page) },
      { separator: true },
      { label: 'Excluir esta página', icon: 'trash', danger: true, disabled: b.pages.length === 1, onClick: async () => {
        if (!await confirmDialog({ title: `Excluir a página ${st.page + 1}?`, message: 'Fantasmas, referências e imagens desta página serão removidos. Páginas com cartas físicas não podem ser excluídas.', danger: true, confirmLabel: 'Excluir página' })) return;
        if (await apply([{ op: 'removePage', pageId: page.id }], { label: 'Página excluída' })) { st.page = Math.min(st.page, b.pages.length - 1); paint(); }
      } },
    ]);
  };

  const layoutDialog = async (page) => {
    const res = await new Promise((resolve) => {
      let r = null;
      const m = openModal({
        title: page ? 'Formato da página' : 'Nova página especial',
        body: html`<div class="stack"><div class="chips">${LAYOUTS.map((l) => html`<button class="chip" type="button" data-l="${l.cols}x${l.rows}">${l.label}</button>`)}</div>
          <div class="row"><label class="field"><span class="field__label">Colunas</span><input class="input" type="number" min="1" max="6" value="${page?.cols || b.layout.cols}" data-c style="width:90px"></label><label class="field"><span class="field__label">Linhas</span><input class="input" type="number" min="1" max="6" value="${page?.rows || b.layout.rows}" data-r style="width:90px"></label></div>
          ${page ? html`<p class="text-xs muted">Reduzir o formato só é permitido se os bolsos removidos estiverem vazios.</p>` : ''}</div>`,
        footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>Aplicar</button>`,
        onClose: () => resolve(r),
      });
      m.body.querySelectorAll('[data-l]').forEach((x) => x.addEventListener('click', () => { const [c, rr] = x.dataset.l.split('x'); m.body.querySelector('[data-c]').value = c; m.body.querySelector('[data-r]').value = rr; }));
      m.foot.querySelector('[data-ok]').addEventListener('click', () => { r = { cols: Number(m.body.querySelector('[data-c]').value), rows: Number(m.body.querySelector('[data-r]').value) }; m.close(); });
    });
    if (!res) return;
    if (page) apply([{ op: 'layoutPage', pageId: page.id, ...res }], { label: 'Formato da página alterado' });
    else if (await apply([{ op: 'addPage', afterPageId: b.pages[st.page].id, ...res }], { label: 'Página especial adicionada' })) { st.page++; paint(); }
  };

  const duplicate = async () => {
    try {
      const nb = await db.duplicateAsVirtual(b.id);
      changed('binders');
      toast({ type: 'success', title: 'Cópia virtual criada', text: 'Cartas físicas viraram referências; nada foi duplicado no inventário.', action: { label: 'Abrir', onClick: () => navigate(`/ficharios/${nb.id}`) } });
    } catch (e) { toastError(e); }
  };

  const removeBinder = async () => {
    const n = binderStats(b).copy;
    const locations = n ? await db.listLocations() : [];
    const res = await new Promise((resolve) => {
      let r = null;
      const m = openModal({
        title: `Excluir “${b.name}”?`,
        body: html`<div class="stack"><p class="muted">O fichário, suas páginas, fantasmas e referências serão excluídos.</p>
          ${n ? html`<label class="field"><span class="field__label">Para onde vão as ${n} carta(s) física(s)?</span><select class="select" data-dest>${locationOptions(locations.filter((l) => l.binderId !== b.id), db.inboxId)}</select><span class="field__hint">A movimentação entra no histórico.</span></label>` : ''}</div>`,
        footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--crimson" type="button" data-ok>Excluir fichário</button>`,
        onClose: () => resolve(r),
      });
      m.foot.querySelector('[data-ok]').addEventListener('click', () => { r = { to: m.body.querySelector('[data-dest]')?.value }; m.close(); });
    });
    if (!res) return;
    try { await db.deleteBinder(b.id, { moveCopiesTo: res.to }); changed('binders'); toast({ type: 'success', text: 'Fichário excluído.' }); navigate('/ficharios'); } catch (e) { toastError(e); }
  };

  paint();
  const offData = on('data:binders', () => {});
  const offRemote = on('remote:data:binders', async () => { b = await db.getBinder(b.id) || b; await loadAux(); paint(); });
  return () => { document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('dd-noscroll'); offData(); offRemote(); };
}
