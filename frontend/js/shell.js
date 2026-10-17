// Estrutura da aplicação: sidebar (desktop), trilho (tablet), topbar + barra inferior (smartphone).
import { siteFooter } from './components/footer.js';
import { html, render, $, $$ } from './core/html.js';
import { icon } from './core/icons.js';
import { themeToggle, initThemeToggles } from './core/theme.js';
import { lsGet, lsSet } from './core/prefs.js';
import { openModal } from './components/modal.js';
import { data } from './api/index.js';
import { community } from './api/community.js';
import { toast, toastError } from './components/toast.js';

export const NAV = [
  { path: '/inicio', label: 'Início', short: 'Início', icon: 'home' },
  { path: '/colecao', label: 'Minha Coleção', short: 'Coleção', icon: 'layers' },
  { path: '/ficharios', label: 'Fichários', short: 'Fichários', icon: 'book' },
  { path: '/inventario', label: 'Inventário', short: 'Inventário', icon: 'package' },
  { path: '/decks', label: 'Decks', short: 'Decks', icon: 'swords' },
  { path: '/catalogo', label: 'Catálogo', short: 'Catálogo', icon: 'grid' },
  { path: '/wishlist', label: 'Wishlist', short: 'Wishlist', icon: 'heart' },
  { path: '/objetivos', label: 'Objetivos', short: 'Objetivos', icon: 'target' },
  { path: '/comunidade', label: 'Comunidade', short: 'Comunidade', icon: 'users' },
  { path: '/trocas', label: 'Trocas', short: 'Trocas', icon: 'repeat' },
  { path: '/perfil', label: 'Perfil', short: 'Perfil', icon: 'user' },
];
const MOBILE = ['/inicio', '/colecao', '/ficharios', '/decks', '/perfil'];

const brandMark = 'assets/logos/duskdex-mark.svg';

export function mountShell(app) {
  render(app, html`
    <aside class="sidebar" aria-label="Navegação principal">
      <a class="sidebar__brand" href="#/inicio" aria-label="DuskDex — início">
        <img src="${brandMark}" alt="" width="38" height="38">
        <span class="sidebar__wordmark">Dusk<b>Dex</b></span>
      </a>
      <button class="sidebar__collapse" type="button" data-collapse aria-label="Recolher menu lateral" title="Recolher/expandir menu">${icon('panel')}</button>
      <nav class="nav">
        ${NAV.map((n) => html`<a class="nav__item" href="#${n.path}" data-nav="${n.path}" data-label="${n.label}">${icon(n.icon)}<span class="nav__label">${n.label}</span></a>`)}
      </nav>
      <div class="sidebar__spacer"></div>
      <div class="sidebar__footer">
        <a class="nav__item" href="#/notificacoes" data-nav="/notificacoes" data-label="Notificações" data-notif hidden>${icon('bell')}<span class="nav__label">Notificações</span><span class="nav__badge" data-notif-count hidden></span></a>
        <a class="nav__item" href="#/ajuda" data-nav="/ajuda" data-label="Ajuda">${icon('help')}<span class="nav__label">Ajuda</span></a>
        <a class="nav__item" href="#/configuracoes" data-nav="/configuracoes" data-label="Configurações">${icon('settings')}<span class="nav__label">Configurações</span></a>
        <a class="nav__item" href="#/configuracoes?secao=conta" data-nav="/conta" data-label="Conta" data-account>${icon('user')}<span class="nav__label" data-account-label>Conta</span></a>
        <button class="nav__item" type="button" data-logout data-label="Sair">${icon('logout')}<span class="nav__label">Sair</span></button>
        <div class="sidebar__theme"><span class="sidebar__theme-label text-sm muted">Tema</span>${themeToggle()}</div>
      </div>
    </aside>
    <header class="topbar">
      <a class="topbar__brand" href="#/inicio" aria-label="DuskDex — início"><img src="${brandMark}" alt="" width="30" height="30"><span>Dusk<b>Dex</b></span></a>
      <div class="topbar__actions">
        <a class="icon-btn topbar__notif" href="#/notificacoes" aria-label="Notificações" data-notif hidden>${icon('bell')}<span class="nav__badge" data-notif-count hidden></span></a>
        ${themeToggle()}
        <button class="icon-btn" type="button" data-more aria-label="Mais seções">${icon('menu')}</button>
      </div>
    </header>
    <div class="main">
      <div class="modebar" data-modebar hidden></div>
      <main id="main" tabindex="-1"></main>
      ${siteFooter()}
    </div>
    <nav class="bottomnav" aria-label="Navegação principal (celular)">
      ${NAV.filter((n) => MOBILE.includes(n.path)).map((n) => html`<a class="bottomnav__item" href="#${n.path}" data-nav="${n.path}">${icon(n.icon)}<span>${n.short}</span></a>`)}
    </nav>`);

  // Estado da sidebar
  const isTablet = () => matchMedia('(min-width: 768px) and (max-width: 1199px)').matches;
  if (lsGet('dd.sidebar') === 'collapsed') app.dataset.sidebar = 'collapsed';
  $('[data-collapse]', app).addEventListener('click', () => {
    if (isTablet()) {
      app.dataset.sidebar = app.dataset.sidebar === 'expanded-overlay' ? '' : 'expanded-overlay';
      return;
    }
    const collapsed = app.dataset.sidebar === 'collapsed';
    app.dataset.sidebar = collapsed ? '' : 'collapsed';
    lsSet('dd.sidebar', collapsed ? 'expanded' : 'collapsed');
  });
  app.addEventListener('click', (e) => {
    // fecha overlay do tablet ao navegar ou clicar fora
    if (app.dataset.sidebar === 'expanded-overlay' && (e.target.closest('.nav__item') || !e.target.closest('.sidebar'))) app.dataset.sidebar = '';
  });
  $('[data-more]', app).addEventListener('click', openMobileMenu);
  $('[data-logout]', app).addEventListener('click', onLogout);
  initThemeToggles(app);
}

async function onLogout() {
  const db = data();
  if (db.mode === 'server' && db.user) {
    try { await db.logout(); } catch { /* sessão já expirada */ }
    location.hash = '#/entrar';
  } else {
    location.hash = '#/';
  }
}

function openMobileMenu() {
  const m = openModal({
    title: 'Navegar',
    body: html`<nav class="nav" aria-label="Todas as seções">
      ${NAV.map((n) => html`<a class="nav__item" href="#${n.path}" data-nav="${n.path}">${icon(n.icon)}<span class="nav__label">${n.label}</span></a>`)}
      <div class="divider" style="margin:8px 0"></div>
      <a class="nav__item" href="#/imagens">${icon('image')}<span class="nav__label">Biblioteca de imagens</span></a>
      ${data().mode === 'server' && data().user ? html`<a class="nav__item" href="#/notificacoes">${icon('bell')}<span class="nav__label">Notificações</span></a>` : ''}
      <a class="nav__item" href="#/ajuda">${icon('help')}<span class="nav__label">Ajuda e perguntas frequentes</span></a>
      <a class="nav__item" href="#/configuracoes">${icon('settings')}<span class="nav__label">Configurações</span></a>
      ${data().mode === 'server' && data().user ? html`<button class="nav__item" type="button" data-logout2>${icon('logout')}<span class="nav__label">Sair</span></button>` : ''}
    </nav>`,
  });
  highlight(m.body, location.hash.replace(/^#/, '').split('?')[0]);
  m.body.addEventListener('click', (e) => { if (e.target.closest('a')) m.close(); });
  m.body.querySelector('[data-logout2]')?.addEventListener('click', () => { m.close(); onLogout(); });
}

function highlight(root, path) {
  $$('[data-nav]', root).forEach((a) => {
    const p = a.dataset.nav;
    const active = path === p || (p !== '/' && path.startsWith(p + '/')) || (p === '/catalogo' && path.startsWith('/carta')) || (p === '/comunidade' && (path.startsWith('/u/') || path.startsWith('/b/') || path.startsWith('/d/'))) || (p === '/trocas' && path.startsWith('/trocas'));
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

export function updateShell(app, { path, chrome }) {
  app.dataset.chrome = chrome ? 'app' : 'none';
  highlight(app, path);
  const db = data();
  const bar = $('[data-modebar]', app);
  if (!bar) return;
  const acc = $('[data-account-label]', app);
  const out = $('[data-logout]', app);
  if (out) out.hidden = !(db.mode === 'server' && db.user); // sem conta não há o que encerrar
  if (db.mode === 'demo') {
    bar.hidden = false;
    bar.className = 'modebar';
    render(bar, window.DUSKDEX_PREVIEW
      ? html`${icon('database')}<strong>Prévia online</strong><span class="modebar__long">· sem conta, dados só neste navegador. Esta página não acessa a internet: imagens das cartas, contas e comunidade aparecem rodando o projeto.</span><span class="modebar__short">· prévia sem internet</span><a href="#/configuracoes?secao=dados">Gerenciar dados</a>`
      : html`${icon('database')}<strong>Sem conta</strong><span class="modebar__long">· seus dados ficam só neste navegador. Crie uma conta para guardá-los no servidor e participar da comunidade.</span><span class="modebar__short">· salvo só neste navegador</span><a href="#/registrar">Criar conta</a>`);
    if (acc) acc.textContent = 'Entrar / criar conta';
    const accLink = $('[data-account]', app);
    if (accLink) accLink.setAttribute('href', '#/entrar');
  } else {
    const verified = db.user?.emailVerified !== false;
    bar.hidden = !db.user || verified;
    bar.className = 'modebar modebar--server';
    if (db.user && !verified) {
      render(bar, db.mailTestMode
        ? html`${icon('mail')}<strong>Confirme seu e-mail</strong><span class="modebar__long">· modo de teste: este servidor não envia e-mails de verdade.</span><button type="button" class="modebar__btn" data-verify-now>Confirmar agora</button>`
        : html`${icon('mail')}<strong>Confirme seu e-mail</strong><span class="modebar__long">· enviamos um link para ${db.user.email}.</span><a href="#/configuracoes?secao=conta">Reenviar</a>`);
      bar.querySelector('[data-verify-now]')?.addEventListener('click', (e) => verifyNow(e.currentTarget));
    }
    if (acc) acc.textContent = db.user ? `@${db.user.username}` : 'Conta';
  }
  syncNotifications(app);
}

// Notificações: contador no menu (só com conta), atualizado a cada minuto e ao voltar para a aba.
let notifTimer = null;
export async function syncNotifications(app = document.getElementById('app')) {
  const db = data();
  const on = db.mode === 'server' && !!db.user;
  $$('[data-notif]', app).forEach((el) => { el.hidden = !on; });
  if (!on) { clearInterval(notifTimer); notifTimer = null; return; }
  if (!notifTimer) {
    notifTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNotifications(app); }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNotifications(app); });
  }
  try {
    const c = await community.counts();
    const n = c.unread || 0; // trocas pendentes têm o próprio contador no item "Trocas"
    $$('[data-notif-count]', app).forEach((el) => { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); });
    const trades = $('[data-nav="/trocas"]', app);
    if (trades) trades.dataset.badge = c.trades ? String(c.trades) : '';
  } catch { /* sessão expirada ou servidor fora do ar: tenta de novo depois */ }
}

/**
 * Modo de teste de e-mail (servidor local sem envio real): pede um link novo e já abre a confirmação.
 * Fora do modo de teste, só reenvia o e-mail.
 */
export async function verifyNow(btn) {
  const db = data();
  if (btn) btn.disabled = true;
  try {
    const r = await db.resendVerification();
    if (r?.devLink) { location.hash = r.devLink.replace(/^#/, ''); return; }
    toast({ type: 'success', text: `Enviamos um novo link para ${db.user?.email}. Veja também a caixa de spam.` });
  } catch (e) { toastError(e); } finally { if (btn) btn.disabled = false; }
}
