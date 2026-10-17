// Fontes alternativas para qualquer <img>: `data-fallbacks="url2|url3"`.
// Quando a imagem falha, troca para a próxima fonte antes que os tratadores da própria imagem
// rodem (fase de captura no documento). Só quando a lista acaba o erro segue adiante — e aí cada
// tela mostra o seu substituto (nome da expansão, carta desenhada etc.).
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.fallbacks) return;
  const [next, ...rest] = img.dataset.fallbacks.split('|').filter(Boolean);
  if (rest.length) img.dataset.fallbacks = rest.join('|'); else delete img.dataset.fallbacks;
  if (!next) return;
  e.stopImmediatePropagation();
  img.src = next;
}, true);

/** Atributos de uma imagem com várias fontes: o primeiro vira `src`, o resto vira `data-fallbacks`. */
export const sourcesOf = (urls) => {
  const list = [...new Set((urls || []).filter(Boolean))];
  return { src: list[0] || '', fallbacks: list.slice(1).join('|') };
};
