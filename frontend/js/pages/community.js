// Comunidade (#/comunidade, #/comunidade/post/:id, #/u/:handle) — dados reais do servidor DuskDex.
// Ler o feed e perfis é público; publicar, curtir, comentar, seguir e trocar exigem conta.
// Nunca aparecem e-mail, localização física das cartas nem inventário de ninguém.
import { html, render, timeAgo, fmtInt, plural } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, rememberCards, card } from '../api/index.js';
import { community, REPORT_REASONS } from '../api/community.js';
import { cardArt, hydrateImages, zoomCard } from '../components/card.js';
import { pickCards } from '../components/card-picker.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { openMenu } from '../components/menu.js';
import { toast, toastError } from '../components/toast.js';
import { binderCover } from './binders.js';
import { navigate } from '../router.js';

// iniciais só de letras/números (ignora parênteses, emojis e pontuação)
const initials = (n) => (String(n || '').match(/[\p{L}\p{N}]+/gu) || ['?']).map((p) => [...p][0]).slice(0, 2).join('').toUpperCase();

export function avatar(user, size = '') {
  if (user?.avatarUrl) return html`<span class="avatar ${size}" style="background-image:url('${user.avatarUrl}')" aria-hidden="true"></span>`;
  return html`<span class="avatar ${size}" aria-hidden="true">${initials(user?.displayName || user?.username)}</span>`;
}

const me = () => { const db = data(); return db.mode === 'server' && db.user ? db.user : null; };

/** Estado para quando não há servidor (uso sem conta fora do servidor, prévia online). */
function offlineState(main) {
  render(main, html`<div class="page">
    <div class="page-head page-head--art" data-art="community"><div><div class="page-head__eyebrow">Comunidade</div><h1>Comunidade</h1><p>Colecionadores, fichários públicos, publicações e trocas.</p></div></div>
    <div class="state"><div class="state__icon">${icon('users')}</div><h3>A comunidade precisa do servidor DuskDex</h3>
      <p>Publicações, perfis e trocas são compartilhados entre contas e ficam no servidor (PHP + MySQL). Este endereço está sem o servidor — por exemplo, na prévia online ou abrindo só os arquivos do site.</p>
      <p class="text-sm muted">Rodando o projeto com <span class="mono">php -S 127.0.0.1:8080 server.php</span>, a comunidade funciona de verdade — veja o README.</p></div></div>`);
}

function needAccount(text = 'Entre na sua conta para participar.') {
  toast({ type: 'info', title: 'Precisa de conta', text, action: { label: 'Entrar', onClick: () => navigate('/entrar') } });
}

export default async function communityPage(ctx, main) {
  if (!await community.available()) { offlineState(main); return; }
  if (ctx.params.handle) return profileView(ctx, main);
  if (ctx.params.post) return postView(ctx, main);
  return feedView(ctx, main);
}

// ---------------------------------------------------------------- publicações

function attachmentHtml(a) {
  if (!a) return '';
  if (a.type === 'cards') return html`<div class="post__cards">${a.cards.map((c, i) => html`<button type="button" class="card-tile__btn" data-zoom-card="${i}" aria-label="Ampliar ${c.name}">${cardArt(c)}</button>`)}</div>`;
  if (a.type === 'binder') {
    if (!a.binder) return html`<p class="text-sm muted">${a.note}</p>`;
    const b = a.binder;
    return html`<a class="post__binder" href="#/b/${b.id}">${binderCover({ ...b, remote: true }, { showType: true })}<span><strong>${b.name}</strong><span class="text-xs muted">${b.pages} páginas · ${b.progress}% preenchido</span></span></a>`;
  }
  if (a.type === 'deck') {
    if (!a.deck) return html`<p class="text-sm muted">${a.note}</p>`;
    const d = a.deck;
    return html`<a class="post__binder" href="#/d/${d.id}"><div class="post__deck-art">${d.coverCard ? cardArt(d.coverCard) : icon('swords')}</div><span><strong>${d.name}</strong><span class="text-xs muted">Deck ${d.format === 'standard' ? 'Standard' : d.format === 'expanded' ? 'Expanded' : 'livre'} · ${d.total} cartas</span></span></a>`;
  }
  return '';
}

function postHtml(p, { full = false } = {}) {
  const u = p.author || {};
  return html`<article class="post" data-post="${p.id}">
    <header class="post__head">${avatar(u, 'avatar--sm')}<div class="grow" style="min-width:0"><a class="post__author" href="#/u/${u.username}">${u.displayName}</a> <span class="text-xs muted">@${u.username}</span><div class="post__time"><a href="#/comunidade/post/${p.id}" style="color:inherit">${timeAgo(p.createdAt)}</a></div></div>
      <button class="icon-btn" type="button" data-post-menu aria-label="Mais opções">${icon('more')}</button></header>
    <p class="post__body">${p.body}</p>
    ${attachmentHtml(p.attachment)}
    <div class="post__actions">
      <button class="btn btn--sm btn--ghost like-btn" type="button" data-like aria-pressed="${!!p.liked}" aria-label="${p.liked ? 'Descurtir' : 'Curtir'}">${icon('heart')} <span data-likes>${fmtInt(p.likes)}</span></button>
      <button class="btn btn--sm btn--ghost" type="button" data-toggle-comments aria-expanded="${full}">${icon('message')} <span data-ccount>${fmtInt(p.comments)}</span></button>
      <button class="btn btn--sm btn--ghost" type="button" data-share aria-label="Copiar link">${icon('share')}</button>
    </div>
    <div class="comments" data-comments ${full ? '' : 'hidden'}></div>
  </article>`;
}

function commentsHtml(list) {
  const mine = me();
  return html`${list.length ? html`<ul class="comment-list">${list.map((c) => html`<li class="comment" data-comment="${c.id}">${avatar(c.author, 'avatar--xs')}<div class="grow" style="min-width:0"><div><a href="#/u/${c.author?.username}" class="comment__author">${c.author?.displayName}</a> <span class="text-xs muted">${timeAgo(c.createdAt)}</span></div><p>${c.body}</p></div>
      ${c.canDelete ? html`<button class="icon-btn icon-btn--sm" type="button" data-del-comment aria-label="Excluir comentário">${icon('trash')}</button>` : mine ? html`<button class="icon-btn icon-btn--sm" type="button" data-report-comment aria-label="Denunciar comentário">${icon('flag')}</button>` : ''}</li>`)}</ul>` : html`<p class="text-sm muted">Nenhum comentário ainda.</p>`}
    ${mine ? html`<form class="comment-form" data-comment-form><input class="input" name="body" maxlength="500" placeholder="Escreva um comentário…" aria-label="Comentário" required><button class="btn btn--sm btn--primary" type="submit">${icon('send')} Enviar</button></form>` : html`<p class="text-xs muted"><a href="#/entrar">Entre</a> para comentar.</p>`}`;
}

/** Liga os eventos de uma lista de posts (curtir, comentar, excluir, denunciar, compartilhar). */
function bindPosts(root, posts, { onRemoved = () => {} } = {}) {
  hydrateImages(root);
  root.querySelectorAll('[data-post]').forEach((el) => {
    const p = posts.find((x) => x.id === el.dataset.post);
    if (!p) return;
    el.querySelectorAll('[data-zoom-card]').forEach((b) => b.addEventListener('click', () => zoomCard(p.attachment.cards[Number(b.dataset.zoomCard)])));
    el.querySelector('[data-like]').addEventListener('click', async (e) => {
      if (!me()) { needAccount('Entre para curtir publicações.'); return; }
      const btn = e.currentTarget;
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      try { const r = await community.like(p.id, on); p.liked = r.liked; p.likes = r.likes; el.querySelector('[data-likes]').textContent = fmtInt(r.likes); } catch (err) { btn.setAttribute('aria-pressed', String(!on)); toastError(err); }
    });
    const box = el.querySelector('[data-comments]');
    const loadComments = async () => {
      render(box, html`<span class="loader"><span class="loader__eclipse"></span>Carregando…</span>`);
      try {
        const list = await community.comments(p.id);
        render(box, commentsHtml(list));
        box.querySelector('[data-comment-form]')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const f = ev.currentTarget; const body = f.body.value.trim();
          if (!body) return;
          f.querySelector('button').disabled = true;
          try { await community.comment(p.id, body); p.comments++; el.querySelector('[data-ccount]').textContent = fmtInt(p.comments); await loadComments(); } catch (err) { toastError(err); f.querySelector('button').disabled = false; }
        });
        box.querySelectorAll('[data-del-comment]').forEach((b) => b.addEventListener('click', async () => {
          if (!await confirmDialog({ title: 'Excluir comentário?', danger: true, confirmLabel: 'Excluir' })) return;
          try { await community.removeComment(b.closest('[data-comment]').dataset.comment); p.comments = Math.max(0, p.comments - 1); el.querySelector('[data-ccount]').textContent = fmtInt(p.comments); await loadComments(); } catch (err) { toastError(err); }
        }));
        box.querySelectorAll('[data-report-comment]').forEach((b) => b.addEventListener('click', () => reportDialog('comment', b.closest('[data-comment]').dataset.comment)));
      } catch (err) { render(box, html`<p class="text-sm" style="color:var(--danger)">${err.message}</p>`); }
    };
    if (!box.hidden) loadComments();
    el.querySelector('[data-toggle-comments]').addEventListener('click', (e) => {
      box.hidden = !box.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) loadComments();
    });
    el.querySelector('[data-share]').addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#/comunidade/post/${p.id}`;
      try { await navigator.clipboard.writeText(url); toast({ type: 'success', text: 'Link da publicação copiado.', timeout: 2000 }); } catch { toast({ type: 'info', text: url }); }
    });
    el.querySelector('[data-post-menu]').addEventListener('click', (e) => {
      const items = [{ label: 'Ver perfil de @' + p.author?.username, icon: 'user', onClick: () => navigate(`/u/${p.author.username}`) }];
      if (p.canDelete) items.push({ separator: true }, { label: 'Excluir publicação', icon: 'trash', danger: true, onClick: async () => {
        if (!await confirmDialog({ title: 'Excluir publicação?', message: 'Ela some do feed e do perfil. Isso não pode ser desfeito.', danger: true, confirmLabel: 'Excluir' })) return;
        try { await community.remove(p.id); el.remove(); onRemoved(p); toast({ type: 'success', text: 'Publicação excluída.' }); } catch (err) { toastError(err); }
      } });
      else items.push({ label: 'Denunciar publicação', icon: 'flag', onClick: () => reportDialog('post', p.id) });
      openMenu(e.currentTarget, items);
    });
  });
}

export function reportDialog(targetType, targetId) {
  if (!me()) { needAccount('Entre para denunciar conteúdo.'); return; }
  const m = openModal({
    title: 'Denunciar',
    body: html`<form class="stack" data-f><p class="text-sm muted">A moderação analisa cada denúncia. Quem foi denunciado não sabe quem denunciou.</p>
      <label class="field"><span class="field__label">Motivo</span><select class="select" name="reason">${Object.entries(REPORT_REASONS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
      <label class="field"><span class="field__label">Detalhes (opcional)</span><textarea class="textarea" name="details" maxlength="500"></textarea></label></form>`,
    footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--crimson" type="button" data-ok>${icon('flag')} Enviar denúncia</button>`,
  });
  m.foot.querySelector('[data-ok]').addEventListener('click', async () => {
    const fd = new FormData(m.body.querySelector('form'));
    try { const r = await community.report(targetType, targetId, fd.get('reason'), String(fd.get('details') || '')); m.close(); toast({ type: 'success', text: r.message }); } catch (err) { toastError(err); }
  });
}

// ---------------------------------------------------------------- feed

async function feedView(ctx, main) {
  const db = data();
  const user = me();
  const st = { scope: user && ctx.query.aba === 'seguindo' ? 'following' : 'all', posts: [], more: false, attach: null };

  render(main, html`<div class="page page--wide">
    <div class="page-head page-head--art" data-art="community"><div><div class="page-head__eyebrow">Comunidade</div><h1>Comunidade</h1><p>Publicações de colecionadores, fichários públicos e trocas.</p></div>
      ${user ? html`<div class="btn-group"><a class="btn" href="#/u/${user.username}">${icon('user')} Meu perfil público</a><a class="btn" href="#/trocas">${icon('repeat')} Trocas</a></div>` : html`<div class="btn-group"><a class="btn btn--primary" href="#/registrar">${icon('userPlus')} Criar conta para participar</a></div>`}</div>
    <div class="community-layout">
      <section class="feed">
        ${user ? html`<form class="post composer" data-compose>
          <div class="post__head">${avatar(user, 'avatar--sm')}<strong>Nova publicação</strong></div>
          <textarea class="textarea" name="body" maxlength="1000" placeholder="Compartilhe uma página, uma conquista, uma dúvida…" required aria-label="Texto da publicação"></textarea>
          <div data-attached></div>
          <div class="row row--between" style="flex-wrap:wrap;gap:8px"><div class="btn-group">
            <button class="btn btn--sm" type="button" data-attach="cards">${icon('layers')} Cartas</button>
            <button class="btn btn--sm" type="button" data-attach="binder">${icon('book')} Fichário</button>
            <button class="btn btn--sm" type="button" data-attach="deck">${icon('swords')} Deck</button></div>
            <button class="btn btn--sm btn--primary" type="submit">${icon('send')} Publicar</button></div>
        </form>` : ''}
        ${user ? html`<div class="segmented" role="tablist" aria-label="Feed"><button type="button" data-scope="all" aria-pressed="${st.scope === 'all'}">${icon('globe')} Todos</button><button type="button" data-scope="following" aria-pressed="${st.scope === 'following'}">${icon('users')} Quem eu sigo</button></div>` : ''}
        <div class="feed" data-feed><div class="center-loader"><span class="loader"><span class="loader__eclipse"></span>Carregando publicações…</span></div></div>
        <button class="btn" type="button" data-more hidden>Carregar mais</button>
      </section>
      <aside class="stack stack--lg">
        <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('users')} Colecionadores</h2></div>
          <div class="input-group" style="margin-bottom:10px">${icon('search')}<input class="input" type="search" placeholder="Buscar por nome ou @username" data-usearch aria-label="Buscar colecionadores"></div>
          <div class="stack" style="gap:2px" data-users><span class="loader"><span class="loader__eclipse"></span></span></div></section>
        <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('shield')} Boa convivência</h2></div>
          <p class="text-sm muted">Seja gentil. Não publique dados pessoais nem endereços. Trocas são combinadas entre vocês: o DuskDex só registra o que foi acordado — não há pagamentos nem envio pela plataforma. Use “Denunciar” em conteúdo abusivo.</p></section>
      </aside>
    </div></div>`);

  const feedBox = main.querySelector('[data-feed]');
  const moreBtn = main.querySelector('[data-more]');
  const loadFeed = async (reset = true) => {
    try {
      const before = reset ? null : st.posts.at(-1)?.id;
      const r = await community.feed({ scope: st.scope, before });
      st.posts = reset ? r.items : [...st.posts, ...r.items];
      st.more = r.more;
      render(feedBox, st.posts.length ? html`${st.posts.map((p) => postHtml(p))}` : html`<div class="state"><div class="state__icon">${icon('message')}</div><h3>${st.scope === 'following' ? 'Nada por aqui ainda' : 'Nenhuma publicação ainda'}</h3><p>${st.scope === 'following' ? 'Siga colecionadores para ver as publicações deles aqui.' : user ? 'Seja a primeira pessoa a publicar!' : 'Crie uma conta para publicar.'}</p></div>`);
      moreBtn.hidden = !st.more;
      bindPosts(feedBox, st.posts);
    } catch (e) { render(feedBox, html`<div class="state state--error"><div class="state__icon">${icon('alert')}</div><h3>Não foi possível carregar o feed</h3><p>${e.message}</p></div>`); }
  };
  moreBtn.addEventListener('click', () => loadFeed(false));
  main.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    st.scope = b.dataset.scope;
    main.querySelectorAll('[data-scope]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    history.replaceState(null, '', `#/comunidade${st.scope === 'following' ? '?aba=seguindo' : ''}`);
    loadFeed(true);
  }));

  // colecionadores
  const usersBox = main.querySelector('[data-users]');
  const loadUsers = async (q = '') => {
    try {
      const list = (await community.users(q)).slice(0, q ? 20 : 8);
      render(usersBox, list.length ? html`${list.map((u) => html`<div class="collector">${avatar(u, 'avatar--sm')}<a class="grow" href="#/u/${u.username}" style="color:var(--text);min-width:0"><strong class="ellipsis" style="display:block">${u.displayName}</strong><span class="text-xs muted">@${u.username} · ${plural(u.followers, 'seguidor', 'seguidores')}</span></a>
        ${user ? html`<button class="btn btn--sm ${u.isFollowing ? '' : 'btn--primary'}" type="button" data-follow="${u.username}" aria-pressed="${u.isFollowing}">${u.isFollowing ? 'Seguindo' : 'Seguir'}</button>` : ''}</div>`)}` : html`<p class="text-sm muted">${q ? 'Ninguém encontrado.' : 'Ainda não há outros colecionadores.'}</p>`);
      usersBox.querySelectorAll('[data-follow]').forEach((b) => b.addEventListener('click', async () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        try { await community.follow(b.dataset.follow, on); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Seguindo' : 'Seguir'; b.classList.toggle('btn--primary', !on); if (st.scope === 'following') loadFeed(true); } catch (e) { toastError(e); }
      }));
    } catch (e) { render(usersBox, html`<p class="text-sm muted">${e.message}</p>`); }
  };
  let t = null;
  main.querySelector('[data-usearch]').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => loadUsers(e.target.value.trim()), 300); });

  // composer
  const form = main.querySelector('[data-compose]');
  if (form) {
    const attachedBox = form.querySelector('[data-attached]');
    const paintAttach = () => {
      const a = st.attach;
      render(attachedBox, !a ? '' : html`<div class="composer__attach">${a.type === 'cards' ? html`<div class="post__cards">${a.cards.map((k) => cardArt(card(k)))}</div>` : html`<span class="chip">${icon(a.type === 'binder' ? 'book' : 'swords')} ${a.label}</span>`}
        <button class="btn btn--sm btn--ghost" type="button" data-unattach>${icon('x')} Remover anexo</button></div>`);
      hydrateImages(attachedBox);
      attachedBox.querySelector('[data-unattach]')?.addEventListener('click', () => { st.attach = null; paintAttach(); });
    };
    form.querySelectorAll('[data-attach]').forEach((b) => b.addEventListener('click', async () => {
      const kind = b.dataset.attach;
      if (kind === 'cards') {
        const snaps = await pickCards({ title: 'Anexar cartas (até 6)', multi: true, sources: ['collection', 'catalog'], confirmLabel: 'Anexar' });
        if (!snaps?.length) return;
        try { await rememberCards(snaps.slice(0, 6)); } catch (e) { toastError(e); return; }
        st.attach = { type: 'cards', cards: snaps.slice(0, 6).map((s) => s.key) };
      } else {
        const list = kind === 'binder' ? await db.listBinders() : await db.listDecks();
        const choice = await chooseShareable(kind, list);
        if (!choice) return;
        st.attach = { type: kind, id: choice.id, label: choice.name };
      }
      paintAttach();
    }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = form.body.value.trim();
      if (!body) { form.reportValidity(); return; }
      const btn = form.querySelector('[type="submit"]'); btn.disabled = true;
      try {
        const a = st.attach;
        const p = await community.publish(body, a ? (a.type === 'cards' ? { type: 'cards', cards: a.cards } : { type: a.type, id: a.id }) : null);
        form.reset(); st.attach = null; paintAttach();
        st.posts = [p, ...st.posts];
        render(feedBox, html`${st.posts.map((x) => postHtml(x))}`);
        bindPosts(feedBox, st.posts);
        toast({ type: 'success', text: 'Publicado na comunidade.' });
      } catch (err) { toastError(err); }
      btn.disabled = false;
    });
  }

  await Promise.all([loadFeed(true), loadUsers()]);
}

/** Escolhe um fichário/deck para compartilhar; se for privado, oferece torná-lo "não listado". */
async function chooseShareable(kind, list) {
  const db = data();
  const label = kind === 'binder' ? 'fichário' : 'deck';
  if (!list.length) { toast({ type: 'info', text: `Você ainda não tem ${label}s.` }); return null; }
  const picked = await new Promise((resolve) => {
    let r = null;
    const m = openModal({
      title: `Compartilhar ${label}`,
      body: html`<div class="stack" style="gap:6px">${list.map((x) => html`<button class="replace-opt" type="button" data-pick="${x.id}">${icon(kind === 'binder' ? 'book' : 'swords')}<span><strong>${x.name}</strong><small>${x.visibility === 'public' ? 'Público' : x.visibility === 'unlisted' ? 'Não listado (só com o link)' : 'Privado — será tornado “não listado” para compartilhar'}</small></span></button>`)}</div>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button>`,
      onClose: () => resolve(r),
    });
    m.body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { r = list.find((x) => x.id === b.dataset.pick); m.close(); }));
  });
  if (!picked) return null;
  if (picked.visibility === 'private') {
    if (!await confirmDialog({ title: `Tornar o ${label} visível pelo link?`, message: `Para compartilhar, o ${label} fica “não listado”: quem tiver o link vê as cartas e a organização (nunca a localização física nem o inventário). Você pode voltar a deixá-lo privado depois.`, confirmLabel: 'Tornar não listado' })) return null;
    try {
      if (kind === 'binder') await db.updateBinderMeta(picked.id, { visibility: 'unlisted' }, picked.version);
      else await db.saveDeck({ ...picked, visibility: 'unlisted' });
    } catch (e) { toastError(e); return null; }
  }
  return picked;
}

// ---------------------------------------------------------------- publicação individual

async function postView(ctx, main) {
  try {
    const p = await community.post(ctx.params.post);
    render(main, html`<div class="page" style="max-width:760px">
      <a class="btn btn--ghost btn--sm" href="#/comunidade" style="margin-bottom:14px">${icon('arrowLeft')} Comunidade</a>
      <div class="feed">${postHtml(p, { full: true })}</div></div>`);
    bindPosts(main, [p], { onRemoved: () => navigate('/comunidade') });
  } catch (e) {
    render(main, html`<div class="page"><div class="state"><div class="state__icon">${icon('message')}</div><h3>Publicação não encontrada</h3><p>${e.message}</p><a class="btn" href="#/comunidade">Comunidade</a></div></div>`);
  }
}

// ---------------------------------------------------------------- perfil público

async function profileView(ctx, main) {
  const handle = ctx.params.handle;
  let u;
  try { u = await community.profile(handle); } catch (e) {
    render(main, html`<div class="page"><div class="state"><div class="state__icon">${icon('user')}</div><h3>Perfil não encontrado</h3><p>${e.message}</p><a class="btn" href="#/comunidade">Comunidade</a></div></div>`);
    return;
  }
  const user = me();
  const fmtName = (f) => (f === 'standard' ? 'Standard' : f === 'expanded' ? 'Expanded' : 'Livre');
  const paint = () => {
    render(main, html`<div class="page">
      ${u.isMe ? html`<div class="alert" style="margin-bottom:16px">${icon('eye')}<div>É assim que outras pessoas veem seu perfil. <a href="#/perfil">Editar perfil e privacidade</a></div></div>` : ''}
      <div class="profile-banner" style="${u.bannerUrl ? `background-image:url('${u.bannerUrl}')` : ''}">${u.bannerUrl ? '' : html`<div class="profile-banner__eclipse"></div>`}</div>
      <div class="profile-head">${avatar(u)}<div class="profile-head__info"><h1>${u.displayName}</h1><span class="muted">@${u.username}</span>${u.followsYou ? html` <span class="badge">segue você</span>` : ''}</div>
        <div class="btn-group">${u.isMe ? html`<a class="btn" href="#/perfil">${icon('pencil')} Editar</a>` : u.blocked ? html`<button class="btn" type="button" data-unblock>${icon('ban')} Desbloquear</button>` : html`
          <button class="btn ${u.isFollowing ? '' : 'btn--primary'}" type="button" data-follow aria-pressed="${u.isFollowing}">${u.isFollowing ? 'Seguindo' : 'Seguir'}</button>
          ${u.tradable ? html`<a class="btn" href="#/trocas/nova/${u.username}">${icon('repeat')} Propor troca</a>` : ''}
          <button class="btn" type="button" data-pmenu aria-label="Mais opções">${icon('more')}</button>`}</div></div>
      <div style="padding:0 var(--sp-6)">
        ${u.bio ? html`<p class="muted mt-3" style="max-width:70ch;white-space:pre-line">${u.bio}</p>` : ''}
        <div class="profile-stats">
          <button class="stat stat--btn" type="button" data-conn="followers"><span class="stat__value">${fmtInt(u.followers)}</span><span class="stat__label">seguidores</span></button>
          <button class="stat stat--btn" type="button" data-conn="following"><span class="stat__value">${fmtInt(u.following)}</span><span class="stat__label">seguindo</span></button>
          ${u.stats ? html`<div class="stat"><span class="stat__value">${fmtInt(u.stats.cards)}</span><span class="stat__label">cartas</span></div><div class="stat"><span class="stat__value">${fmtInt(u.stats.prints)}</span><span class="stat__label">impressões</span></div><div class="stat"><span class="stat__value">${u.stats.binders}</span><span class="stat__label">fichários</span></div><div class="stat"><span class="stat__value">${u.stats.decks}</span><span class="stat__label">decks</span></div>` : ''}
          ${u.tradable ? html`<div class="stat"><span class="stat__value">${fmtInt(u.tradable)}</span><span class="stat__label">para troca</span></div>` : ''}
        </div>
        <p class="text-xs subtle mt-2">No DuskDex desde ${new Date(u.joinedAt).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}.</p></div>
      <div class="divider"></div>
      ${u.binders ? html`<h2 class="panel__title" style="margin-bottom:12px">${icon('book')} Fichários públicos</h2>
        ${u.binders.length ? html`<div class="binder-cards" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin-bottom:28px">${u.binders.map((b) => html`<a class="binder-card" href="#/b/${b.id}">${binderCover({ ...b, remote: true })}<span class="binder-card__info text-xs muted"><span>${b.pages} pág.</span><span>${b.progress}%</span></span></a>`)}</div>` : html`<p class="muted text-sm" style="margin-bottom:28px">Nenhum fichário público.</p>`}` : ''}
      ${u.decks ? html`<h2 class="panel__title" style="margin-bottom:12px">${icon('swords')} Decks públicos</h2>
        ${u.decks.length ? html`<div class="deck-cards" style="margin-bottom:28px">${u.decks.map((d) => html`<a class="deck-chip" href="#/d/${d.id}"><div class="deck-chip__art">${d.coverCard ? cardArt(d.coverCard) : icon('swords')}</div><span><strong>${d.name}</strong><span class="text-xs muted">${fmtName(d.format)} · ${d.total} cartas</span></span></a>`)}</div>` : html`<p class="muted text-sm" style="margin-bottom:28px">Nenhum deck público.</p>`}` : ''}
      <h2 class="panel__title" style="margin-bottom:12px">${icon('message')} Publicações</h2>
      <div class="feed" data-posts><span class="loader"><span class="loader__eclipse"></span></span></div>
      <p class="text-xs subtle mt-6">A localização física das cartas e o inventário nunca aparecem no perfil público.</p>
    </div>`);
    hydrateImages(main);
    bindProfile();
  };
  const bindProfile = () => {
    main.querySelector('[data-follow]')?.addEventListener('click', async () => {
      if (!user) { needAccount('Entre para seguir colecionadores.'); return; }
      try { const r = await community.follow(u.username, !u.isFollowing); u.isFollowing = r.following; u.followers += r.following ? 1 : -1; paint(); } catch (e) { toastError(e); }
    });
    main.querySelector('[data-unblock]')?.addEventListener('click', async () => {
      try { await community.block(u.username, false); u = await community.profile(handle); paint(); toast({ type: 'success', text: 'Desbloqueado.' }); } catch (e) { toastError(e); }
    });
    main.querySelector('[data-pmenu]')?.addEventListener('click', (e) => openMenu(e.currentTarget, [
      { label: 'Copiar link do perfil', icon: 'share', onClick: async () => { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/u/${u.username}`); toast({ type: 'success', text: 'Link copiado.', timeout: 2000 }); } catch { /* sem permissão */ } } },
      { separator: true },
      { label: 'Denunciar perfil', icon: 'flag', onClick: () => reportDialog('user', u.username) },
      { label: 'Bloquear', icon: 'ban', danger: true, onClick: async () => {
        if (!user) { needAccount(); return; }
        if (!await confirmDialog({ title: `Bloquear @${u.username}?`, message: 'Vocês deixam de se seguir, não veem as publicações um do outro e trocas pendentes entre vocês são canceladas. Dá para desbloquear depois.', danger: true, confirmLabel: 'Bloquear' })) return;
        try { await community.block(u.username, true); u = await community.profile(handle); paint(); toast({ type: 'success', text: 'Bloqueado.' }); } catch (err) { toastError(err); }
      } },
    ]));
    main.querySelectorAll('[data-conn]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const list = await community.connections(u.username, b.dataset.conn);
        const m = openModal({ title: b.dataset.conn === 'followers' ? 'Seguidores' : 'Seguindo', body: html`<div class="stack" style="gap:2px">${list.length ? list.map((x) => html`<a class="collector" href="#/u/${x.username}" style="color:var(--text)">${avatar(x, 'avatar--sm')}<span><strong>${x.displayName}</strong> <span class="text-xs muted">@${x.username}</span></span></a>`) : html`<p class="muted text-sm">Ninguém ainda.</p>`}</div>` });
        m.body.addEventListener('click', (e) => { if (e.target.closest('a')) m.close(); });
      } catch (e) { toastError(e); }
    }));
    loadPosts();
  };
  const loadPosts = async () => {
    const box = main.querySelector('[data-posts]');
    try {
      const r = await community.userPosts(u.username);
      render(box, r.items.length ? html`${r.items.map((p) => postHtml(p))}` : html`<p class="muted text-sm">Sem publicações.</p>`);
      bindPosts(box, r.items);
    } catch (e) { render(box, html`<p class="muted text-sm">${e.message}</p>`); }
  };
  paint();
}
