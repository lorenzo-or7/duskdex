import { html, raw, escape } from '../core/html.js';
import { icon, sparkStar } from '../core/icons.js';
import { cardImageSources, findImageSources, langLabel } from '../api/tcgdex.js';
import { sourcesOf } from '../core/img-fallback.js';
import { data } from '../api/index.js';

// Object URLs de imagens próprias (IndexedDB) reutilizados entre renders.
const assetUrls = new Map();
/** URL já pronta de uma imagem própria (sem esperar), para renders que não podem piscar. */
export const assetUrlCached = (assetId) => assetUrls.get(assetId) || null;
// Imagens de carta que já carregaram nesta sessão: em um novo render entram visíveis de imediato,
// sem skeleton nem fade (evita a "piscada" ao virar páginas ou redesenhar a tela).
const loadedSrc = new Set();
export async function assetObjectUrl(assetId) {
  if (!assetId) return null;
  if (assetUrls.has(assetId)) return assetUrls.get(assetId);
  const blob = await data().getAssetBlob(assetId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  assetUrls.set(assetId, url);
  return url;
}

/**
 * Imagem de carta com skeleton, carregamento lazy e fallback desenhado quando a imagem não existe ou falha.
 * O onload/onerror é tratado por `hydrateImages` (sem handlers inline).
 */
export function cardArt(card, { quality = 'low', hover = false, extraClass = '' } = {}) {
  if (!card) {
    return html`<div class="tcg ${extraClass}"><div class="tcg__fallback"><span class="tcg__fallback-name">Carta indisponível</span>${sparkStar}<span class="tcg__fallback-meta">Dados não carregados</span></div></div>`;
  }
  const custom = card.source === 'custom';
  const { src, fallbacks } = sourcesOf(custom ? [] : cardImageSources(card, quality));
  const fallback = html`<div class="tcg__fallback" ${src ? 'hidden' : ''}>
      <span class="tcg__fallback-name">${card.name}</span>
      ${sparkStar}
      <span class="tcg__fallback-meta">${card.set?.name || card.setLabel || ''}${card.localId ? ` · #${card.localId}` : ''}<br><span data-fb-reason>${src ? 'Carregando imagem…' : custom ? 'Carta personalizada' : 'Sem imagem na TCGdex'}</span></span>
    </div>`;
  const customImg = custom && card.assetId ? html`<img data-asset="${card.assetId}" alt="${card.name}" decoding="async">` : '';
  const warm = !!src && loadedSrc.has(src);
  return html`<div class="tcg-wrap"><div class="tcg ${(src && !warm) || customImg ? 'is-loading' : ''} ${hover ? 'tcg--hover' : ''} ${custom ? 'tcg--custom' : ''} ${extraClass}">
    ${src ? html`<img src="${src}" class="${warm ? 'is-loaded is-warm' : ''}" alt="${card.name}${card.localId ? ` — nº ${card.localId}` : ''}" loading="${warm ? 'eager' : 'lazy'}" decoding="${warm ? 'sync' : 'async'}" data-fallbacks="${fallbacks}" data-tcg data-card-id="${card.id || ''}" data-card-lang="${card.lang || 'en'}" data-quality="${quality}">` : ''}
    ${customImg}
    ${fallback}
  </div></div>`;
}

/** Liga eventos de carregamento das imagens dentro de `root`. */
export function hydrateImages(root) {
  root.querySelectorAll('img[data-tcg]:not([data-h])').forEach((img) => {
    img.dataset.h = '1';
    const box = img.closest('.tcg');
    const done = () => { loadedSrc.add(img.getAttribute('src')); img.classList.add('is-loaded'); box?.classList.remove('is-loading'); };
    const fail = () => {
      // todas as fontes conhecidas falharam (o tratador global já tentou as de `data-fallbacks`)
      box?.classList.remove('is-loading');
      const fb = box?.querySelector('.tcg__fallback');
      const reason = fb?.querySelector('[data-fb-reason]');
      const id = img.dataset.cardId;
      img.hidden = true;
      if (fb) fb.hidden = false;
      const giveUp = () => {
        img.remove();
        if (reason) reason.textContent = navigator.onLine === false ? 'Sem conexão para carregar a imagem' : 'Sem imagem nas bases públicas';
        // na página da carta, explica o motivo (o link não cabe dentro dos cartões clicáveis das listas)
        const detail = box?.closest('.card-detail__art');
        if (detail && navigator.onLine !== false && !detail.querySelector('.card-detail__why')) {
          detail.insertAdjacentHTML('beforeend', '<a class="card-detail__why text-sm" href="#/ajuda?item=sem-foto">Por que esta carta está sem foto?</a>');
        }
      };
      if (!id || img.dataset.retried) { giveUp(); return; }
      img.dataset.retried = '1';
      // cartas salvas antes desta versão não guardam as fontes alternativas: procura na base local
      findImageSources(id, img.dataset.cardLang || 'en', img.dataset.quality || 'low').then((list) => {
        const tried = new Set([img.getAttribute('src')]);
        const rest = list.filter((u) => !tried.has(u));
        if (!rest.length) { giveUp(); return; }
        if (reason) reason.textContent = 'Carregando imagem…';
        img.hidden = false; if (fb) fb.hidden = true; box?.classList.add('is-loading');
        img.addEventListener('load', done, { once: true }); img.addEventListener('error', giveUpLoad, { once: true });
        if (rest.length > 1) img.dataset.fallbacks = rest.slice(1).join('|');
        img.src = rest[0];
      }).catch(giveUp);
      const giveUpLoad = () => { box?.classList.remove('is-loading'); img.hidden = true; if (fb) fb.hidden = false; giveUp(); };
    };
    if (img.complete && img.naturalWidth) done();
    else if (img.complete && img.src) fail();
    else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', fail, { once: true }); }
  });
  root.querySelectorAll('img[data-asset]:not([data-h])').forEach(async (img) => {
    img.dataset.h = '1';
    const box = img.closest('.tcg');
    const url = await assetObjectUrl(img.dataset.asset);
    if (url) { img.src = url; img.classList.add('is-loaded'); box?.classList.remove('is-loading'); }
    else { box?.classList.remove('is-loading'); img.remove(); }
  });
  root.querySelectorAll('[data-bg-asset]:not([data-h])').forEach(async (el) => {
    el.dataset.h = '1';
    const url = await assetObjectUrl(el.dataset.bgAsset);
    if (url) el.style.backgroundImage = `url("${url}")`;
  });
}

export const finishLabel = (f) => ({ normal: 'Normal', reverse: 'Reverse holo', holo: 'Holo', firstEdition: '1ª edição', first_edition: '1ª edição', wPromo: 'Promo', other: 'Outro' }[f] || f || 'Normal');

/** Tile de carta para grades. */
export function cardTile(card, { qty = 0, wish = false, selectable = false, selected = false, meta = null, attrs = '', hover = true, index = 0 } = {}) {
  const sub = meta ?? [card?.set?.name, card?.localId ? `#${card.localId}` : null].filter(Boolean).join(' · ');
  return html`<div class="card-tile ${selected ? 'is-selected' : ''}" style="animation-delay:${Math.min(index, 20) * 22}ms" ${raw(attrs)}>
    ${selectable ? html`<button type="button" class="card-tile__select" data-select aria-pressed="${selected}" aria-label="Selecionar ${card?.name || 'carta'}">${icon('check')}</button>` : ''}
    <div class="card-tile__badges">
      ${qty ? html`<span class="card-tile__qty" title="${qty} cópia(s) na coleção">×${qty}</span>` : ''}
      ${wish ? html`<span class="card-tile__wish" title="Na Wishlist">${icon('heart')}</span>` : ''}
    </div>
    <button type="button" class="card-tile__btn" data-open aria-label="Ver ${card?.name || 'carta'}">${cardArt(card, { hover })}</button>
    <div class="card-tile__info">
      <span class="card-tile__name" title="${card?.name || ''}">${card?.name || '—'}</span>
      <span class="card-tile__meta">${sub}</span>
    </div>
  </div>`;
}

/** Visualização ampliada (zoom). */
export function zoomCard(card, src) {
  const el = document.createElement('div');
  el.className = 'zoom-view';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Visualização ampliada: ${card?.name || 'imagem'}`);
  el.tabIndex = -1;
  // cartas usam todas as fontes (com alternativas); uma URL avulsa só é usada sem dados da carta
  el.innerHTML = src && !card
    ? `<div class="tcg"><img class="is-loaded" src="${escape(src)}" alt=""></div>`
    : String(cardArt(card, { quality: 'high' }));
  document.body.appendChild(el);
  hydrateImages(el);
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  el.focus();
}

export function langBadge(code) {
  return html`<span class="badge" title="${langLabel(code)}">${String(code || '').toUpperCase()}</span>`;
}
