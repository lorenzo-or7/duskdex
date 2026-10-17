// Tela de entrada (#/, #/entrar, #/registrar, #/recuperar, #/redefinir, #/verificar): cena do eclipse + acesso.
// Caminhos: entrar, criar conta (exigem o servidor PHP + MySQL), recuperar senha, ou usar sem conta (dados só no navegador).
// Não há login simulado: sem servidor ativo, o formulário explica o motivo e oferece o uso sem conta.
import { html, render } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, switchMode, reloadCards } from '../api/index.js';
import { prefs } from '../core/prefs.js';
import { themeToggle, initThemeToggles } from '../core/theme.js';
import { navigate } from '../router.js';
import { siteFooter } from '../components/footer.js';
import { guestHasData } from './import.js';

const NO_SERVER = 'Contas precisam do servidor DuskDex (PHP + MySQL), que não está ativo neste endereço. Você pode usar o DuskDex sem conta, com os dados salvos neste navegador.';

export default async function auth(ctx, main) {
  const db = data();
  const view = { '/registrar': 'register', '/recuperar': 'forgot', '/redefinir': 'reset', '/verificar': 'verify' }[ctx.path] || 'login';
  const signedIn = db.mode === 'server' && db.user;

  const loginForm = html`
    <label class="field"><span class="field__label">E-mail ou username</span><input class="input" name="login" autocomplete="username" required></label>
    <label class="field"><span class="field__label">Senha</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
    <div class="row row--between"><label class="checkbox"><input type="checkbox" name="remember"> Manter conectado</label><a class="text-sm" href="#/recuperar">Esqueci a senha</a></div>
    <button class="btn btn--primary btn--lg" type="submit">${icon('login')} Entrar</button>`;

  const registerForm = html`
    <div class="form-grid">
      <label class="field"><span class="field__label">Nome de exibição</span><input class="input" name="displayName" maxlength="60" autocomplete="name" required></label>
      <label class="field"><span class="field__label">Username</span><input class="input" name="username" maxlength="30" pattern="[a-z0-9._]{3,30}" autocomplete="username" required></label>
    </div>
    <label class="field"><span class="field__label">E-mail</span><input class="input" type="email" name="email" maxlength="190" autocomplete="email" required></label>
    <label class="field"><span class="field__label">Senha</span><input class="input" type="password" name="password" minlength="10" maxlength="200" autocomplete="new-password" required><span class="field__hint">Mínimo de 10 caracteres. Username: 3–30 letras minúsculas, números, ponto ou sublinhado.</span></label>
    <label class="checkbox"><input type="checkbox" name="acceptTerms" required> Li e aceito os termos de uso e a política de privacidade (LGPD).</label>
    <button class="btn btn--primary btn--lg" type="submit">${icon('userPlus')} Criar conta</button>`;

  const forgotForm = html`
    <p class="text-sm muted">Informe o e-mail da conta. Se ela existir, enviaremos um link para criar uma nova senha (vale por 1 hora).</p>
    <label class="field"><span class="field__label">E-mail</span><input class="input" type="email" name="email" maxlength="190" autocomplete="email" required></label>
    <button class="btn btn--primary btn--lg" type="submit">${icon('mail')} Enviar link</button>
    <a class="btn btn--ghost" href="#/entrar">${icon('arrowLeft')} Voltar para entrar</a>`;

  const resetForm = html`
    <p class="text-sm muted">Escolha uma nova senha. Depois disso, sessões abertas em outros aparelhos são encerradas.</p>
    <label class="field"><span class="field__label">Nova senha</span><input class="input" type="password" name="password" minlength="10" maxlength="200" autocomplete="new-password" required><span class="field__hint">Mínimo de 10 caracteres.</span></label>
    <label class="field"><span class="field__label">Repita a nova senha</span><input class="input" type="password" name="password2" minlength="10" maxlength="200" autocomplete="new-password" required></label>
    <button class="btn btn--primary btn--lg" type="submit">${icon('key')} Salvar nova senha</button>`;

  const titles = { login: 'Toda coleção tem uma história.', register: 'Toda coleção tem uma história.', forgot: 'Recuperar acesso', reset: 'Nova senha', verify: 'Confirmação de e-mail' };
  const tabs = view === 'login' || view === 'register';

  render(main, html`<div class="welcome">
    <section class="welcome__stage" role="img" aria-label="DuskDex — Sua coleção. Seu universo. O D formado por cartas sobrepostas e uma lua crescente, diante de um eclipse.">
      <div class="welcome__scene welcome__scene--dark" aria-hidden="true"></div>
      <div class="welcome__scene welcome__scene--light" aria-hidden="true"></div>
    </section>

    <section class="welcome__panel">
      <div class="welcome__top">
        <a class="welcome__about" href="#/sobre">${icon('sparkles')} Conhecer o DuskDex</a>
        ${themeToggle()}
      </div>

      <div class="welcome__card">
        <h1 class="welcome__title">${titles[view]}</h1>
        ${signedIn && tabs ? html`
          <p class="welcome__lead">Você está conectado como <strong>@${db.user.username}</strong>.</p>
          <a class="btn btn--primary btn--lg" href="#/inicio">${icon('arrowRight')} Continuar para a minha coleção</a>
          <button class="btn btn--ghost" type="button" data-signout>${icon('logout')} Sair desta conta</button>`
    : view === 'verify' ? html`<div class="stack" data-verify><div class="center-loader"><span class="loader"><span class="loader__eclipse"></span>Confirmando…</span></div></div>`
      : html`
          ${tabs ? html`<p class="welcome__lead">Entre para continuar a sua, ou use sem cadastro.</p>
          <nav class="seg" role="tablist" aria-label="Acesso">
            <a class="seg__item" role="tab" href="#/entrar" aria-selected="${view === 'login'}">Entrar</a>
            <a class="seg__item" role="tab" href="#/registrar" aria-selected="${view === 'register'}">Criar conta</a>
          </nav>` : ''}
          <form class="welcome__form" novalidate data-form>
            <div class="alert alert--danger" data-err hidden>${icon('alert')}<div data-errtext></div></div>
            <div class="alert alert--success" data-ok hidden>${icon('check')}<div data-oktext></div></div>
            ${{ login: loginForm, register: registerForm, forgot: forgotForm, reset: resetForm }[view]}
          </form>
          ${tabs ? html`<div class="welcome__or" role="separator"><span>ou</span></div>
          <button class="btn btn--outline btn--lg welcome__guest" type="button" data-guest>${icon('compass')} Usar sem conta</button>
          <p class="text-xs subtle welcome__fine">Sem conta, seus dados ficam só neste navegador. Dá para levá-los para uma conta depois.</p>` : ''}`}
      </div>

      ${siteFooter({ variant: 'welcome' })}
    </section>
  </div>`);
  initThemeToggles(main);

  main.querySelector('[data-signout]')?.addEventListener('click', async () => {
    try { await db.logout(); } catch { /* sessão já expirada */ }
    navigate('/entrar');
  });

  main.querySelector('[data-guest]')?.addEventListener('click', () => {
    if (db.mode === 'server') switchMode('demo'); else navigate('/inicio');
  });

  // Servidor: usa o adaptador ativo ou um temporário (quando o app está sem conta)
  const serverApi = async () => {
    if (db.mode === 'server') return db;
    const { ServerAdapter } = await import('../api/server-adapter.js');
    const api = new ServerAdapter();
    const health = await api.health();
    if (!health.ok) throw Object.assign(new Error(health.message === 'Servidor DuskDex não encontrado neste endereço.' ? NO_SERVER : health.message), { noServer: true });
    await api.fetchCsrf();
    return api;
  };

  /** Depois de entrar: passa para o modo conta; se houver dados do navegador, oferece importá-los. */
  const afterLogin = async () => {
    if (db.mode !== 'server') {
      const hasLocal = await guestHasData().catch(() => false);
      prefs.set('dataMode', 'server');
      location.hash = hasLocal ? '#/importar' : '#/inicio';
      location.reload();
      return;
    }
    await reloadCards();
    navigate('/inicio');
  };

  if (view === 'verify') {
    const box = main.querySelector('[data-verify]');
    try {
      const api = await serverApi();
      const r = await api.verifyEmail(ctx.query.token);
      if (db.mode === 'server' && db.user) await db.refreshMe().catch(() => {});
      render(box, html`<div class="alert alert--success">${icon('check')}<div>E-mail confirmado. Obrigado!</div></div>
        <a class="btn btn--primary btn--lg" href="${r.loggedIn ? '#/inicio' : '#/entrar'}">${icon('arrowRight')} ${r.loggedIn ? 'Continuar' : 'Entrar'}</a>`);
    } catch (e) {
      render(box, html`<div class="alert alert--danger">${icon('alert')}<div>${e.message}</div></div><a class="btn" href="#/entrar">Voltar</a>`);
    }
    return;
  }

  const form = main.querySelector('[data-form]');
  if (!form) return;
  if (view === 'reset' && !/^[a-f0-9]{64}$/.test(ctx.query.token || '')) {
    main.querySelector('[data-err]').hidden = false;
    main.querySelector('[data-errtext]').textContent = 'Link inválido ou incompleto. Peça um novo em “Esqueci a senha”.';
  }
  form.querySelector('input')?.focus({ preventScroll: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = main.querySelector('[data-err]'); const ok = main.querySelector('[data-ok]');
    const showError = (msg) => { err.hidden = false; ok.hidden = true; main.querySelector('[data-errtext]').textContent = msg; };
    err.hidden = true; ok.hidden = true;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const fd = Object.fromEntries(new FormData(form));
    if (view === 'reset' && fd.password !== fd.password2) { showError('As duas senhas não são iguais.'); return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const api = await serverApi();
      if (view === 'forgot') {
        const r = await api.forgotPassword(fd.email);
        const { serverHealth } = await import('../api/server-adapter.js');
        const test = (await serverHealth().catch(() => null))?.data?.mailTestMode;
        ok.hidden = false;
        main.querySelector('[data-oktext]').textContent = test
          ? `${r.message} Modo de teste: este servidor não envia e-mails de verdade — o link fica num arquivo .txt na pasta storage/mail do projeto.`
          : r.message;
        btn.disabled = false;
        return;
      }
      if (view === 'reset') await api.resetPassword(ctx.query.token, fd.password);
      else if (view === 'register') await api.register({ displayName: fd.displayName, username: fd.username.toLowerCase(), email: fd.email, password: fd.password, acceptTerms: !!fd.acceptTerms });
      else await api.login({ login: fd.login, password: fd.password, remember: !!fd.remember });
      await afterLogin();
    } catch (ex) {
      showError(ex.details?.length ? `${ex.message} ${ex.details.map((d) => d.message || d).join(' ')}` : (ex.message || 'Não foi possível concluir. Tente novamente.'));
      btn.disabled = false;
    }
  });
}
