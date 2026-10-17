// Imagens próprias: validação real do arquivo, recortes não destrutivos, panoramas e exportação para impressão.
// O arquivo original NUNCA é alterado: recortes guardam apenas parâmetros (x, y, escala).
import { DomainError } from '../api/errors.js';

export const CARD_MM = { w: 63, h: 88 };
export const MAX_BYTES = 15 * 1024 * 1024;
const MIN_SIDE = 200;
const MAX_SIDE = 12000;

/** Valida tipo REAL (assinatura de bytes), peso e dimensões. */
export async function validateImageFile(file) {
  if (!file) throw new DomainError('VALIDATION', 'Nenhum arquivo selecionado.');
  if (file.size > MAX_BYTES) throw new DomainError('VALIDATION', `Arquivo muito grande (${(file.size / 1048576).toFixed(1)} MB). O limite é 15 MB.`);
  if (file.size < 100) throw new DomainError('VALIDATION', 'Arquivo vazio ou corrompido.');
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isWebp = String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
  const mime = isPng ? 'image/png' : isJpg ? 'image/jpeg' : isWebp ? 'image/webp' : null;
  if (!mime) throw new DomainError('VALIDATION', 'Formato não suportado. Envie PNG, JPEG ou WebP (o tipo é verificado pelo conteúdo, não pela extensão).');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new DomainError('VALIDATION', 'Não foi possível decodificar a imagem. O arquivo pode estar corrompido.'); }
  const { width, height } = bmp;
  bmp.close?.();
  if (Math.min(width, height) < MIN_SIDE) throw new DomainError('VALIDATION', `Imagem pequena demais (${width}×${height}). Use ao menos ${MIN_SIDE}px no menor lado.`);
  if (Math.max(width, height) > MAX_SIDE) throw new DomainError('VALIDATION', `Imagem grande demais (${width}×${height}). Máximo ${MAX_SIDE}px por lado.`);
  return { mime, width, height };
}

/**
 * Geometria de "cover" + transformação.
 * Área alvo com proporção `areaRatio` (largura/altura). Retorna tamanho e posição da imagem
 * em frações da área (1 = 100%). x/y ∈ [0,1] (0.5 = centralizado), scale ≥ 1.
 */
export function coverGeometry(imgW, imgH, areaRatio, { x = 0.5, y = 0.5, scale = 1 } = {}) {
  const a = imgW / imgH;
  let w; let h;
  if (a > areaRatio) { h = 1; w = a / areaRatio; } else { w = 1; h = areaRatio / a; }
  w *= scale; h *= scale;
  return { w, h, left: (1 - w) * x, top: (1 - h) * y };
}

/** Estilo inline (left/top/width/height em %) para um <img> dentro de um bolso, recorte individual. */
export function cropStyle(asset, crop = {}) {
  const g = coverGeometry(asset.width, asset.height, CARD_MM.w / CARD_MM.h, crop);
  return `left:${(g.left * 100).toFixed(3)}%;top:${(g.top * 100).toFixed(3)}%;width:${(g.w * 100).toFixed(3)}%;height:${(g.h * 100).toFixed(3)}%`;
}

/** Dimensões (mm) da composição panorâmica, considerando o espaço entre bolsos. */
export function panoramaArea(rows, cols, gapMm = 4, card = CARD_MM) {
  return { w: cols * card.w + (cols - 1) * gapMm, h: rows * card.h + (rows - 1) * gapMm };
}

/** Região de um bolso (linha r, coluna c) dentro da composição, em frações. */
export function tileRegion(p, r, c, card = CARD_MM) {
  const area = panoramaArea(p.rows, p.cols, p.gap, card);
  return { x: (c * (card.w + p.gap)) / area.w, y: (r * (card.h + p.gap)) / area.h, w: card.w / area.w, h: card.h / area.h, area };
}

/** Estilo do <img> para exibir o recorte de um bolso de um panorama. */
export function panoramaTileStyle(asset, p, r, c) {
  const reg = tileRegion(p, r, c);
  const g = coverGeometry(asset.width, asset.height, reg.area.w / reg.area.h, p);
  const left = (g.left - reg.x) / reg.w; const top = (g.top - reg.y) / reg.h;
  return `left:${(left * 100).toFixed(3)}%;top:${(top * 100).toFixed(3)}%;width:${((g.w / reg.w) * 100).toFixed(3)}%;height:${((g.h / reg.h) * 100).toFixed(3)}%`;
}

/** Retângulo de origem (px da imagem original) de um recorte — usado na impressão e no cálculo de DPI. */
export function sourceRect(asset, regionFrac, areaRatio, t) {
  const g = coverGeometry(asset.width, asset.height, areaRatio, t);
  return {
    sx: ((regionFrac.x - g.left) / g.w) * asset.width,
    sy: ((regionFrac.y - g.top) / g.h) * asset.height,
    sw: (regionFrac.w / g.w) * asset.width,
    sh: (regionFrac.h / g.h) * asset.height,
  };
}

/** DPI efetivo de impressão para um recorte que ocupa `mmW` milímetros de largura. */
export const effectiveDpi = (srcPxW, mmW) => Math.round(srcPxW / (mmW / 25.4));
export function dpiVerdict(dpi) {
  if (dpi >= 280) return { cls: 'dpi-ok', text: `${dpi} DPI · ótimo para impressão` };
  if (dpi >= 180) return { cls: 'dpi-warn', text: `${dpi} DPI · aceitável, pode perder nitidez` };
  return { cls: 'dpi-bad', text: `${dpi} DPI · baixa resolução, a impressão ficará borrada` };
}

/**
 * Gera uma página de impressão (A4/Carta) em nova janela, com recortes em tamanho real.
 * tiles: [{ asset, blob, region, areaRatio, transform, label }]
 * opts: { paper: 'A4'|'Letter', cardW, cardH, dpi, cutMarks, spacing, marginMm, calibration }
 */
export async function exportPrint(tiles, opts) {
  const paper = opts.paper === 'Letter' ? { w: 215.9, h: 279.4, name: 'Letter' } : { w: 210, h: 297, name: 'A4' };
  const cw = opts.cardW * (opts.calibration / 100); const ch = opts.cardH * (opts.calibration / 100);
  const pxW = Math.round((cw / 25.4) * opts.dpi); const pxH = Math.round((ch / 25.4) * opts.dpi);
  const win = window.open('', '_blank');
  if (!win) throw new DomainError('POPUP', 'O navegador bloqueou a janela de impressão. Permita pop-ups para este site.');
  win.document.write('<!doctype html><title>Preparando impressão…</title><body style="font-family:sans-serif;padding:40px">Preparando recortes em alta resolução…</body>');

  const bitmaps = new Map();
  const images = [];
  for (const t of tiles) {
    if (!bitmaps.has(t.asset.id)) bitmaps.set(t.asset.id, await createImageBitmap(t.blob));
    const bmp = bitmaps.get(t.asset.id);
    const src = sourceRect(t.asset, t.region, t.areaRatio, t.transform);
    const canvas = document.createElement('canvas');
    canvas.width = pxW; canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pxW, pxH);
    ctx.drawImage(bmp, src.sx, src.sy, src.sw, src.sh, 0, 0, pxW, pxH);
    images.push({ url: canvas.toDataURL('image/png'), label: t.label, dpi: effectiveDpi(src.sw, cw) });
  }

  const usableW = paper.w - opts.marginMm * 2; const usableH = paper.h - opts.marginMm * 2;
  const perRow = Math.max(1, Math.floor((usableW + opts.spacing) / (cw + opts.spacing)));
  const perCol = Math.max(1, Math.floor((usableH + opts.spacing) / (ch + opts.spacing)));
  const perPage = perRow * perCol;
  const pages = [];
  for (let i = 0; i < images.length; i += perPage) pages.push(images.slice(i, i + perPage));
  // Marcas de corte: linhas finas fora da área da carta, nos quatro cantos.
  const mark = opts.cutMarks ? `.m{position:absolute;background:#000}.h{height:.15mm;width:3mm}.v{width:.15mm;height:3mm}
    .tl1{top:0;left:-4mm}.tl2{left:0;top:-4mm}.tr1{top:0;right:-4mm}.tr2{right:0;top:-4mm}
    .bl1{bottom:0;left:-4mm}.bl2{left:0;bottom:-4mm}.br1{bottom:0;right:-4mm}.br2{right:0;bottom:-4mm}` : '';
  const marks = opts.cutMarks ? '<i class="m h tl1"></i><i class="m v tl2"></i><i class="m h tr1"></i><i class="m v tr2"></i><i class="m h bl1"></i><i class="m v bl2"></i><i class="m h br1"></i><i class="m v br2"></i>' : '';
  const doc = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DuskDex — impressão de artes</title>
<style>@page{size:${paper.name};margin:0}*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#ddd}
.sheet{width:${paper.w}mm;height:${paper.h}mm;padding:${opts.marginMm}mm;background:#fff;margin:10mm auto;display:grid;grid-template-columns:repeat(${perRow},${cw}mm);grid-auto-rows:${ch}mm;gap:${opts.spacing}mm;align-content:start;page-break-after:always;position:relative}
.t{position:relative;width:${cw}mm;height:${ch}mm}.t img{width:100%;height:100%;display:block}${mark}
.bar{position:sticky;top:0;background:#15111D;color:#F3EDF4;padding:12px 18px;display:flex;gap:14px;align-items:center;font-size:14px;z-index:5}
.bar button{background:#9E79BC;color:#140F1A;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer}
@media print{body{background:#fff}.bar{display:none}.sheet{margin:0}}</style></head><body>
<div class="bar"><button type="button" data-print>Imprimir / salvar PDF</button><span>${images.length} recorte(s) · ${cw.toFixed(1)}×${ch.toFixed(1)} mm · ${opts.dpi} DPI de saída · papel ${paper.name}. Imprima em <b>tamanho real (100%)</b>, sem “ajustar à página”.</span></div>
${pages.map((pg) => `<section class="sheet">${pg.map((im) => `<div class="t"><img src="${im.url}" alt="">${marks}</div>`).join('')}</section>`).join('')}
<section class="sheet" style="display:block"><h3 style="margin:0 0 6mm">Página de calibração</h3><div style="width:50mm;height:50mm;border:.3mm solid #000;display:grid;place-items:center">50 × 50 mm</div><p style="font-size:11pt">Meça o quadrado com uma régua. Se não tiver 50 mm, ajuste a “calibração” no editor (ex.: 49 mm → 102%).</p>
<p style="font-size:10pt;color:#555">A qualidade final depende da resolução da imagem enviada. DPI efetivo por recorte: ${images.map((im) => `${im.label}: ${im.dpi}`).join(' · ')}.</p></section>
</body></html>`;
  win.document.open(); win.document.write(doc); win.document.close();
  // sem handler inline (bloqueado pela política de segurança do site)
  win.document.querySelector('[data-print]')?.addEventListener('click', () => win.print());
  bitmaps.forEach((b) => b.close?.());
  return { pages: pages.length, perPage };
}
