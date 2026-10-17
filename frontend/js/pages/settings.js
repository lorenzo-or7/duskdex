import { html, render, formatBytes } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, switchMode } from '../api/index.js';
import { prefs, lsSet } from '../core/prefs.js';
import { getTheme, setTheme, themeToggle, initThemeToggles } from '../core/theme.js';
import { confirmDialog, openModal } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { discoverLanguages } from '../api/tcgdex.js';
import { ServerAdapter } from '../api/server-adapter.js';
import { setQuery } from '../router.js';
import { verifyNow } from '../shell.js';

const SECTIONS = [['aparencia', 'palette', 'Aparência'], ['catalogo', 'grid', 'Catálogo'], ['dados', 'database', 'Dados e modo'], ['conta', 'user', 'Conta'], ['sobre', 'info', 'Sobre']];

export default async function settings(ctx, main) {
  const db = data();
  let sec = SECTIONS.some(([k]) => k === ctx.query.secao) ? ctx.query.secao : 'aparencia';

  const paint = async () => {
    render(main, html`<div class="page">
      <div class="page-head"><div><div class="page-head__eyebrow">Preferências</div><h1>Configurações</h1></div></div>
      <div class="settings-grid">
        <nav class="settings-nav" aria-label="Seções">${SECTIONS.map(([k, ic, l]) => html`<button class="nav__item" type="button" data-sec="${k}" aria-current="${k === sec ? 'page' : 'false'}">${icon(ic)}<span>${l}</span></button>`)}</nav>
        <section class="panel" data-body></section>
      </div></div>`);
    main.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => { sec = b.dataset.sec; setQuery({ secao: sec }); paint(); }));
    const body = main.querySelector('[data-body]');
    await ({ aparencia, catalogo, dados, conta, sobre })[sec](body);
  };

  const aparencia = (body) => {
    render(body, html`<h2 class="panel__title" style="margin-bottom:8px">${icon('palette')} Aparência</h2>
      <div class="setting"><div class="setting__text"><strong>Tema</strong><span>Claro ou escuro. Atualmente: ${getTheme() === 'dark' ? 'escuro' : 'claro'}.</span></div>${themeToggle()}</div>
      <div class="setting"><div class="setting__text"><strong>Seguir o sistema</strong><span>Esquece a escolha manual e usa a preferência do sistema operacional.</span></div><button class="btn btn--sm" type="button" data-systheme>Usar tema do sistema</button></div>
      <div class="setting"><div class="setting__text"><strong>Visualização padrão dos fichários</strong><span>No celular, “automático” usa página única.</span></div>
        <select class="select" style="width:auto" data-bview>${[['auto', 'Automático'], ['book', 'Modo livro'], ['single', 'Página única']].map(([v, l]) => html`<option value="${v}" ${prefs.get('binderView') === v ? 'selected' : ''}>${l}</option>`)}</select></div>
      <div class="setting"><div class="setting__text"><strong>Movimento reduzido</strong><span>O DuskDex respeita a configuração “reduzir movimento” do seu sistema: virada de página, névoa e brilhos ficam estáticos.</span></div><span class="badge">${matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Ativo no sistema' : 'Inativo no sistema'}</span></div>`);
    initThemeToggles(body);
    body.querySelector('[data-theme-toggle]').addEventListener('click', () => setTimeout(() => aparencia(body), 50));
    body.querySelector('[data-systheme]').addEventListener('click', () => {
      try { localStorage.removeItem('dd.theme'); } catch { /* ignore */ }
      setTheme(matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark', { persist: false });
      toast({ type: 'success', text: 'Seguindo o tema do sistema.' }); aparencia(body);
    });
    body.querySelector('[data-bview]').addEventListener('change', (e) => { prefs.set('binderView', e.target.value); toast({ type: 'success', text: 'Preferência salva.', timeout: 1800 }); });
  };

  const catalogo = async (body) => {
    const langs = await discoverLanguages();
    render(body, html`<h2 class="panel__title" style="margin-bottom:8px">${icon('grid')} Catálogo</h2>
      <div class="setting"><div class="setting__text"><strong>Idioma padrão de pesquisa</strong><span>${langs.length} idiomas com cartas na base da TCGdex, embutidos no DuskDex (funcionam sem internet).</span></div>
        <select class="select" style="width:auto" data-lang>${langs.map((l) => html`<option value="${l.code}" ${prefs.get('catalogLang') === l.code ? 'selected' : ''}>${l.label} (${l.code})</option>`)}</select></div>
      <div class="setting"><div class="setting__text"><strong>Fonte de dados</strong><span>Cartas, expansões e legalidade: base pública da TCGdex (licença MIT), embutida no app. Imagens: servidor da TCGdex; quando uma imagem não existe lá, o app usa a versão em inglês ou a base PokemonTCG.</span></div><a class="btn btn--sm" href="https://tcgdex.dev/" target="_blank" rel="noopener">tcgdex.dev</a></div>`);
    body.querySelector('[data-lang]').addEventListener('change', (e) => { prefs.set('catalogLang', e.target.value); toast({ type: 'success', text: 'Idioma padrão salvo.', timeout: 1800 }); });
  };

  const dados = async (body) => {
    const est = db.mode === 'demo' ? await db.storageEstimate() : null;
    const guestData = db.mode === 'server' ? await import('./import.js').then((m) => m.guestHasData()).catch(() => false) : false;
    render(body, html`<h2 class="panel__title" style="margin-bottom:8px">${icon('database')} Dados e modo de uso</h2>
      <div class="stack" style="margin:12px 0 18px">
        <label class="mode-option"><input type="radio" name="mode" value="demo" ${db.mode === 'demo' ? 'checked' : ''}><span><strong>Sem conta (neste navegador)</strong><br><span class="text-sm muted">Seus dados ficam só neste navegador (IndexedDB), sem login. Bom para experimentar; dá para levar tudo para uma conta depois.</span></span></label>
        <label class="mode-option"><input type="radio" name="mode" value="server" ${db.mode === 'server' ? 'checked' : ''}><span><strong>Conta DuskDex (servidor)</strong> <span class="badge badge--success">recomendado</span><br><span class="text-sm muted">Coleção, fichários, imagens, inventário e decks guardados no servidor (PHP + MySQL), com login seguro. Inclui comunidade e trocas.</span><br><span class="text-xs" data-health></span></span></label>
      </div>
      <div class="btn-group"><button class="btn btn--primary" type="button" data-apply>Aplicar</button><button class="btn btn--sm btn--ghost" type="button" data-check>${icon('refresh')} Verificar servidor</button></div>
      <div class="divider"></div>
      ${db.mode === 'demo' ? html`
        <div class="setting"><div class="setting__text"><strong>Uso de armazenamento</strong><span>${est?.usage != null ? `${formatBytes(est.usage)} usados de ~${formatBytes(est.quota)} disponíveis para este site.` : 'O navegador não informou o uso.'}</span></div></div>
        <div class="setting"><div class="setting__text"><strong>Exportar dados</strong><span>Baixa um JSON com coleção, fichários, decks, wishlist e histórico (sem os arquivos de imagem).</span></div><button class="btn btn--sm" type="button" data-export>${icon('download')} Exportar JSON</button></div>
        <div class="setting"><div class="setting__text"><strong>Coleção de exemplo</strong><span>Apaga os dados deste navegador e carrega uma coleção fictícia (cartas, fichários e decks) para conhecer o DuskDex.</span></div><button class="btn btn--sm" type="button" data-reset>${icon('sparkles')} Carregar exemplo</button></div>
        <div class="setting"><div class="setting__text"><strong>Começar do zero</strong><span>Apaga tudo deste navegador e inicia uma coleção vazia.</span></div><button class="btn btn--sm btn--danger" type="button" data-empty>${icon('trash')} Apagar dados</button></div>`
    : html`<div class="setting"><div class="setting__text"><strong>Exportar meus dados (LGPD)</strong><span>Baixa um JSON com os dados da sua conta.</span></div><button class="btn btn--sm" type="button" data-export>${icon('download')} Exportar</button></div>
        ${guestData ? html`<div class="setting"><div class="setting__text"><strong>Dados deste navegador</strong><span>Há uma coleção usada sem conta neste navegador. Dá para trazê-la para a sua conta.</span></div><a class="btn btn--sm" href="#/importar">${icon('upload')} Importar</a></div>` : ''}`}`);
    const health = body.querySelector('[data-health]');
    const check = async () => { health.textContent = 'Verificando servidor…'; const h = await new ServerAdapter().health(); health.textContent = h.ok ? '✓ Servidor e banco disponíveis.' : `✗ ${h.message}`; health.style.color = h.ok ? 'var(--success)' : 'var(--danger)'; return h; };
    body.querySelector('[data-check]').addEventListener('click', check);
    body.querySelector('[data-apply]').addEventListener('click', async () => {
      const mode = body.querySelector('input[name="mode"]:checked').value;
      if (mode === db.mode) { toast({ type: 'info', text: 'Este já é o modo atual.' }); return; }
      if (mode === 'server') { const h = await check(); if (!h.ok) { toast({ type: 'error', title: 'Servidor indisponível', text: 'Veja no README como iniciar o backend PHP e preparar o MySQL.' }); return; } location.hash = '#/entrar'; prefs.set('dataMode', 'server'); location.reload(); return; }
      if (await confirmDialog({ title: 'Usar sem conta?', message: 'Você passa a usar os dados deste navegador. Sua conta continua no servidor, intacta.', confirmLabel: 'Trocar' })) switchMode(mode);
    });
    body.querySelector('[data-export]').addEventListener('click', async () => {
      try {
        const json = await db.exportAll();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `duskdex-${db.mode === 'server' ? 'conta' : 'navegador'}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      } catch (e) { toastError(e); }
    });
    const wipe = async (examples) => {
      if (!await confirmDialog({ title: examples ? 'Carregar a coleção de exemplo?' : 'Apagar tudo e começar vazio?', message: 'Todos os dados usados sem conta neste navegador (inclusive imagens enviadas) serão apagados. Isso não pode ser desfeito.', danger: true, confirmLabel: 'Apagar dados' })) return;
      await db.reset();
      prefs.set('guestStart', examples ? 'examples' : 'empty');
      lsSet('dd.reset', String(Date.now()));
      location.hash = '#/inicio'; location.reload();
    };
    body.querySelector('[data-reset]')?.addEventListener('click', () => wipe(true));
    body.querySelector('[data-empty]')?.addEventListener('click', () => wipe(false));
    if (db.mode === 'server') check();
  };

  const conta = (body) => {
    if (db.mode === 'demo') {
      render(body, html`<h2 class="panel__title" style="margin-bottom:8px">${icon('user')} Conta</h2>
        <div class="alert">${icon('info')}<div><strong>Você está usando o DuskDex sem conta.</strong> Os dados ficam só neste navegador e qualquer pessoa com acesso a ele pode vê-los. Com uma conta (senha protegida com Argon2id, sessão segura), seus dados ficam no servidor e você participa da comunidade e das trocas.</div></div>
        <div class="btn-group mt-3"><a class="btn btn--primary" href="#/registrar">${icon('userPlus')} Criar conta</a><a class="btn" href="#/entrar">${icon('login')} Entrar</a></div>
        <p class="text-sm muted mt-3">Ao entrar, o DuskDex oferece levar a coleção deste navegador para a conta.</p>`);
      return;
    }
    const u = db.user || {};
    render(body, html`<h2 class="panel__title" style="margin-bottom:8px">${icon('user')} Conta</h2>
      <div class="setting"><div class="setting__text"><strong>${u.displayName || u.username}</strong><span>@${u.username} · ${u.email}</span></div>${u.role === 'admin' ? html`<a class="btn btn--sm" href="#/moderacao">${icon('shield')} Moderação</a>` : ''}</div>
      <div class="setting"><div class="setting__text"><strong>E-mail</strong><span>${u.emailVerified ? 'Confirmado.' : db.mailTestMode ? 'Ainda não confirmado. Este servidor está em modo de teste (não envia e-mails de verdade): confirme direto por aqui.' : 'Ainda não confirmado. Procure o link que enviamos (veja também a caixa de spam).'}</span></div>${u.emailVerified ? html`<span class="badge badge--success">${icon('check')} confirmado</span>` : html`<button class="btn btn--sm" type="button" data-resend>${icon('mail')} ${db.mailTestMode ? 'Confirmar agora' : 'Reenviar link'}</button>`}</div>
      <form class="setting setting--form" data-pass><div class="setting__text"><strong>Trocar senha</strong><span>Outras sessões abertas são encerradas.</span></div>
        <div class="stack" style="min-width:min(100%,280px)"><input class="input" type="password" name="current" placeholder="Senha atual" autocomplete="current-password" required aria-label="Senha atual"><input class="input" type="password" name="password" placeholder="Nova senha (mín. 10)" minlength="10" autocomplete="new-password" required aria-label="Nova senha"><button class="btn btn--sm" type="submit">${icon('key')} Salvar nova senha</button></div></form>
      <div class="setting"><div class="setting__text"><strong>Sair</strong><span>Encerra a sessão neste navegador.</span></div><button class="btn btn--sm" type="button" data-logout>${icon('logout')} Sair</button></div>
      <div class="setting"><div class="setting__text"><strong>Excluir conta</strong><span>Apaga sua conta e todos os dados (coleção, fichários, imagens, publicações, trocas). Não pode ser desfeito. Exporte antes, se quiser guardar.</span></div><button class="btn btn--sm btn--danger" type="button" data-delete>${icon('trash')} Excluir conta</button></div>`);
    body.querySelector('[data-logout]').addEventListener('click', async () => { await db.logout(); location.hash = '#/entrar'; });
    body.querySelector('[data-resend]')?.addEventListener('click', (e) => verifyNow(e.currentTarget));
    body.querySelector('[data-pass]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget; if (!f.reportValidity()) return;
      try { await db.changePassword(f.current.value, f.password.value); f.reset(); toast({ type: 'success', text: 'Senha alterada.' }); } catch (err) { toastError(err); }
    });
    body.querySelector('[data-delete]').addEventListener('click', () => {
      const m = openModal({
        title: 'Excluir sua conta?',
        body: html`<form class="stack" data-f><p class="muted">Isso apaga <strong>permanentemente</strong> a conta @${u.username} e todos os dados dela. Para confirmar, digite sua senha.</p><input class="input" type="password" name="password" autocomplete="current-password" required aria-label="Senha"></form>`,
        footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--crimson" type="button" data-ok>${icon('trash')} Excluir definitivamente</button>`,
      });
      m.foot.querySelector('[data-ok]').addEventListener('click', async () => {
        const pw = m.body.querySelector('input').value;
        if (!pw) return;
        try { await db.deleteAccount(pw); m.close(); prefs.set('dataMode', 'demo'); location.hash = '#/'; location.reload(); } catch (err) { toastError(err); }
      });
    });
  };

  const sobre = (body) => {
    render(body, html`<h2 class="panel__title" style="margin-bottom:8px">${icon('info')} Sobre o DuskDex</h2>
      <div class="stack"><img src="assets/logos/duskdex-cinematic-wide.webp" alt="DuskDex" style="border-radius:14px;max-width:520px;width:100%">
      <p class="muted">Versão 1.0 · Sua coleção. Seu universo.</p>
      <p class="text-sm muted">A logo cinematográfica usa a arte original aprovada (arquivo preservado em <span class="mono">assets/logos/original/</span>). A marca minimalista em SVG usada na barra lateral e no favicon é uma <strong>adaptação provisória</strong>, aguardando aprovação.</p>
      <p class="text-sm muted">O DuskDex é independente e não possui afiliação com Nintendo, Game Freak, Creatures ou The Pokémon Company. Dados e imagens de cartas: TCGdex.</p></div>`);
  };

  await paint();
}
