// Rodapé do site: assinatura Or7 do autor + avisos de marca e copyright.
import { html } from '../core/html.js';

export function siteFooter({ variant = 'app' } = {}) {
  const year = new Date().getFullYear();
  return html`<footer class="site-footer site-footer--${variant}">
    <div class="site-footer__inner">
      <div class="site-footer__sig">
        <img class="site-footer__mark site-footer__mark--dark" src="assets/logos/or7-signature-dark.webp" width="900" height="121" alt="Or7 — idealizado e desenvolvido por Lorenzo Orsetti" loading="lazy">
        <img class="site-footer__mark site-footer__mark--light" src="assets/logos/or7-signature-light.webp" width="900" height="121" alt="Or7 — idealizado e desenvolvido por Lorenzo Orsetti" loading="lazy">
      </div>
      ${variant === 'welcome' ? html`<div class="site-footer__legal">
        <p><a href="#/ajuda">Perguntas frequentes</a> · <a href="#/sobre">Conheça o DuskDex</a></p>
        <p>© ${year} DuskDex · Projeto independente de fãs, sem afiliação com Nintendo, Creatures Inc., GAME FREAK inc. ou The Pokémon Company. Pokémon é marca registrada da Nintendo.</p>
      </div>` : html`<div class="site-footer__legal">
        <p><a href="#/ajuda">Perguntas frequentes</a> — o que o DuskDex ainda não faz, cartas sem foto, conta e trocas.</p>
        <p>© ${year} DuskDex. Projeto independente de fãs, sem afiliação, patrocínio ou endosso da Nintendo, Creatures Inc., GAME FREAK inc. ou The Pokémon Company.</p>
        <p>© ${year} Pokémon. © 1995–${year} Nintendo / Creatures Inc. / GAME FREAK inc. Pokémon e os nomes dos personagens Pokémon são marcas registradas da Nintendo. Dados e imagens de cartas: <a href="https://tcgdex.dev/" target="_blank" rel="noopener">TCGdex</a>.</p>
      </div>`}
    </div>
  </footer>`;
}
