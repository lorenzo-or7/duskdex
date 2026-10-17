import { html, render } from '../core/html.js';
import { icon } from '../core/icons.js';

export default function notfound(ctx, main) {
  render(main, html`<div class="page notfound"><div class="stack" style="align-items:center">
    <h1>404</h1><p class="muted">Esta página se perdeu na escuridão. A rota <span class="mono">${ctx.path}</span> não existe.</p>
    <a class="btn btn--primary" href="#/inicio">${icon('home')} Voltar ao início</a></div></div>`);
}
