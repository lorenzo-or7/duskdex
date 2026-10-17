// DuskDex — inicialização.
import { html, render, $ } from './core/html.js';
import { icon } from './core/icons.js';
import { initThemeToggles } from './core/theme.js';
import './core/img-fallback.js';
import { on } from './core/events.js';
import { route, setNotFound, onBefore, onAfter, start, refresh } from './router.js';
import { mountShell, updateShell, NAV } from './shell.js';
import { initData, data, rememberCards, reloadCards } from './api/index.js';
import { seedDemo, startEmptyGuest } from './features/seed.js';
import { prefs } from './core/prefs.js';
import { toast } from './components/toast.js';

const app = document.getElementById('app');

// Páginas carregadas sob demanda (cada módulo exporta `default (ctx, main) => cleanup?`).
// Cada navegação ganha um contêiner próprio (.view). Se uma página antiga ainda terminar
// algum trabalho assíncrono depois da troca de rota, ela desenha num elemento já
// desanexado — nunca por cima da tela atual.
const page = (loader) => async (ctx) => {
  const main = document.getElementById('main');
  const view = document.createElement('div');
  view.className = 'view';
  main.classList.remove('route-enter');
  render(view, html`<div class="center-loader"><span class="loader"><span class="loader__eclipse"></span>Carregando…</span></div>`);
  main.replaceChildren(view);
  try {
    const mod = await loader();
    if (!view.isConnected) return undefined;
    view.innerHTML = '';
    const cleanup = await mod.default(ctx, view);
    void main.offsetWidth;
    main.classList.add('route-enter');
    return cleanup;
  } catch (err) {
    console.error(err);
    if (err?.code === 'UNAUTHENTICATED') { location.hash = '#/entrar'; return undefined; }
    if (!view.isConnected) return undefined;
    render(view, html`<div class="page"><div class="state state--error">
      <div class="state__icon">${icon('alert')}</div>
      <h3>Esta tela encontrou um problema</h3>
      <p>${err?.message || 'Erro inesperado.'}</p>
      <button class="btn btn--primary" type="button" data-retry>${icon('refresh')} Tentar novamente</button>
    </div></div>`);
    view.querySelector('[data-retry]').addEventListener('click', () => refresh());
    return undefined;
  }
};

route('/', page(() => import('./pages/auth.js')), { chrome: false, public: true, title: 'Bem-vindo' });
route('/sobre', page(() => import('./pages/landing.js')), { chrome: false, public: true, title: 'Conheça o DuskDex' });
route('/entrar', page(() => import('./pages/auth.js')), { chrome: false, public: true, title: 'Entrar' });
route('/registrar', page(() => import('./pages/auth.js')), { chrome: false, public: true, title: 'Criar conta' });
route('/recuperar', page(() => import('./pages/auth.js')), { chrome: false, public: true, title: 'Recuperar senha' });
route('/redefinir', page(() => import('./pages/auth.js')), { chrome: false, public: true, title: 'Nova senha' });
route('/verificar', page(() => import('./pages/auth.js')), { chrome: false, public: true, title: 'Confirmar e-mail' });
route('/importar', page(() => import('./pages/import.js')), { title: 'Importar do navegador' });
route('/inicio', page(() => import('./pages/dashboard.js')), { title: 'Início' });
route('/colecao', page(() => import('./pages/collection.js')), { title: 'Minha Coleção' });
route('/catalogo', page(() => import('./pages/catalog.js')), { title: 'Catálogo' });
route('/carta/:id', page(() => import('./pages/card.js')), { title: 'Carta' });
route('/ficharios', page(() => import('./pages/binders.js')), { title: 'Fichários' });
route('/ficharios/:id', page(() => import('./pages/binder.js')), { title: 'Fichário' });
route('/ficharios/:id/panorama', page(() => import('./pages/panorama.js')), { title: 'Arte panorâmica' });
route('/imagens', page(() => import('./pages/library.js')), { title: 'Biblioteca de imagens' });
route('/inventario', page(() => import('./pages/inventory.js')), { title: 'Inventário' });
route('/decks', page(() => import('./pages/decks.js')), { title: 'Decks' });
route('/decks/:id', page(() => import('./pages/deck.js')), { title: 'Deck' });
route('/wishlist', page(() => import('./pages/wishlist.js')), { title: 'Wishlist' });
route('/objetivos', page(() => import('./pages/goals.js')), { title: 'Objetivos' });
route('/comunidade', page(() => import('./pages/community.js')), { public: true, title: 'Comunidade' });
route('/comunidade/post/:post', page(() => import('./pages/community.js')), { public: true, title: 'Publicação' });
route('/u/:handle', page(() => import('./pages/community.js')), { public: true, title: 'Perfil público' });
route('/b/:id', page(() => import('./pages/public-binder.js')), { public: true, title: 'Fichário público' });
route('/d/:id', page(() => import('./pages/public-deck.js')), { public: true, title: 'Deck público' });
route('/trocas', page(() => import('./pages/trades.js')), { title: 'Trocas' });
route('/trocas/nova/:handle', page(() => import('./pages/trades.js')), { title: 'Nova troca' });
route('/notificacoes', page(() => import('./pages/notifications.js')), { title: 'Notificações' });
route('/moderacao', page(() => import('./pages/moderation.js')), { title: 'Moderação' });
route('/perfil', page(() => import('./pages/profile.js')), { title: 'Perfil' });
route('/ajuda', page(() => import('./pages/faq.js')), { public: true, title: 'Perguntas frequentes' });
route('/configuracoes', page(() => import('./pages/settings.js')), { title: 'Configurações' });
setNotFound(page(() => import('./pages/notfound.js')));

onBefore((ctx) => {
  const db = data();
  if (db.mode === 'server' && !ctx.meta.public && !db.user) return '/entrar';
  if (db.mode === 'server' && db.user && (ctx.path === '/entrar' || ctx.path === '/registrar')) return '/inicio';
  return null;
});

onAfter((ctx) => {
  updateShell(app, { path: ctx.path, chrome: ctx.meta.chrome !== false && ctx.path !== '/' });
  const nav = NAV.find((n) => ctx.path === n.path);
  document.title = `${ctx.meta.title || nav?.label || 'DuskDex'} · DuskDex`;
  const main = document.getElementById('main');
  if (!ctx.query?.keepScroll) window.scrollTo({ top: 0 });
  main?.focus({ preventScroll: true });
});

async function boot() {
  mountShell(app);
  initThemeToggles(document);
  let info;
  try {
    info = await initData();
  } catch (err) {
    render(document.getElementById('main'), html`<div class="page"><div class="state state--error">
      <div class="state__icon">${icon('alert')}</div><h3>Não foi possível iniciar os dados</h3><p>${err.message}</p>
      <div class="btn-group"><button class="btn btn--primary" type="button" data-demo>Usar sem conta (neste navegador)</button></div></div></div>`);
    app.dataset.chrome = 'none';
    $('[data-demo]').addEventListener('click', async () => { const { switchMode } = await import('./api/index.js'); switchMode('demo'); });
    return;
  }
  if (info.mode === 'demo' && !info.seeded) {
    // Convidado: começa com a coleção vazia. Exemplos (fictícios, rotulados) só se a pessoa escolher.
    try {
      if (prefs.get('guestStart') === 'examples') {
        render(document.getElementById('main'), html`<div class="center-loader" style="min-height:60vh"><span class="loader"><span class="loader__eclipse"></span>Preparando a coleção de exemplo…</span></div>`);
        await seedDemo(data(), rememberCards);
      } else {
        await startEmptyGuest(data());
      }
      await reloadCards();
    } catch (err) {
      console.error(err);
      toast({ type: 'error', title: 'Falha ao preparar os dados', text: err.message });
    }
  }
  await start();
}

// Avisos entre abas: mantém telas coerentes quando outra aba altera os dados.
on('remote:*', ({ type }) => {
  if (!type?.startsWith('data:')) return;
  reloadCards().then(() => {
    toast({ type: 'info', title: 'Dados atualizados em outra aba', text: 'A tela foi recarregada com a versão mais recente.' });
    refresh();
  });
});

boot();
