import { html, render, formatBytes, formatDate } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, changed } from '../api/index.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { assetObjectUrl } from '../components/card.js';
import { validateImageFile, cropStyle, effectiveDpi, dpiVerdict, coverGeometry, CARD_MM } from '../features/image-tools.js';
import { on } from '../core/events.js';

/** Envia arquivos para a biblioteca (validando tipo real, peso e dimensões). */
export async function uploadFiles(files) {
  const db = data();
  const out = [];
  for (const f of files) {
    try {
      const v = await validateImageFile(f);
      out.push(await db.addAsset({ blob: f, name: f.name, width: v.width, height: v.height, mime: v.mime }));
    } catch (e) { toastError(e, `“${f.name}” não foi enviado`); }
  }
  if (out.length) { changed('assets'); toast({ type: 'success', text: `${out.length} imagem(ns) adicionada(s) à biblioteca${db.mode === 'demo' ? ' (salvas neste navegador)' : ''}.` }); }
  return out;
}

function dropzone(label = 'Arraste imagens aqui ou clique para escolher') {
  return html`<label class="dropzone" data-drop>${icon('upload')}<strong>${label}</strong><span class="text-xs">PNG, JPEG ou WebP · até 15 MB · mínimo 200 px</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden data-file></label>`;
}
function bindDrop(root, onFiles) {
  const dz = root.querySelector('[data-drop]'); const input = root.querySelector('[data-file]');
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('is-over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('is-over'); onFiles([...e.dataTransfer.files]); });
}

async function assetGrid(list, selected = null) {
  const urls = await Promise.all(list.map((a) => assetObjectUrl(a.id)));
  return html`<div class="asset-grid">${list.map((a, i) => html`<button type="button" class="asset" data-asset="${a.id}" aria-pressed="${a.id === selected}">
    <img src="${urls[i] || ''}" alt="${a.name}" loading="lazy"><div class="asset__meta"><strong>${a.name}</strong>${a.width}×${a.height} · ${formatBytes(a.size)}</div></button>`)}</div>`;
}

/**
 * Editor de recorte individual (não destrutivo). A imagem inteira aparece no fundo e a área da carta
 * (63×88 mm) fica em destaque; fora dela, escurecido. Arrastar posiciona; roda do mouse, pinça,
 * botões −/+ ou o controle ajustam o zoom; duplo clique volta ao enquadramento inicial.
 * Salva só posição e zoom ({ x, y, scale }); o arquivo original não é alterado.
 */
export function cropEditor(asset, initial = { x: 0.5, y: 0.5, scale: 1 }) {
  return new Promise(async (resolve) => {
    let result = null;
    const MAX = 5;
    const t = { x: initial.x ?? 0.5, y: initial.y ?? 0.5, scale: initial.scale ?? 1 };
    const url = await assetObjectUrl(asset.id);
    const m = openModal({
      title: 'Recortar imagem para o bolso', size: 'lg',
      body: html`<div class="cropper">
        <div class="cropper__viewport" data-vp tabindex="0" aria-label="Área de recorte. Arraste para posicionar; use + e − para zoom e as setas para ajuste fino.">
          <div class="cropper__frame" data-frame><img data-img src="${url}" alt="" draggable="false"></div>
          <div class="cropper__mask" aria-hidden="true"></div>
        </div>
        <div class="cropper__side">
          <div class="cropper__preview-wrap"><span class="field__label">Resultado no bolso</span>
            <div class="cropper__preview"><img data-prev src="${url}" alt="Prévia do recorte" draggable="false"></div></div>
          <div class="field"><span class="field__label">Zoom <span class="muted" data-zoomval></span></span>
            <div class="cropper__zoom">
              <button class="btn btn--icon btn--sm" type="button" data-zoom="-1" aria-label="Diminuir zoom">${icon('minus')}</button>
              <input type="range" min="1" max="${MAX}" step="0.01" value="${t.scale}" data-scale aria-label="Zoom">
              <button class="btn btn--icon btn--sm" type="button" data-zoom="1" aria-label="Aumentar zoom">${icon('plus')}</button>
            </div></div>
          <div class="btn-group"><button class="btn btn--sm" type="button" data-fit>${icon('refresh')} Enquadrar inteira</button><button class="btn btn--sm" type="button" data-center>${icon('target')} Centralizar</button></div>
          <div class="dpi-pill" data-dpi></div>
          <p class="text-xs muted">Arraste a imagem para posicionar · roda do mouse ou pinça para aproximar · duplo clique reinicia. O arquivo original não é alterado.</p>
        </div>
      </div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>Aplicar recorte</button>`,
      onClose: () => resolve(result),
    });
    const vp = m.body.querySelector('[data-vp]'); const frame = m.body.querySelector('[data-frame]');
    const img = m.body.querySelector('[data-img]'); const prev = m.body.querySelector('[data-prev]');
    const scaleIn = m.body.querySelector('[data-scale]');
    const ratio = CARD_MM.w / CARD_MM.h;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    const upd = () => {
      t.scale = clamp(t.scale, 1, MAX); t.x = clamp(t.x, 0, 1); t.y = clamp(t.y, 0, 1);
      const style = `position:absolute;max-width:none;${cropStyle(asset, t)}`;
      img.setAttribute('style', style); prev.setAttribute('style', style);
      scaleIn.value = String(t.scale);
      m.body.querySelector('[data-zoomval]').textContent = `${Math.round(t.scale * 100)}%`;
      const g = coverGeometry(asset.width, asset.height, ratio, t);
      const v = dpiVerdict(effectiveDpi(asset.width / g.w, CARD_MM.w));
      const label = v.cls === 'dpi-ok' ? 'ótima' : v.cls === 'dpi-warn' ? 'aceitável' : 'baixa';
      render(m.body.querySelector('[data-dpi]'), html`<span class="dpi-pill__badge ${v.cls}">${icon('printer')} Impressão: ${label}</span>
        <span class="text-xs muted">${v.text.split(' · ')[0]} no tamanho real da carta (63×88 mm)${v.cls === 'dpi-bad' ? ' — diminua o zoom ou use uma imagem maior' : ''}.</span>`);
    };

    // Enquadra a janela da carta dentro da área visível, deixando a imagem aparecer em volta.
    const layout = () => {
      const r = vp.getBoundingClientRect();
      const h = Math.min(r.height * 0.8, (r.width * 0.62) / ratio);
      frame.style.width = `${h * ratio}px`; frame.style.height = `${h}px`;
      vp.style.setProperty('--fw', `${h * ratio}px`); vp.style.setProperty('--fh', `${h}px`);
    };
    new ResizeObserver(layout).observe(vp);
    layout();

    // Arrastar (1 ponteiro) e pinça (2 ponteiros)
    const pts = new Map(); let drag = null; let pinch = null;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    vp.addEventListener('pointerdown', (e) => {
      vp.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
      if (pts.size === 2) { drag = null; pinch = { d: dist(), s: t.scale }; }
      vp.classList.add('is-dragging');
    });
    vp.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) { t.scale = pinch.s * (dist() / pinch.d); upd(); return; }
      if (!drag) return;
      const fw = frame.offsetWidth; const fh = frame.offsetHeight;
      const g = coverGeometry(asset.width, asset.height, ratio, t);
      const ox = (g.w - 1) * fw; const oy = (g.h - 1) * fh;
      t.x = ox > 0 ? drag.tx - (e.clientX - drag.x) / ox : 0.5;
      t.y = oy > 0 ? drag.ty - (e.clientY - drag.y) / oy : 0.5;
      upd();
    });
    const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; vp.classList.remove('is-dragging'); } };
    vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
    vp.addEventListener('wheel', (e) => { e.preventDefault(); t.scale *= Math.exp(-e.deltaY * 0.0015); upd(); }, { passive: false });
    vp.addEventListener('dblclick', () => { t.x = 0.5; t.y = 0.5; t.scale = 1; upd(); });
    vp.addEventListener('keydown', (e) => {
      const d = 0.02 / t.scale;
      if (e.key === 'ArrowLeft') t.x -= d; else if (e.key === 'ArrowRight') t.x += d;
      else if (e.key === 'ArrowUp') t.y -= d; else if (e.key === 'ArrowDown') t.y += d;
      else if (e.key === '+' || e.key === '=') t.scale *= 1.1; else if (e.key === '-') t.scale /= 1.1; else return;
      e.preventDefault(); upd();
    });
    scaleIn.addEventListener('input', () => { t.scale = Number(scaleIn.value); upd(); });
    m.body.querySelectorAll('[data-zoom]').forEach((bt) => bt.addEventListener('click', () => { t.scale *= Number(bt.dataset.zoom) > 0 ? 1.15 : 1 / 1.15; upd(); }));
    m.body.querySelector('[data-fit]').addEventListener('click', () => { t.x = 0.5; t.y = 0.5; t.scale = 1; upd(); });
    m.body.querySelector('[data-center]').addEventListener('click', () => { t.x = 0.5; t.y = 0.5; upd(); });
    m.foot.querySelector('[data-ok]').addEventListener('click', () => { result = { x: t.x, y: t.y, scale: t.scale }; m.close(); });
    upd();
    vp.focus({ preventScroll: true });
  });
}

/** Escolhe (ou envia) uma imagem e recorta para um bolso. Retorna { assetId, crop } ou null. */
export async function chooseImageForSlot(slot, { assetId = null } = {}) {
  const db = data();
  if (!db.capabilities.assets) { toast({ type: 'info', text: 'Imagens personalizadas não estão disponíveis neste modo.' }); return null; }
  let chosen = assetId;
  if (!chosen) {
    chosen = await new Promise(async (resolve) => {
      let r = null;
      const list = await db.listAssets();
      const m = openModal({ title: 'Imagem para o bolso', size: 'lg', body: html`<div class="stack stack--lg">${dropzone()}<div data-grid></div></div>`, onClose: () => resolve(r) });
      const paintGrid = async () => {
        const all = await db.listAssets();
        render(m.body.querySelector('[data-grid]'), all.length ? html`<h3 class="field__label" style="margin-bottom:8px">Biblioteca (${all.length})</h3>${await assetGrid(all)}` : html`<p class="muted text-sm">Sua biblioteca está vazia — envie uma imagem acima.</p>`);
        m.body.querySelectorAll('[data-asset]').forEach((b) => b.addEventListener('click', () => { r = b.dataset.asset; m.close(); }));
      };
      bindDrop(m.body, async (files) => { const up = await uploadFiles(files.slice(0, 1)); if (up[0]) { r = up[0].id; m.close(); } });
      void list; paintGrid();
    });
  }
  if (!chosen) return null;
  const asset = (await db.listAssets()).find((a) => a.id === chosen);
  if (!asset) return null;
  const crop = await cropEditor(asset, slot?.assetId === chosen && slot.crop ? slot.crop : undefined);
  return crop ? { assetId: chosen, crop } : null;
}

export default async function library(ctx, main) {
  const db = data();
  const paint = async () => {
    const list = await db.listAssets();
    const est = await db.storageEstimate();
    const total = list.reduce((n, a) => n + (a.size || 0), 0);
    render(main, html`<div class="page">
      <div class="page-head"><div><div class="page-head__eyebrow">Artes personalizadas</div><h1>Biblioteca de imagens</h1><p>Imagens enviadas para bolsos individuais, capas e panoramas. Os originais são preservados sem alteração.</p></div>
        <a class="btn" href="#/ficharios">${icon('book')} Fichários</a></div>
      ${!db.capabilities.assets ? html`<div class="alert alert--warning">${icon('info')}<div>A biblioteca de imagens não está disponível neste modo.</div></div>` : html`
      <div class="stack stack--lg">
        ${dropzone()}
        <div class="row text-sm muted">${icon('database')}<span>${list.length} imagem(ns) · ${formatBytes(total)} na biblioteca${est?.quota ? ` · navegador usando ${formatBytes(est.usage)} de ~${formatBytes(est.quota)} disponíveis` : ''}</span></div>
        ${list.length ? await assetGrid(list) : html`<div class="state"><div class="state__icon">${icon('image')}</div><h3>Nenhuma imagem ainda</h3><p>Envie artes para preencher bolsos vazios ou montar panoramas de 2×2 a 4×3.</p></div>`}
      </div>`}
    </div>`);
    if (!db.capabilities.assets) return;
    bindDrop(main, async (files) => { await uploadFiles(files); paint(); });
    main.querySelectorAll('[data-asset]').forEach((b) => b.addEventListener('click', async () => {
      const a = list.find((x) => x.id === b.dataset.asset);
      const uses = await db.assetUsage(a.id);
      const m = openModal({
        title: a.name, size: 'lg',
        body: html`<div class="stack"><img src="${await assetObjectUrl(a.id)}" alt="${a.name}" style="max-height:50vh;margin:0 auto;border-radius:10px">
          <dl class="attr-grid"><div class="attr"><dt>Dimensões</dt><dd>${a.width}×${a.height}px</dd></div><div class="attr"><dt>Tamanho</dt><dd>${formatBytes(a.size)}</dd></div><div class="attr"><dt>Tipo</dt><dd>${a.mime}</dd></div><div class="attr"><dt>Enviada</dt><dd>${formatDate(a.createdAt)}</dd></div></dl>
          <div><h3 class="field__label" style="margin-bottom:6px">Em uso</h3>${uses.length ? html`<div class="locs">${uses.map((u) => html`<a class="loc-line" href="#/ficharios/${u.binder.id}">${icon('book')}<span class="grow">${u.binder.name} · ${u.where}</span></a>`)}</div>` : html`<p class="muted text-sm">Não está em nenhum fichário.</p>`}</div></div>`,
        footer: html`<button class="btn btn--danger" type="button" data-del ${uses.length ? 'disabled title="Remova dos fichários antes"' : ''}>${icon('trash')} Excluir</button><span class="spacer"></span><button class="btn" type="button" data-close>Fechar</button>`,
      });
      m.body.querySelectorAll('a').forEach((x) => x.addEventListener('click', () => m.close()));
      m.foot.querySelector('[data-del]').addEventListener('click', async () => {
        if (!await confirmDialog({ title: 'Excluir imagem?', message: 'A imagem original será apagada da biblioteca.', danger: true, confirmLabel: 'Excluir' })) return;
        try { await db.deleteAsset(a.id); m.close(); paint(); } catch (e) { toastError(e); }
      });
    }));
  };
  await paint();
  return on('data:changed', (s) => { if (s === 'assets') paint(); });
}
