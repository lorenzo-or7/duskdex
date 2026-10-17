// Estado de conservação das cartas físicas (padrão do mercado de TCG), do melhor ao pior.
import { html } from '../core/html.js';

export const CONDITIONS = [
  { id: 'M', label: 'Mint', pt: 'Perfeita', hint: 'Sem nenhum defeito, como saiu do pacote.' },
  { id: 'NM', label: 'Near Mint', pt: 'Quase perfeita', hint: 'Marcas mínimas, só vistas de perto.' },
  { id: 'SP', label: 'Slightly Played', pt: 'Pouco jogada', hint: 'Pequenos desgastes nas bordas ou cantos.' },
  { id: 'MP', label: 'Moderately Played', pt: 'Jogada', hint: 'Desgaste visível, arranhões leves.' },
  { id: 'HP', label: 'Heavily Played', pt: 'Muito jogada', hint: 'Desgaste forte, vincos leves.' },
  { id: 'D', label: 'Damaged', pt: 'Danificada', hint: 'Dobras, pequenos rasgos ou manchas.' },
  { id: 'HD', label: 'Hard Damaged', pt: 'Muito danificada', hint: 'Danos graves (rasgos, água, recortes).' },
];
export const CONDITION_IDS = CONDITIONS.map((c) => c.id);
export const conditionOf = (id) => CONDITIONS.find((c) => c.id === id) || CONDITIONS[1];

/** Selo do estado (ex.: “NM”), com o nome completo na dica. Cor por faixa: ótimo, bom, jogado, danificado. */
export function conditionBadge(id, { long = false } = {}) {
  const c = conditionOf(id);
  const tier = ['M', 'NM'].includes(c.id) ? 'top' : c.id === 'SP' ? 'good' : ['MP', 'HP'].includes(c.id) ? 'played' : 'damaged';
  return html`<span class="cond-badge cond-badge--${tier}" title="${c.id} · ${c.label} (${c.pt}): ${c.hint}">${c.id}${long ? html` <span class="cond-badge__long">${c.label}</span>` : ''}</span>`;
}
