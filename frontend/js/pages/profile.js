import { html, render, fmtInt, timeAgo } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { loadAll } from '../stores/state.js';
import { cardTile, hydrateImages, assetObjectUrl } from '../components/card.js';
import { openModal } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { binderCover } from './binders.js';
import { analyzeDeck } from '../features/domain.js';
import { validateImageFile } from '../features/image-tools.js';
import { on } from '../core/events.js';
import { community } from '../api/community.js';

// iniciais só de letras/números (ignora parênteses, emojis e pontuação)
const initials = (n) => (String(n || '').match(/[\p{L}\p{N}]+/gu) || ['?']).map((p) => [...p][0]).slice(0, 2).join('').toUpperCase();

export default async function profilePage(ctx, main) {
  const db = data();
  const paint = async () => {
    const s = await loadAll(['copies', 'binders', 'decks', 'profile']);
    const online = db.mode === 'server' && !!db.user;
    let pub = null; let posts = [];
    if (online) {
      try { [pub, posts] = await Promise.all([community.profile(db.user.username), community.userPosts(db.user.username).then((r) => r.items)]); } catch { /* servidor fora do ar */ }
    }
    const p = s.profile || { displayName: db.user?.displayName || '', username: db.user?.username || '' };
    const active = s.copies.filter((c) => c.status !== 'removed');
    const seen = new Set(); const highlights = [];
    for (const c of [...active].sort((a, b) => (a.finish === 'holo' ? -1 : 0) - (b.finish === 'holo' ? -1 : 0) || (a.createdAt < b.createdAt ? 1 : -1))) { if (!seen.has(c.cardKey)) { seen.add(c.cardKey); highlights.push(c); } if (highlights.length >= 8) break; }
    const [avatarUrl, bannerUrl] = online ? [p.avatarUrl, p.bannerUrl] : await Promise.all([assetObjectUrl(p.avatarAssetId), assetObjectUrl(p.bannerAssetId)]);
    const privacy = p.privacy || {};
    render(main, html`<div class="page">
      <div class="profile-banner" style="${bannerUrl ? `background-image:url('${bannerUrl}')` : ''}">${bannerUrl ? '' : html`<div class="profile-banner__eclipse"></div>`}</div>
      <div class="profile-head">
        <span class="avatar" style="${avatarUrl ? `background-image:url('${avatarUrl}')` : ''}" aria-hidden="true">${avatarUrl ? '' : initials(p.displayName)}</span>
        <div class="profile-head__info"><h1>${p.displayName || 'Sem nome'}</h1><span class="muted">@${p.username || '—'}</span> ${online ? '' : html`<span class="badge badge--demo">sem conta · só neste navegador</span>`}</div>
        <div class="btn-group">${online ? html`<a class="btn" href="#/u/${p.username}">${icon('eye')} Ver como público</a>` : html`<a class="btn" href="#/registrar">${icon('userPlus')} Criar conta</a>`}<button class="btn btn--primary" type="button" data-edit>${icon('pencil')} Editar perfil</button></div>
      </div>
      <div style="padding:0 var(--sp-6)"><p class="muted mt-3" style="max-width:70ch">${p.bio || 'Sem biografia.'}</p>
        <div class="profile-stats">
          <div class="stat"><span class="stat__value">${fmtInt(active.length)}</span><span class="stat__label">cartas físicas</span></div>
          <div class="stat"><span class="stat__value">${fmtInt(new Set(active.map((c) => c.cardId)).size)}</span><span class="stat__label">impressões</span></div>
          <div class="stat"><span class="stat__value">${s.binders.length}</span><span class="stat__label">fichários</span></div>
          <div class="stat"><span class="stat__value">${s.decks.length}</span><span class="stat__label">decks</span></div>
          ${pub ? html`<a class="stat stat--btn" href="#/u/${p.username}"><span class="stat__value">${fmtInt(pub.followers)}</span><span class="stat__label">seguidores</span></a><a class="stat stat--btn" href="#/u/${p.username}"><span class="stat__value">${fmtInt(pub.following)}</span><span class="stat__label">seguindo</span></a>` : ''}
        </div></div>
      <div class="divider"></div>
      <section style="margin-bottom:28px"><div class="panel__head"><h2 class="panel__title">${icon('sparkles')} Destaques da coleção</h2><a class="btn btn--sm btn--ghost" href="#/colecao">Coleção ${icon('chevronRight')}</a></div>
        ${highlights.length ? html`<div class="card-grid card-grid--sm">${highlights.map((c, i) => cardTile(card(c.cardKey), { index: i, hover: true }))}</div>` : html`<p class="muted text-sm">Sem cartas ainda.</p>`}</section>
      <section style="margin-bottom:28px"><div class="panel__head"><h2 class="panel__title">${icon('book')} Fichários em destaque</h2><a class="btn btn--sm btn--ghost" href="#/ficharios">Todos ${icon('chevronRight')}</a></div>
        ${s.binders.length ? html`<div class="binder-cards" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${s.binders.filter((b) => b.favorite).concat(s.binders.filter((b) => !b.favorite)).slice(0, 4).map((b) => html`<a class="binder-card" href="#/ficharios/${b.id}">${binderCover(b)}<span class="text-xs muted">${b.visibility === 'public' ? 'Público' : b.visibility === 'unlisted' ? 'Não listado' : 'Privado'}</span></a>`)}</div>` : html`<p class="muted text-sm">Nenhum fichário.</p>`}</section>
      <div class="grid-2">
        <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('swords')} Decks</h2></div>
          ${s.decks.length ? html`<div class="stack">${s.decks.map((d) => { const a = analyzeDeck(d, s.copies, card); return html`<a class="progress-row" href="#/decks/${d.id}" style="text-decoration:none;color:inherit"><div class="progress-row__top"><strong>${d.name}</strong><span>${a.have}/${a.need}</span></div><div class="progress progress--sm"><div class="progress__bar" style="width:${a.progress}%"></div></div></a>`; })}</div>` : html`<p class="muted text-sm">Nenhum deck.</p>`}</section>
        <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('message')} Publicações</h2><a class="btn btn--sm btn--ghost" href="#/comunidade">Comunidade ${icon('chevronRight')}</a></div>
          ${!online ? html`<p class="muted text-sm">A comunidade usa contas: <a href="#/registrar">crie a sua</a> para publicar, seguir colecionadores e trocar cartas.</p>`
    : posts.length ? html`<ul class="timeline">${posts.slice(0, 5).map((po) => html`<li><span class="timeline__icon">${icon('message')}</span><div><a class="timeline__text" href="#/comunidade/post/${po.id}" style="color:inherit">${po.body}</a><div class="timeline__time">${timeAgo(po.createdAt)} · ${po.likes} curtida(s) · ${po.comments} comentário(s)</div></div></li>`)}</ul>` : html`<p class="muted text-sm">Nenhuma publicação. Escreva na <a href="#/comunidade">Comunidade</a>.</p>`}</section>
      </div>
      <section class="panel mt-6"><div class="panel__head"><h2 class="panel__title">${icon('shield')} Privacidade do perfil público</h2></div>
        ${!online ? html`<p class="text-sm muted">Sem conta, nada é publicado: estas preferências passam a valer quando você criar uma conta e importar seus dados.</p>` : ''}
        ${[['showStats', 'Mostrar estatísticas da coleção', 'Total de cartas, fichários e decks.'], ['showBinders', 'Mostrar fichários públicos', 'Apenas fichários marcados como “Público”.'], ['showDecks', 'Mostrar decklists públicas', 'Listas de cartas, sem localização física.'], ['showTrades', 'Mostrar cartas para troca', 'Só as cópias que você marcar “para troca”, sem localização.']].map(([k, t, d]) => html`<div class="setting"><div class="setting__text"><strong>${t}</strong><span>${d}</span></div><label class="switch"><input type="checkbox" data-priv="${k}" ${privacy[k] !== false ? 'checked' : ''}><span class="switch__track"></span><span class="sr-only">${t}</span></label></div>`)}
        <div class="setting"><div class="setting__text"><strong>Localização física das cartas</strong><span>Nunca é exibida publicamente.</span></div><label class="switch"><input type="checkbox" disabled><span class="switch__track"></span><span class="sr-only">Localização física (bloqueado)</span></label></div>
      </section>
    </div>`);
    hydrateImages(main);
    main.querySelector('[data-edit]').addEventListener('click', () => editProfile(p));
    main.querySelectorAll('[data-priv]').forEach((cb) => cb.addEventListener('change', async () => {
      try { await db.saveProfile({ privacy: { ...privacy, [cb.dataset.priv]: cb.checked } }); toast({ type: 'success', text: 'Privacidade atualizada.', timeout: 1800 }); } catch (e) { toastError(e); cb.checked = !cb.checked; }
    }));
  };

  const editProfile = (p) => {
    const st = { avatarAssetId: p.avatarAssetId || null, bannerAssetId: p.bannerAssetId || null };
    const m = openModal({
      title: 'Editar perfil',
      body: html`<form class="form-grid" data-f>
        <label class="field"><span class="field__label">Nome de exibição</span><input class="input" name="displayName" maxlength="60" value="${p.displayName || ''}" required></label>
        <label class="field"><span class="field__label">Username</span><input class="input" name="username" maxlength="30" pattern="[a-z0-9._]{3,30}" value="${p.username || ''}" ${db.mode === 'server' ? 'readonly' : ''}><span class="field__hint">3–30 caracteres: letras minúsculas, números, ponto e sublinhado.</span></label>
        <label class="field span-2"><span class="field__label">Biografia</span><textarea class="textarea" name="bio" maxlength="280">${p.bio || ''}</textarea></label>
        ${db.capabilities.assets ? html`<label class="field"><span class="field__label">Avatar</span><input class="input" type="file" accept="image/png,image/jpeg,image/webp" data-up="avatarAssetId" style="padding-top:8px"></label>
        <label class="field"><span class="field__label">Banner</span><input class="input" type="file" accept="image/png,image/jpeg,image/webp" data-up="bannerAssetId" style="padding-top:8px"></label>` : ''}
      </form>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>Salvar</button>`,
    });
    m.body.querySelectorAll('[data-up]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      try { const v = await validateImageFile(f); const meta = await db.addAsset({ blob: f, name: f.name, width: v.width, height: v.height, mime: v.mime }); st[inp.dataset.up] = meta.id; toast({ type: 'success', text: 'Imagem pronta.' }); } catch (e) { toastError(e); inp.value = ''; }
    }));
    m.foot.querySelector('[data-ok]').addEventListener('click', async () => {
      const form = m.body.querySelector('form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const patch = { displayName: String(fd.get('displayName')).trim(), bio: String(fd.get('bio') || ''), ...st };
      if (db.mode !== 'server') patch.username = String(fd.get('username')).trim().toLowerCase();
      try { await db.saveProfile(patch); if (db.refreshMe) await db.refreshMe().catch(() => {}); changed('profile'); m.close(); toast({ type: 'success', text: 'Perfil salvo.' }); paint(); } catch (e) { toastError(e); }
    });
  };

  await paint();
  return on('data:changed', (sc) => { if (sc !== 'profile') paint(); });
}
