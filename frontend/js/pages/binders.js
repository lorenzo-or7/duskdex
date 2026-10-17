import { html, render, formatDate } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { binderStats, LAYOUTS } from '../features/domain.js';
import { cardArt, hydrateImages, assetObjectUrl } from '../components/card.js';
import { openModal } from '../components/modal.js';
import { toastError, toast } from '../components/toast.js';
import { navigate, setQuery } from '../router.js';
import { locationOptions } from '../features/actions.js';
import { pickCards } from '../components/card-picker.js';
import { validateImageFile } from '../features/image-tools.js';
import { on } from '../core/events.js';

export const BINDER_COLORS = ['#4b2f5e', '#5a2f45', '#1d1526', '#2f3f5a', '#2f4a3f', '#6b4a24', '#7a2c3b', '#3a3a44', '#b8a07a', '#d8bde5'];
export const SHEET_COLORS = ['#1a1420', '#0f0c13', '#24202a', '#f4efe6', '#e9e3ef', '#ffffff'];
export const STYLES = { classico: 'Clássico', couro: 'Couro', holo: 'Holográfico', noturno: 'Noturno' };
// mesma regra do fichário aberto (binder.js) para folhas claras
const isLightHex = (hex) => {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
};
export const SLOT_STYLES = { rounded: 'Arredondado', square: 'Reto', glow: 'Brilho espectral' };

/** Formulário de criação/edição de fichário. Retorna o fichário salvo ou null. */
export async function binderForm(existing = null) {
  const db = data();
  const locations = await db.listLocations();
  const a = existing?.appearance || {};
  const st = {
    type: existing?.type || 'physical', color: a.color || BINDER_COLORS[0], sheetColor: a.sheetColor || SHEET_COLORS[0], style: a.style || 'classico', slotStyle: a.slotStyle || 'rounded',
    layout: existing ? `${existing.layout.cols}x${existing.layout.rows}` : '3x3', coverCardKey: a.coverCardKey || null, coverAssetId: a.coverAssetId || null,
    firstPageRight: !!a.firstPageRight,
  };
  return new Promise((resolve) => {
    let result = null;
    const m = openModal({
      title: existing ? 'Personalizar fichário' : 'Novo fichário', size: 'lg',
      body: html`<form class="stack stack--lg" data-form>
        ${existing ? '' : html`<div class="grid-2">
          <label class="mode-option"><input type="radio" name="type" value="physical" ${st.type === 'physical' ? 'checked' : ''}><span><strong>Físico</strong><br><span class="text-sm muted">Espelha um fichário real. Recebe cópias físicas da sua coleção; cada cópia ocupa um único bolso.</span></span></label>
          <label class="mode-option"><input type="radio" name="type" value="virtual" ${st.type === 'virtual' ? 'checked' : ''}><span><strong>Virtual</strong><br><span class="text-sm muted">Planejamento livre com qualquer carta do catálogo. Não consome cópias físicas.</span></span></label>
        </div>`}
        <div class="form-grid">
          <label class="field"><span class="field__label">Nome *</span><input class="input" name="name" required maxlength="60" value="${existing?.name || ''}" placeholder="Ex.: Kanto Clássico" autofocus></label>
          <label class="field"><span class="field__label">Visibilidade</span><select class="select" name="visibility">${[['private', 'Privado'], ['unlisted', 'Não listado'], ['public', 'Público']].map(([v, l]) => html`<option value="${v}" ${(existing?.visibility || 'private') === v ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="field span-2"><span class="field__label">Descrição</span><textarea class="textarea" name="description" maxlength="500" style="min-height:70px">${existing?.description || ''}</textarea></label>
          ${existing ? '' : html`
          <label class="field"><span class="field__label">Formato da página</span><select class="select" name="layout">${LAYOUTS.map((l) => html`<option value="${l.cols}x${l.rows}" ${st.layout === `${l.cols}x${l.rows}` ? 'selected' : ''}>${l.label}</option>`)}<option value="custom">Personalizado…</option></select>
            <span class="field__hint">Colunas × linhas. Páginas especiais podem ter outro formato depois.</span></label>
          <div class="field" data-custom-layout hidden><span class="field__label">Colunas × linhas</span><div class="row" style="gap:8px"><input class="input" name="cols" type="number" min="1" max="6" value="3" style="width:80px"><span>×</span><input class="input" name="rows" type="number" min="1" max="6" value="3" style="width:80px"></div></div>
          <label class="field"><span class="field__label">Páginas iniciais</span><input class="input" name="pages" type="number" min="1" max="200" value="10"></label>
          <label class="field" data-parent><span class="field__label">Onde fica guardado</span><select class="select" name="parentLocationId"><option value="">— Nível principal —</option>${locationOptions(locations.filter((l) => !l.system), null)}</select></label>`}
        </div>
        <section class="stack"><span class="field__label">Cor do fichário</span><div class="swatches" data-sw="color">${BINDER_COLORS.map((c) => html`<button type="button" class="swatch" style="background:${c}" data-v="${c}" aria-pressed="${c === st.color}" aria-label="Cor ${c}"></button>`)}<input type="color" value="${st.color}" data-custom-color aria-label="Cor personalizada" style="width:32px;height:32px;border:0;background:none;padding:0"></div></section>
        <section class="stack"><span class="field__label">Cor das folhas</span><div class="swatches" data-sw="sheetColor">${SHEET_COLORS.map((c) => html`<button type="button" class="swatch" style="background:${c}" data-v="${c}" aria-pressed="${c === st.sheetColor}" aria-label="Folha ${c}"></button>`)}</div></section>
        <div class="form-grid appearance-grid">
          <div class="stack">
            <label class="field"><span class="field__label">Estilo visual</span><select class="select" data-st="style">${Object.entries(STYLES).map(([k, v]) => html`<option value="${k}" ${st.style === k ? 'selected' : ''}>${v}</option>`)}</select></label>
            <div class="appearance-preview"><div class="appearance-preview__cover" data-preview></div>
              <div class="stack" style="gap:8px"><span class="field__label">Capa</span><button class="btn btn--sm" type="button" data-cover-card>${icon('layers')} Usar arte de uma carta</button>
                ${db.capabilities.assets ? html`<label class="btn btn--sm" style="cursor:pointer">${icon('upload')} Enviar imagem<input type="file" accept="image/png,image/jpeg,image/webp" data-cover-file hidden></label>` : ''}
                <button class="btn btn--sm btn--ghost" type="button" data-cover-none>Sem capa</button></div></div>
          </div>
          <div class="stack">
            <label class="field"><span class="field__label">Estilo dos bolsos</span><select class="select" data-st="slotStyle">${Object.entries(SLOT_STYLES).map(([k, v]) => html`<option value="${k}" ${st.slotStyle === k ? 'selected' : ''}>${v}</option>`)}</select></label>
            <div class="slot-preview" data-slot-preview aria-hidden="true"></div>
          </div>
        </div>
        <label class="checkbox" style="align-items:flex-start"><input type="checkbox" name="firstPageRight" ${st.firstPageRight ? 'checked' : ''}><span><strong>Primeira página do lado direito</strong><br><span class="text-sm muted">No modo livro, o lado esquerdo do primeiro par fica como verso da capa, como em fichários em que a primeira folha é presa à capa.</span></span></label>
      </form>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>${existing ? 'Salvar alterações' : html`${icon('plus')} Criar fichário`}</button>`,
      onClose: () => resolve(result),
    });
    const form = m.body.querySelector('form');
    const preview = async () => {
      const box = m.body.querySelector('[data-preview]');
      render(box, html`<div class="binder-cover" data-style="${st.style}" style="--binder-color:${st.color}"><div class="binder-cover__rings"><span></span><span></span><span></span></div>
        ${st.coverCardKey ? html`<div class="binder-cover__art">${cardArt(card(st.coverCardKey))}</div>` : st.coverAssetId ? html`<div class="binder-cover__art" data-bg-asset="${st.coverAssetId}" style="background-size:cover;background-position:center"></div>` : ''}
        <div class="binder-cover__title">${form.name.value || 'Seu fichário'}</div></div>`);
      hydrateImages(box);
      // prévia de uma folha: cor da folha, colunas do formato escolhido e estilo dos bolsos
      const sp = m.body.querySelector('[data-slot-preview]');
      const lay = form.layout?.value === 'custom' ? `${form.cols.value}x${form.rows.value}` : (form.layout?.value || st.layout);
      const cols = Math.min(4, Math.max(2, Number(String(lay).split('x')[0]) || 3));
      const cover = st.coverCardKey ? card(st.coverCardKey) : null;
      const filled = (i) => html`<div class="pocket pocket--filled" data-slot-style="${st.slotStyle}">${i === 0 && cover ? cardArt(cover) : html`<div class="tcg slot-preview__card slot-preview__card--${i % 3}"></div>`}</div>`;
      const empty = (i) => html`<div class="pocket pocket--empty" data-slot-style="${st.slotStyle}"><span class="pocket__empty-num">${i + 1}</span></div>`;
      render(sp, html`<div class="sheet ${isLightHex(st.sheetColor) ? 'sheet--light' : ''}" style="--sheet-color:${st.sheetColor};--binder-color:${st.color}">
        <div class="sheet__grid" style="--cols:${cols}">${Array.from({ length: cols * 2 }, (_, i) => (i < Math.ceil(cols * 1.2) ? filled(i) : empty(i)))}</div></div>`);
      hydrateImages(sp);
    };
    form.addEventListener('input', () => preview());
    form.addEventListener('change', (e) => {
      if (e.target.name === 'type') { st.type = e.target.value; const p = form.querySelector('[data-parent]'); if (p) p.hidden = st.type !== 'physical'; }
      if (e.target.name === 'layout') form.querySelector('[data-custom-layout]').hidden = e.target.value !== 'custom';
      if (e.target.dataset.st) { st[e.target.dataset.st] = e.target.value; preview(); }
      if (e.target.matches('[data-custom-color]')) { st.color = e.target.value; m.body.querySelectorAll('[data-sw="color"] .swatch').forEach((x) => x.setAttribute('aria-pressed', 'false')); preview(); }
    });
    m.body.querySelectorAll('[data-sw]').forEach((grp) => grp.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      st[grp.dataset.sw] = b.dataset.v;
      grp.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      preview();
    }));
    m.body.querySelector('[data-cover-card]').addEventListener('click', async () => {
      const snaps = await pickCards({ title: 'Carta da capa', sources: ['collection', 'catalog', 'samples'] });
      if (snaps?.[0]) { st.coverCardKey = snaps[0].key; st.coverAssetId = null; preview(); }
    });
    m.body.querySelector('[data-cover-none]').addEventListener('click', () => { st.coverCardKey = null; st.coverAssetId = null; preview(); });
    m.body.querySelector('[data-cover-file]')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const v = await validateImageFile(f);
        const meta = await db.addAsset({ blob: f, name: f.name, width: v.width, height: v.height, mime: v.mime });
        await assetObjectUrl(meta.id);
        st.coverAssetId = meta.id; st.coverCardKey = null; preview();
      } catch (err) { toastError(err); }
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
      if (!form.name.value.trim()) { form.name.setAttribute('aria-invalid', 'true'); form.name.focus(); return; }
      e.target.disabled = true;
      const fd = new FormData(form);
      const appearance = { color: st.color, sheetColor: st.sheetColor, style: st.style, slotStyle: st.slotStyle, coverCardKey: st.coverCardKey, coverAssetId: st.coverAssetId, firstPageRight: fd.get('firstPageRight') === 'on' };
      try {
        if (existing) {
          result = await db.updateBinderMeta(existing.id, { name: fd.get('name'), description: fd.get('description'), visibility: fd.get('visibility'), appearance }, existing.version);
        } else {
          let [cols, rows] = String(fd.get('layout')).split('x').map(Number);
          if (fd.get('layout') === 'custom') { cols = Number(fd.get('cols')); rows = Number(fd.get('rows')); }
          result = await db.createBinder({ name: fd.get('name'), description: fd.get('description'), visibility: fd.get('visibility'), type: fd.get('type'), rows, cols, pages: Number(fd.get('pages')), parentLocationId: fd.get('parentLocationId') || null, ...appearance });
        }
        changed('binders');
        m.close();
      } catch (err) { toastError(err); e.target.disabled = false; }
    });
    preview();
  });
}

export function binderCover(b, { showType = true } = {}) {
  // fichários de outros colecionadores (páginas públicas) trazem o snapshot da capa junto
  const cover = b.coverCard || (b.appearance.coverCardKey ? card(b.appearance.coverCardKey) : null);
  const remoteArt = !cover && b.appearance.coverAssetId && b.remote ? `api/v1/assets/${encodeURIComponent(b.appearance.coverAssetId)}/file` : null;
  return html`<div class="binder-cover" data-style="${b.appearance.style}" style="--binder-color:${b.appearance.color}">
    <div class="binder-cover__rings"><span></span><span></span><span></span></div>
    ${showType ? html`<span class="binder-cover__type badge ${b.type === 'physical' ? 'badge--primary' : 'badge--info'}" style="background:rgba(13,11,18,.75)">${b.type === 'physical' ? 'Físico' : 'Virtual'}</span>` : ''}
    ${cover ? html`<div class="binder-cover__art">${cardArt(cover)}</div>` : remoteArt ? html`<div class="binder-cover__art" style="background:url('${remoteArt}') center/cover"></div>` : b.appearance.coverAssetId ? html`<div class="binder-cover__art" data-bg-asset="${b.appearance.coverAssetId}" style="background-size:cover;background-position:center"></div>` : ''}
    <div class="binder-cover__title">${b.name}</div></div>`;
}

export default async function binders(ctx, main) {
  const db = data();
  const st = { filter: ctx.query.tipo || '' };
  const paint = async () => {
    const list = await db.listBinders();
    const shown = list.filter((b) => !st.filter || b.type === st.filter);
    render(main, html`<div class="page page--wide">
      <div class="page-head page-head--art" data-art="binders"><div><div class="page-head__eyebrow">Organização</div><h1>Fichários</h1><p>Físicos espelham seus fichários reais; virtuais servem para planejar páginas com qualquer carta.</p></div>
        <div class="btn-group"><a class="btn" href="#/imagens">${icon('image')} Biblioteca de imagens</a><button class="btn btn--primary" type="button" data-new>${icon('plus')} Novo fichário</button></div></div>
      <div class="toolbar"><div class="segmented" role="group" aria-label="Filtrar por tipo">${[['', 'Todos'], ['physical', 'Físicos'], ['virtual', 'Virtuais']].map(([v, l]) => html`<button type="button" data-f="${v}" aria-pressed="${st.filter === v}">${l}</button>`)}</div><span class="text-sm muted">${shown.length} fichário(s)</span></div>
      ${shown.length ? html`<div class="binder-cards">${shown.map((b, i) => {
    const s = binderStats(b);
    return html`<a class="binder-card" href="#/ficharios/${b.id}" style="animation-delay:${i * 40}ms">
          ${binderCover(b)}
          <div class="binder-card__meta">
            <span class="binder-card__name">${b.name} ${b.favorite ? icon('star') : ''}</span>
            <span class="binder-card__info"><span>${b.pages.length} páginas</span><span>${s.slots} bolsos</span><span>${b.layout.cols}×${b.layout.rows}</span><span>atualizado ${formatDate(b.updatedAt)}</span></span>
            <div class="progress-row"><div class="progress-row__top text-xs"><span class="muted">${b.type === 'physical' ? `${s.copy} cartas físicas` : `${s.filled} bolsos planejados`}${s.ghost ? ` · ${s.ghost} fantasma(s)` : ''}</span><span>${s.progress}%</span></div><div class="progress progress--sm"><div class="progress__bar" style="width:${s.progress}%"></div></div></div>
          </div></a>`;
  })}</div>` : html`<div class="state"><div class="state__icon">${icon('book')}</div><h3>${list.length ? 'Nenhum fichário deste tipo' : 'Nenhum fichário ainda'}</h3><p>Crie um fichário físico para espelhar o da sua estante ou um virtual para planejar.</p><button class="btn btn--primary" type="button" data-new2>${icon('plus')} Criar fichário</button></div>`}
    </div>`);
    hydrateImages(main);
    const create = async () => { const b = await binderForm(); if (b) { toast({ type: 'success', title: 'Fichário criado', text: b.name }); navigate(`/ficharios/${b.id}`); } };
    main.querySelector('[data-new]').addEventListener('click', create);
    main.querySelector('[data-new2]')?.addEventListener('click', create);
    main.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.filter = b.dataset.f; setQuery({ tipo: st.filter }); paint(); }));
  };
  await paint();
  if (ctx.query.novo === '1') { setQuery({ novo: '' }); const b = await binderForm(); if (b) navigate(`/ficharios/${b.id}`); }
  return on('data:changed', paint);
}
