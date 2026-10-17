// #/b/:id — fichário público ou não listado de qualquer colecionador (somente leitura).
// Mostra cartas e artes como no modo espectador; nunca exibe localização física nem inventário.
import { html, render, raw, escape } from '../core/html.js';
import { icon } from '../core/icons.js';
import { community } from '../api/community.js';
import { cardArt, hydrateImages, zoomCard } from '../components/card.js';
import { cropStyle, panoramaTileStyle } from '../features/image-tools.js';
import { avatar } from './community.js';
import { toast } from '../components/toast.js';

const isMobile = () => matchMedia('(max-width: 767px)').matches;

export default async function publicBinder(ctx, main) {
  if (!await community.available()) {
    render(main, html`<div class="page"><div class="state"><div class="state__icon">${icon('book')}</div><h3>Fichários públicos precisam do servidor DuskDex</h3><p>Abra este link no endereço onde o DuskDex está rodando com o servidor.</p></div></div>`);
    return;
  }
  let b;
  try { b = await community.publicBinder(ctx.params.id); } catch (e) {
    render(main, html`<div class="page"><div class="state"><div class="state__icon">${icon('book')}</div><h3>Fichário indisponível</h3><p>${e.message}</p><a class="btn" href="#/comunidade">Comunidade</a></div></div>`);
    return;
  }
  const cards = new Map(b.cards.map((c) => [c.key, c]));
  const assets = new Map((b.assets || []).map((a) => [a.id, a]));
  const st = { page: 0, single: isMobile(), spectate: false };
  const perSpread = () => (st.single ? 1 : 2);
  const off = () => (perSpread() === 2 && b.appearance.firstPageRight ? 1 : 0);
  const start = () => { if (perSpread() !== 2) return st.page; const v = st.page + off(); return v - (v % 2) - off(); };

  const pocket = (slot, i) => {
    let inner = '';
    if (slot.kind === 'image') {
      const a = assets.get(slot.assetId);
      const style = a ? (slot.panorama ? panoramaTileStyle(a, slot.panorama, slot.panorama.row, slot.panorama.col) : cropStyle(a, slot.crop)) : '';
      inner = a ? html`<div class="pocket__image"><img alt="" src="${a.url}" style="position:absolute;max-width:none;${raw(escape(style))}"></div>` : '';
    } else if (slot.cardKey) {
      inner = cardArt(cards.get(slot.cardKey) || null);
    }
    return html`<div class="pocket ${slot.kind === 'empty' ? 'pocket--empty' : 'pocket--filled'} pocket--${slot.kind}" data-slot-style="${b.appearance.slotStyle || 'rounded'}" ${slot.cardKey ? html`data-zoom="${slot.cardKey}" role="button" tabindex="0"` : ''} aria-label="Bolso ${i + 1}">${inner}</div>`;
  };
  const sheet = (pi) => {
    if (pi < 0) return html`<div class="sheet sheet--blank sheet--cover-inner" style="--sheet-color:${b.appearance.sheetColor}"><span>Verso da capa</span></div>`;
    const p = b.pages[pi];
    if (!p) return html`<div class="sheet sheet--blank" style="--sheet-color:${b.appearance.sheetColor}"><span>Contracapa</span></div>`;
    return html`<div class="sheet" style="--sheet-color:${b.appearance.sheetColor}"><div class="sheet__label"><span>Pág. ${pi + 1}</span><span>${p.cols}×${p.rows}</span></div><div class="sheet__grid" style="--cols:${p.cols}">${p.slots.map(pocket)}</div></div>`;
  };
  const label = () => {
    const a = start();
    if (perSpread() === 1) return `Pág. ${a + 1} de ${b.pages.length}`;
    if (a < 0) return `Capa · pág. 1 de ${b.pages.length}`;
    const z = Math.min(a + 2, b.pages.length);
    return z === a + 1 ? `Pág. ${z} de ${b.pages.length}` : `Págs. ${a + 1}–${z} de ${b.pages.length}`;
  };
  const canPrev = () => start() > -off();
  const canNext = () => start() + perSpread() < b.pages.length;
  const go = (dir) => {
    const t = start() + dir * perSpread();
    if (t < -off() || t >= b.pages.length) return;
    st.page = Math.max(0, t); paint();
  };

  const paint = () => {
    const filled = b.pages.reduce((n, p) => n + p.slots.filter((s) => s.kind !== 'empty').length, 0);
    const total = b.pages.reduce((n, p) => n + p.slots.length, 0);
    render(main, html`<div class="page page--wide binder-shell view-only ${st.spectate ? 'is-spectator' : ''}" style="--binder-color:${b.appearance.color};--sheet-color:${b.appearance.sheetColor}">
      <div class="row" style="margin-bottom:6px"><a class="btn btn--ghost btn--sm" href="#/u/${b.owner.username}">${icon('arrowLeft')} @${b.owner.username}</a></div>
      <div class="page-head" style="margin-bottom:16px"><div>
          <div class="page-head__eyebrow">Fichário ${b.type === 'physical' ? 'físico' : 'virtual'} · ${b.visibility === 'public' ? 'público' : 'não listado'}</div>
          <h1>${b.name}</h1>${b.description ? html`<p>${b.description}</p>` : ''}
          <div class="row text-sm muted" style="margin-top:8px;gap:14px"><a class="row" style="gap:8px;color:inherit" href="#/u/${b.owner.username}">${avatar(b.owner, 'avatar--xs')}${b.owner.displayName}</a><span>${b.pages.length} páginas</span><span>${filled}/${total} bolsos preenchidos</span></div></div>
        <div class="btn-group">
          <button class="btn" type="button" data-spectate>${icon('eye')} Espectador</button>
          <button class="btn" type="button" data-copylink>${icon('share')} Copiar link</button>
          ${b.isOwner ? html`<a class="btn btn--primary" href="#/ficharios/${b.id}">${icon('pencil')} Abrir no editor</a>` : ''}</div></div>
      <div class="binder-toolbar">
        <div class="segmented" role="group" aria-label="Visualização"><button type="button" data-view="book" aria-pressed="${!st.single}">${icon('book')} Livro</button><button type="button" data-view="single" aria-pressed="${st.single}">${icon('file')} Página única</button></div>
        <div class="page-nav"><button class="btn btn--icon btn--sm" type="button" data-prev aria-label="Página anterior" ${canPrev() ? '' : 'disabled'}>${icon('chevronLeft')}</button><span class="page-nav__label" aria-live="polite">${label()}</span><button class="btn btn--icon btn--sm" type="button" data-next aria-label="Próxima página" ${canNext() ? '' : 'disabled'}>${icon('chevronRight')}</button></div>
      </div>
      <div class="binder-stage" data-stage>${perSpread() === 2 ? html`<div class="book">${sheet(start())}${sheet(start() + 1)}</div>` : html`<div class="book book--single">${sheet(start())}</div>`}
        ${st.spectate ? html`<div class="spectate-ui">
          <button class="spectate-ui__close" type="button" data-spectate-exit aria-label="Sair do modo espectador">${icon('x')}</button>
          <button class="spectate-ui__nav spectate-ui__nav--prev" type="button" data-prev aria-label="Página anterior" ${canPrev() ? '' : 'disabled'}>${icon('chevronLeft')}</button>
          <button class="spectate-ui__nav spectate-ui__nav--next" type="button" data-next aria-label="Próxima página" ${canNext() ? '' : 'disabled'}>${icon('chevronRight')}</button>
          <div class="spectate-ui__label"><strong>${b.name}</strong><span>${label()}</span></div></div>` : ''}</div>
      <p class="text-xs subtle mt-6">Visualização pública: a localização física das cartas e o inventário de @${b.owner.username} não são exibidos.</p>
    </div>`);
    hydrateImages(main);
    main.querySelectorAll('[data-prev]').forEach((x) => x.addEventListener('click', () => go(-1)));
    main.querySelectorAll('[data-next]').forEach((x) => x.addEventListener('click', () => go(1)));
    main.querySelectorAll('[data-view]').forEach((x) => x.addEventListener('click', () => { st.single = x.dataset.view === 'single'; paint(); }));
    main.querySelector('[data-spectate]').addEventListener('click', () => { st.spectate = true; document.documentElement.classList.add('dd-noscroll'); paint(); });
    main.querySelector('[data-spectate-exit]')?.addEventListener('click', () => { st.spectate = false; document.documentElement.classList.remove('dd-noscroll'); paint(); });
    main.querySelector('[data-copylink]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/b/${b.id}`); toast({ type: 'success', text: 'Link copiado.', timeout: 2000 }); } catch { /* sem permissão */ }
    });
    main.querySelectorAll('[data-zoom]').forEach((el) => el.addEventListener('click', () => zoomCard(cards.get(el.dataset.zoom))));
  };
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'Escape' && st.spectate) { st.spectate = false; document.documentElement.classList.remove('dd-noscroll'); paint(); }
  };
  document.addEventListener('keydown', onKey);
  paint();
  return () => { document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('dd-noscroll'); };
}
