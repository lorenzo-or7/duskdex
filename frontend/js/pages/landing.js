import { html, render } from '../core/html.js';
import { icon } from '../core/icons.js';
import { themeToggle, initThemeToggles } from '../core/theme.js';
import { cardArt, hydrateImages } from '../components/card.js';
import { SEED_CARDS } from '../features/seed.js';
import { siteFooter } from '../components/footer.js';

const C = (id) => SEED_CARDS.find((c) => c.id === id);

function miniBinder() {
  const ids = ['base1-15', 'base1-4', 'base1-2', 'base1-1', 'base1-10', 'base1-16', 'base1-6', null, 'base1-14'];
  return html`<div class="book book--single" style="--binder-color:#4b2f5e;width:100%;max-width:440px">
    <div class="sheet"><div class="sheet__label"><span>Kanto Clássico</span><span>Pág. 1</span></div>
      <div class="sheet__grid" style="--cols:3">
        ${ids.map((id, i) => id ? html`<div class="pocket pocket--filled ${i === 4 ? 'pocket--ghost' : ''}">${cardArt(C(id))}${i === 4 ? html`<span class="pocket__tag pocket__tag--ghost">${icon('ghost')}Fantasma</span>` : ''}</div>`
    : html`<div class="pocket pocket--empty is-locked"><span class="pocket__lock">${icon('lock')}</span><span class="pocket__empty-num">8</span></div>`)}
      </div></div></div>`;
}

export default function landing(ctx, main) {
  render(main, html`<div class="landing">
    <nav class="landing-nav" aria-label="Navegação da página inicial">
      <a class="landing-nav__brand" href="#/" aria-label="DuskDex — tela de entrada"><img src="assets/logos/duskdex-mark.svg" alt="" width="34" height="34"><span>Dusk<b>Dex</b></span></a>
      <div class="landing-nav__links">
        <button class="btn btn--ghost hide-sm" type="button" data-scroll="funcionalidades">Funcionalidades</button>
        <a class="btn btn--ghost hide-sm" href="#/catalogo">Catálogo</a>
        ${themeToggle()}
        <a class="btn btn--primary" href="#/">${icon('login')} Entrar</a>
      </div>
    </nav>

    <header class="hero hero--compact">
      <div class="hero__sky"></div>
      <div class="hero__particles" aria-hidden="true"></div>
      <div class="hero__mist" aria-hidden="true"></div>
      <div class="hero__inner">
        <span class="landing-kicker" style="color:#D8BDE5">Conheça o DuskDex</span>
        <h1 class="hero__title">Toda coleção tem uma história.<br><em>Organize a sua.</em></h1>
        <p class="hero__lead">Organize suas cartas Pokémon, monte fichários incríveis, crie decks e descubra uma comunidade apaixonada por colecionismo.</p>
        <div class="hero__ctas">
          <a class="btn btn--primary btn--lg" href="#/">${icon('sparkles')} Começar</a>
          <button class="btn btn--outline btn--lg" type="button" data-scroll="funcionalidades">Ver funcionalidades ${icon('chevronDown')}</button>
        </div>
      </div>
    </header>

    <section class="landing-section" id="funcionalidades">
      <div class="landing-section__inner feature-row">
        <div class="feature-row__text">
          <span class="landing-kicker">Fichários digitais</span>
          <h2 class="landing-h2">A sensação de virar a página — agora com superpoderes.</h2>
          <p class="landing-lead">Modo livro com duas páginas e virada animada, ou página única para organizar com precisão. Físicos espelham o fichário da sua estante; virtuais servem para planejar sem limites.</p>
          <ul class="feature-list">
            <li>${icon('ghost')}<span><strong>Cartas fantasmas</strong> marcam o que falta, inclusive em bolsos bloqueados.</span></li>
            <li>${icon('wand')}<span><strong>Organização automática</strong> por nome, expansão, número, tipo ou raridade — sempre com prévia.</span></li>
            <li>${icon('image')}<span><strong>Artes panorâmicas</strong> distribuídas em 2×2, 3×3 ou 4×3 e exportadas para impressão em 63×88 mm.</span></li>
          </ul>
        </div>
        <div class="mock-frame">${miniBinder()}</div>
      </div>
    </section>

    <section class="landing-section" style="background:var(--bg-2)">
      <div class="landing-section__inner feature-row feature-row--flip">
        <div class="feature-row__text">
          <span class="landing-kicker">Coleção & inventário inteligente</span>
          <h2 class="landing-h2">Cada cópia é única. E sabe exatamente onde está.</h2>
          <p class="landing-lead">Cadastre três unidades e o DuskDex cria três cópias individuais. Cada uma tem uma única localização — caixa, gaveta, deck box ou bolso do fichário — e todo movimento entra no histórico, com reversão segura.</p>
          <ul class="feature-list">
            <li>${icon('history')}<span><strong>Histórico imutável</strong>: reverter gera uma nova operação, nada é apagado.</span></li>
            <li>${icon('alert')}<span><strong>Conflitos detectados</strong> antes de desfazer movimentos antigos.</span></li>
          </ul>
        </div>
        <div class="mock-frame"><div class="mini-tree">
          <div>${icon('home')} Quarto</div>
          <div style="margin-left:18px">${icon('folder')} Estante</div>
          <div style="margin-left:36px">${icon('box')} Caixa Base Set <span class="badge" style="margin-left:auto">23 cartas</span></div>
          <div style="margin-left:36px">${icon('book')} Kanto Clássico <span class="badge badge--primary" style="margin-left:auto">11 cartas</span></div>
          <div style="margin-left:18px">${icon('swords')} Deck box · Fogo Clássico <span class="badge badge--crimson" style="margin-left:auto">montado</span></div>
        </div></div>
      </div>
    </section>

    <section class="landing-section">
      <div class="landing-section__inner">
        <span class="landing-kicker">Tudo em um só lugar</span>
        <h2 class="landing-h2">Ferramentas pensadas por quem coleciona.</h2>
        <div class="feature-grid">
          ${[
    ['layers', 'Coleção de cartas', 'Grid ou lista, filtros e busca. Encontre em segundos onde cada cópia está guardada.'],
    ['swords', 'Deck Builder', 'Compare a lista com o que você tem, veja faltantes e monte o deck físico com lista de separação.'],
    ['grid', 'Catálogo internacional', 'Mais de 130 mil cartas da TCGdex em 13 idiomas, com busca instantânea e legalidade Standard/Expanded.'],
    ['heart', 'Wishlist', 'Integrada aos fichários e decks: saiba onde cada carta desejada já está planejada.'],
    ['target', 'Objetivos', 'Progresso calculado com cartas reais — fantasmas e imagens decorativas nunca contam como possuídas.'],
    ['users', 'Comunidade e trocas', 'Perfis, fichários públicos, publicações e trocas entre colecionadores — com conta.'],
  ].map(([ic, t, d]) => html`<article class="feature-card"><div class="feature-card__icon">${icon(ic)}</div><h3>${t}</h3><p>${d}</p></article>`)}
        </div>
      </div>
    </section>

    <section class="landing-section" style="background:var(--bg-2)">
      <div class="landing-section__inner feature-row">
        <div class="feature-row__text">
          <span class="landing-kicker">Personalização</span>
          <h2 class="landing-h2">Do couro clássico ao céu sem lua.</h2>
          <p class="landing-lead">Escolha cor do fichário, cor das folhas, estilo dos bolsos e capa com a sua arte. Alterne entre o tema claro e o escuro quando quiser.</p>
        </div>
        <div class="binder-cards" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          ${[['#5a2f45', 'couro', 'base1-4', 'Holos 1999'], ['#2f3f5a', 'classico', 'base1-58', 'Kanto PT-BR'], ['#1d1526', 'noturno', 'base1-10', 'Sombras']].map(([c, s, id, n]) => html`
            <div class="binder-cover" data-style="${s}" style="--binder-color:${c}"><div class="binder-cover__rings"><span></span><span></span><span></span></div><div class="binder-cover__art">${cardArt(C(id))}</div><div class="binder-cover__title">${n}</div></div>`)}
        </div>
      </div>
    </section>

    <section class="landing-section landing-cta">
      <div class="landing-section__inner">
        <h2 class="landing-h2">Sua coleção. Seu universo.</h2>
        <p class="landing-lead" style="margin-inline:auto">Entre na sua conta, crie uma nova ou use sem cadastro, com os dados salvos no seu navegador.</p>
        <div class="hero__ctas" style="margin-top:28px"><a class="btn btn--primary btn--lg" href="#/">${icon('sparkles')} Começar</a><a class="btn btn--outline btn--lg" href="#/catalogo">${icon('search')} Ver catálogo</a></div>
      </div>
    </section>

    ${siteFooter({ variant: 'landing' })}
  </div>`);
  initThemeToggles(main);
  hydrateImages(main);
  main.querySelectorAll('[data-scroll]').forEach((b) => b.addEventListener('click', () => {
    document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }));
}
