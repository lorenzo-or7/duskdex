import { html, render, uid } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { cardArt, hydrateImages, assetObjectUrl } from '../components/card.js';
import { openModal } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { navigate } from '../router.js';
import { coverGeometry, panoramaArea, tileRegion, panoramaTileStyle, sourceRect, effectiveDpi, dpiVerdict, exportPrint, CARD_MM } from '../features/image-tools.js';
import { uploadFiles } from './library.js';

const SIZES = [{ rows: 2, cols: 2, label: '2×2' }, { rows: 3, cols: 3, label: '3×3' }, { rows: 3, cols: 4, label: '4×3' }];

export default async function panorama(ctx, main) {
  const db = data();
  let b = await db.getBinder(ctx.params.id);
  if (!b) { navigate('/ficharios'); return; }
  if (!db.capabilities.assets) {
    render(main, html`<div class="page"><div class="state"><div class="state__icon">${icon('image')}</div><h3>Panoramas indisponíveis</h3><p>O editor panorâmico precisa da biblioteca de imagens.</p><a class="btn" href="#/ficharios/${b.id}">Voltar ao fichário</a></div></div>`);
    return;
  }
  const st = {
    page: Math.max(0, Math.min(b.pages.length - 1, (Number(ctx.query.pagina) || 1) - 1)),
    size: SIZES.find((s) => s.cols <= b.pages[0].cols && s.rows <= b.pages[0].rows) || SIZES[0],
    origin: 0, asset: null, url: null,
    t: { x: 0.5, y: 0.5, scale: 1, gap: 4 },
  };
  const page = () => b.pages[st.page];
  const fits = () => st.size.cols <= page().cols && st.size.rows <= page().rows;
  const targetIdx = () => {
    const p = page(); const r0 = Math.floor(st.origin / p.cols); const c0 = st.origin % p.cols;
    const out = [];
    for (let r = 0; r < st.size.rows; r++) for (let c = 0; c < st.size.cols; c++) out.push({ index: (r0 + r) * p.cols + (c0 + c), r, c, valid: r0 + r < p.rows && c0 + c < p.cols });
    return out;
  };
  const conflicts = () => targetIdx().map((t) => {
    if (!t.valid) return 'O bloco ultrapassa a borda da página.';
    const s = page().slots[t.index];
    if (s.locked) return `Bolso ${t.index + 1} está bloqueado.`;
    if (s.kind === 'copy') return `Bolso ${t.index + 1} tem uma carta física.`;
    if (s.kind === 'virtual') return `Bolso ${t.index + 1} tem uma referência virtual.`;
    return null;
  }).filter(Boolean);

  const paint = () => {
    const p = page();
    const area = panoramaArea(st.size.rows, st.size.cols, st.t.gap);
    const targets = new Set(targetIdx().filter((t) => t.valid).map((t) => t.index));
    const cf = conflicts();
    let stage = '';
    if (st.asset) {
      const g = coverGeometry(st.asset.width, st.asset.height, area.w / area.h, st.t);
      const pano = { rows: st.size.rows, cols: st.size.cols, gap: st.t.gap };
      const tiles = [];
      for (let r = 0; r < st.size.rows; r++) for (let c = 0; c < st.size.cols; c++) {
        const reg = tileRegion(pano, r, c);
        const src = sourceRect(st.asset, reg, area.w / area.h, st.t);
        tiles.push({ r, c, reg, dpi: effectiveDpi(src.sw, CARD_MM.w) });
      }
      const minDpi = Math.min(...tiles.map((x) => x.dpi));
      const v = dpiVerdict(minDpi);
      stage = html`<div class="pano-stage" data-stage style="width:min(100%, 640px, calc((100dvh - 300px) * ${(area.w / area.h).toFixed(4)}));aspect-ratio:${area.w}/${area.h}" tabindex="0" aria-label="Composição panorâmica: arraste para posicionar">
          <img src="${st.url}" alt="" draggable="false" style="position:absolute;max-width:none;left:${g.left * 100}%;top:${g.top * 100}%;width:${g.w * 100}%;height:${g.h * 100}%">
          ${tiles.map((x) => html`<span style="position:absolute;left:${x.reg.x * 100}%;top:${x.reg.y * 100}%;width:${x.reg.w * 100}%;height:${x.reg.h * 100}%;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.75);border-radius:3px;pointer-events:none"></span>`)}
          ${st.t.gap ? html`<div style="position:absolute;inset:0;pointer-events:none;background:
            ${[...Array(st.size.cols - 1)].map((_, i) => `linear-gradient(90deg,transparent ${((i + 1) * (CARD_MM.w + st.t.gap) - st.t.gap) / area.w * 100}%,rgba(13,11,18,.62) ${((i + 1) * (CARD_MM.w + st.t.gap) - st.t.gap) / area.w * 100}%,rgba(13,11,18,.62) ${((i + 1) * (CARD_MM.w + st.t.gap)) / area.w * 100}%,transparent ${((i + 1) * (CARD_MM.w + st.t.gap)) / area.w * 100}%)`).concat([...Array(st.size.rows - 1)].map((_, i) => `linear-gradient(180deg,transparent ${((i + 1) * (CARD_MM.h + st.t.gap) - st.t.gap) / area.h * 100}%,rgba(13,11,18,.62) ${((i + 1) * (CARD_MM.h + st.t.gap) - st.t.gap) / area.h * 100}%,rgba(13,11,18,.62) ${((i + 1) * (CARD_MM.h + st.t.gap)) / area.h * 100}%,transparent ${((i + 1) * (CARD_MM.h + st.t.gap)) / area.h * 100}%)`)).join(',') || 'none'}"></div>` : ''}
        </div>
        <p class="pano-dpi text-sm ${v.cls}">${icon('printer')} Pior recorte: ${v.text}</p>`;
    }
    render(main, html`<div class="page page--wide">
      <a class="btn btn--ghost btn--sm" href="#/ficharios/${b.id}?pagina=${st.page + 1}&editar=1" style="margin-bottom:14px">${icon('arrowLeft')} ${b.name}</a>
      <div class="page-head"><div><div class="page-head__eyebrow">Editor panorâmico</div><h1>Arte panorâmica</h1><p>Distribua uma imagem entre vários bolsos. O original não é alterado: cada bolso guarda só a posição do recorte. Exporte em tamanho real para imprimir.</p></div></div>
      <div class="pano-layout">
        <div class="stack stack--lg">
          <div class="pano-stage-wrap">${st.asset ? stage : html`<div class="stack" style="width:100%;max-width:520px">
            <label class="dropzone" data-drop>${icon('upload')}<strong>Envie a arte (ou escolha da biblioteca)</strong><span class="text-xs">PNG, JPEG ou WebP · até 15 MB</span><input type="file" accept="image/png,image/jpeg,image/webp" hidden data-file></label>
            <button class="btn" type="button" data-lib>${icon('image')} Escolher da biblioteca</button></div>`}</div>
          ${st.asset ? html`<section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('eye')} Prévia dos recortes</h2><span class="text-xs muted">como ficará em cada bolso</span></div>
            <div class="pano-tiles" style="grid-template-columns:repeat(${st.size.cols},minmax(0,64px))">${(() => {
    const pano = { rows: st.size.rows, cols: st.size.cols, gap: st.t.gap, ...st.t };
    const out = [];
    for (let r = 0; r < st.size.rows; r++) for (let c = 0; c < st.size.cols; c++) out.push(html`<div class="pocket"><div class="pocket__image"><img src="${st.url}" alt="" style="position:absolute;max-width:none;${panoramaTileStyle(st.asset, pano, r, c)}"></div></div>`);
    return out;
  })()}</div></section>` : ''}
        </div>
        <aside class="stack stack--lg pano-aside">
          <section class="panel stack"><h2 class="panel__title">${icon('layout')} 1 · Bolsos</h2>
            <div class="chips">${SIZES.map((s) => html`<button class="chip" type="button" data-size="${s.label}" aria-pressed="${s === st.size}" ${s.cols <= p.cols && s.rows <= p.rows ? '' : 'disabled title="Maior que a página"'}>${s.label}</button>`)}</div>
            <div class="row row--between text-sm"><button class="btn btn--sm btn--icon" type="button" data-pp ${st.page === 0 ? 'disabled' : ''} aria-label="Página anterior">${icon('chevronLeft')}</button><span>Página ${st.page + 1} · ${p.cols}×${p.rows}</span><button class="btn btn--sm btn--icon" type="button" data-pn ${st.page >= b.pages.length - 1 ? 'disabled' : ''} aria-label="Próxima página">${icon('chevronRight')}</button></div>
            <p class="text-xs muted">Clique no bolso do canto superior esquerdo do bloco.</p>
            <div class="sheet pano-picker" style="--sheet-color:${b.appearance.sheetColor};padding:8px"><div class="sheet__grid" style="--cols:${p.cols};gap:4px">${p.slots.map((s, i) => html`<button type="button" class="pocket ${s.kind === 'empty' ? 'pocket--empty' : ''} ${s.locked ? 'is-locked' : ''} ${targets.has(i) ? 'is-selected' : ''}" data-origin="${i}" aria-label="Iniciar no bolso ${i + 1}" style="cursor:pointer">${s.cardKey ? cardArt(card(s.cardKey)) : html`<span class="pocket__empty-num">${i + 1}</span>`}</button>`)}</div></div>
            ${cf.length ? html`<div class="alert alert--danger">${icon('alert')}<div>${cf[0]}${cf.length > 1 ? ` (+${cf.length - 1})` : ''}</div></div>` : html`<p class="text-xs pano-ok">${icon('check')} Bolsos disponíveis. Fantasmas e imagens nesses bolsos serão substituídos.</p>`}
          </section>
          <section class="panel stack"><h2 class="panel__title">${icon('crop')} 2 · Ajuste</h2>
            ${st.asset ? html`<div class="text-sm muted">${st.asset.name} · ${st.asset.width}×${st.asset.height}px <button class="btn btn--sm btn--ghost" type="button" data-change>Trocar</button></div>` : html`<p class="text-sm muted">Envie ou escolha uma imagem.</p>`}
            <label class="field"><span class="field__label">Zoom</span><input type="range" min="1" max="4" step="0.01" value="${st.t.scale}" data-scale ${st.asset ? '' : 'disabled'}></label>
            <label class="field"><span class="field__label">Espaço entre bolsos: ${st.t.gap} mm</span><input type="range" min="0" max="12" step="0.5" value="${st.t.gap}" data-gap><span class="field__hint">Distância real entre os bolsos do seu fichário, para a arte se alinhar.</span></label>
            <p class="text-xs muted">Arraste a imagem para reposicionar · setas do teclado ajustam fino.</p>
          </section>
          <section class="panel stack"><h2 class="panel__title">${icon('check')} 3 · Aplicar e exportar</h2>
            <button class="btn btn--primary" type="button" data-apply ${st.asset && !cf.length ? '' : 'disabled'}>${icon('sparkles')} Aplicar ao fichário</button>
            <button class="btn" type="button" data-print ${st.asset ? '' : 'disabled'}>${icon('printer')} Exportar para impressão</button>
          </section>
        </aside>
      </div></div>`);
    hydrateImages(main);
    bind();
  };

  const setAsset = async (assetId) => {
    st.asset = (await db.listAssets()).find((a) => a.id === assetId) || null;
    st.url = st.asset ? await assetObjectUrl(st.asset.id) : null;
    st.t = { ...st.t, x: 0.5, y: 0.5, scale: 1 };
    paint();
  };

  const chooseFromLibrary = async () => {
    const list = await db.listAssets();
    if (!list.length) { toast({ type: 'info', text: 'Biblioteca vazia — envie uma imagem.' }); return; }
    const urls = await Promise.all(list.map((a) => assetObjectUrl(a.id)));
    const m = openModal({ title: 'Escolher da biblioteca', size: 'lg', body: html`<div class="asset-grid">${list.map((a, i) => html`<button class="asset" type="button" data-a="${a.id}"><img src="${urls[i]}" alt="${a.name}"><div class="asset__meta"><strong>${a.name}</strong>${a.width}×${a.height}</div></button>`)}</div>` });
    m.body.querySelectorAll('[data-a]').forEach((x) => x.addEventListener('click', () => { m.close(); setAsset(x.dataset.a); }));
  };

  const bind = () => {
    const $ = (q) => main.querySelector(q);
    main.querySelectorAll('[data-size]').forEach((x) => x.addEventListener('click', () => { st.size = SIZES.find((s) => s.label === x.dataset.size); st.origin = 0; paint(); }));
    main.querySelectorAll('[data-origin]').forEach((x) => x.addEventListener('click', () => { st.origin = Number(x.dataset.origin); paint(); }));
    $('[data-pp]')?.addEventListener('click', () => { st.page--; st.origin = 0; if (!fits()) st.size = SIZES[0]; paint(); });
    $('[data-pn]')?.addEventListener('click', () => { st.page++; st.origin = 0; if (!fits()) st.size = SIZES[0]; paint(); });
    $('[data-lib]')?.addEventListener('click', chooseFromLibrary);
    $('[data-change]')?.addEventListener('click', () => { st.asset = null; paint(); });
    const file = $('[data-file]');
    file?.addEventListener('change', async () => { const up = await uploadFiles([...file.files].slice(0, 1)); if (up[0]) setAsset(up[0].id); });
    const dz = $('[data-drop]');
    dz?.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-over'); });
    dz?.addEventListener('drop', async (e) => { e.preventDefault(); const up = await uploadFiles([...e.dataTransfer.files].slice(0, 1)); if (up[0]) setAsset(up[0].id); });
    $('[data-scale]')?.addEventListener('input', (e) => { st.t.scale = Number(e.target.value); repaintStage(); });
    $('[data-gap]')?.addEventListener('change', (e) => { st.t.gap = Number(e.target.value); paint(); });
    $('[data-apply]')?.addEventListener('click', applyToBinder);
    $('[data-print]')?.addEventListener('click', printDialog);
    const stage = $('[data-stage]');
    if (stage) {
      let drag = null;
      stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, tx: st.t.x, ty: st.t.y }; stage.setPointerCapture(e.pointerId); });
      stage.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const area = panoramaArea(st.size.rows, st.size.cols, st.t.gap);
        const g = coverGeometry(st.asset.width, st.asset.height, area.w / area.h, st.t);
        const r = stage.getBoundingClientRect();
        const ox = (g.w - 1) * r.width; const oy = (g.h - 1) * r.height;
        st.t.x = ox > 0 ? Math.min(1, Math.max(0, drag.tx - (e.clientX - drag.x) / ox)) : 0.5;
        st.t.y = oy > 0 ? Math.min(1, Math.max(0, drag.ty - (e.clientY - drag.y) / oy)) : 0.5;
        repaintStage(false);
      });
      stage.addEventListener('pointerup', () => { drag = null; paint(); });
      stage.addEventListener('keydown', (e) => {
        const d = 0.02;
        if (e.key === 'ArrowLeft') st.t.x = Math.max(0, st.t.x - d); else if (e.key === 'ArrowRight') st.t.x = Math.min(1, st.t.x + d);
        else if (e.key === 'ArrowUp') st.t.y = Math.max(0, st.t.y - d); else if (e.key === 'ArrowDown') st.t.y = Math.min(1, st.t.y + d); else return;
        e.preventDefault(); repaintStage();
      });
    }
  };

  // atualização leve da imagem durante o arraste (sem refazer a tela inteira)
  const repaintStage = (full = true) => {
    const img = main.querySelector('[data-stage] img');
    if (img && st.asset) {
      const area = panoramaArea(st.size.rows, st.size.cols, st.t.gap);
      const g = coverGeometry(st.asset.width, st.asset.height, area.w / area.h, st.t);
      Object.assign(img.style, { left: `${g.left * 100}%`, top: `${g.top * 100}%`, width: `${g.w * 100}%`, height: `${g.h * 100}%` });
    }
    if (full) { clearTimeout(repaintStage.t); repaintStage.t = setTimeout(paint, 250); }
  };

  const applyToBinder = async () => {
    const p = page(); const id = uid('pano_');
    const ops = targetIdx().map((t) => ({ op: 'set', pageId: p.id, index: t.index, slot: { kind: 'image', assetId: st.asset.id, panorama: { id, rows: st.size.rows, cols: st.size.cols, row: t.r, col: t.c, gap: st.t.gap, x: st.t.x, y: st.t.y, scale: st.t.scale } } }));
    try {
      const res = await db.binderOps(b.id, ops, { expectedVersion: b.version, label: 'Arte panorâmica' });
      b = res.binder; changed('binders');
      toast({ type: 'success', title: 'Panorama aplicado', text: `${ops.length} bolsos preenchidos na página ${st.page + 1}. Imagens não contam como cartas possuídas.` });
      navigate(`/ficharios/${b.id}?pagina=${st.page + 1}`);
    } catch (e) { toastError(e); }
  };

  const printDialog = () => {
    const m = openModal({
      title: 'Exportar para impressão',
      body: html`<form class="form-grid" data-f>
        <label class="field"><span class="field__label">Papel</span><select class="select" name="paper"><option value="A4">A4 (210×297 mm)</option><option value="Letter">Carta (216×279 mm)</option></select></label>
        <label class="field"><span class="field__label">DPI de saída</span><select class="select" name="dpi"><option>300</option><option>600</option><option>150</option></select></label>
        <label class="field"><span class="field__label">Largura da carta (mm)</span><input class="input" type="number" step="0.1" name="w" value="63"></label>
        <label class="field"><span class="field__label">Altura da carta (mm)</span><input class="input" type="number" step="0.1" name="h" value="88"></label>
        <label class="field"><span class="field__label">Calibração (%)</span><input class="input" type="number" step="0.1" name="cal" value="100"><span class="field__hint">Use a página de calibração para corrigir a escala da sua impressora.</span></label>
        <label class="field"><span class="field__label">Margem do papel (mm)</span><input class="input" type="number" step="0.5" name="margin" value="8"></label>
        <label class="field"><span class="field__label">Espaço entre recortes (mm)</span><input class="input" type="number" step="0.5" name="spacing" value="4"></label>
        <label class="checkbox span-2"><input type="checkbox" name="marks" checked> Marcas de corte</label>
        <p class="text-xs muted span-2">Abre uma página pronta para imprimir ou “Salvar como PDF” no navegador. A nitidez final depende da resolução da imagem enviada — não há ganho real de qualidade acima dela.</p>
      </form>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>${icon('printer')} Gerar impressão</button>`,
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
      const fd = new FormData(m.body.querySelector('form'));
      e.target.disabled = true;
      try {
        const blob = await db.getAssetBlob(st.asset.id);
        const pano = { rows: st.size.rows, cols: st.size.cols, gap: st.t.gap };
        const area = panoramaArea(pano.rows, pano.cols, pano.gap);
        const tiles = [];
        for (let r = 0; r < pano.rows; r++) for (let c = 0; c < pano.cols; c++) tiles.push({ asset: st.asset, blob, region: tileRegion(pano, r, c), areaRatio: area.w / area.h, transform: st.t, label: `L${r + 1}C${c + 1}` });
        const res = await exportPrint(tiles, { paper: fd.get('paper'), dpi: Number(fd.get('dpi')), cardW: Number(fd.get('w')) || 63, cardH: Number(fd.get('h')) || 88, calibration: Number(fd.get('cal')) || 100, marginMm: Number(fd.get('margin')) || 8, spacing: Number(fd.get('spacing')) || 0, cutMarks: !!fd.get('marks') });
        toast({ type: 'success', text: `Impressão gerada: ${res.pages} folha(s), ${res.perPage} recorte(s) por folha.` });
        m.close();
      } catch (err) { toastError(err); e.target.disabled = false; }
    });
  };

  paint();
}
