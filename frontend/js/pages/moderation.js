// #/moderacao — fila de denúncias (somente contas com papel de moderação: php backend/bin/make-admin.php <username>).
import { html, render, timeAgo } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data } from '../api/index.js';
import { community, REPORT_REASONS } from '../api/community.js';
import { avatar } from './community.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { setQuery } from '../router.js';

export default async function moderation(ctx, main) {
  const db = data();
  if (db.mode !== 'server' || db.user?.role !== 'admin') {
    render(main, html`<div class="page"><div class="state"><div class="state__icon">${icon('shield')}</div><h3>Área de moderação</h3><p>Disponível apenas para contas de moderação.</p></div></div>`);
    return;
  }
  let status = ['open', 'actioned', 'dismissed'].includes(ctx.query.status) ? ctx.query.status : 'open';
  const paint = async () => {
    let list = [];
    try { list = await community.reports(status); } catch (e) { toastError(e); }
    render(main, html`<div class="page page--wide">
      <div class="page-head"><div><div class="page-head__eyebrow">Comunidade</div><h1>Moderação</h1><p>Denúncias de publicações, comentários e perfis. Ocultar remove o conteúdo do feed; em perfis, suspende a conta.</p></div></div>
      <div class="segmented" style="margin-bottom:16px">${[['open', 'Abertas'], ['actioned', 'Com ação'], ['dismissed', 'Arquivadas']].map(([k, l]) => html`<button type="button" data-st="${k}" aria-pressed="${status === k}">${l}</button>`)}</div>
      ${list.length ? html`<div class="stack">${list.map((r) => html`<article class="panel" data-rep="${r.id}">
        <div class="row row--between" style="gap:10px;flex-wrap:wrap"><strong>${{ post: 'Publicação', comment: 'Comentário', user: 'Perfil' }[r.targetType]} · ${REPORT_REASONS[r.reason] || r.reason}</strong><span class="text-xs muted">${r.reports} denúncia(s) · ${timeAgo(r.createdAt)}</span></div>
        ${r.target ? html`<div class="collector" style="padding:8px 0">${avatar(r.target.author, 'avatar--sm')}<div class="grow"><a href="#/u/${r.target.author?.username}">@${r.target.author?.username}</a>${r.target.text ? html`<p class="text-sm" style="white-space:pre-line">${r.target.text}</p>` : ''}${r.target.hidden ? html`<span class="badge">já oculto/suspenso</span>` : ''}</div></div>` : html`<p class="text-sm muted">Conteúdo não existe mais.</p>`}
        ${r.details ? html`<p class="text-sm muted">“${r.details}” — @${r.reporter?.username}</p>` : ''}
        ${status === 'open' ? html`<div class="btn-group"><button class="btn btn--crimson btn--sm" type="button" data-act="hide">${icon('ban')} ${r.targetType === 'user' ? 'Suspender conta' : 'Ocultar'}</button><button class="btn btn--sm" type="button" data-act="dismiss">${icon('check')} Arquivar</button></div>` : ''}
      </article>`)}</div>` : html`<div class="state"><div class="state__icon">${icon('shield')}</div><h3>Nada aqui</h3></div>`}
    </div>`);
    main.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => { status = b.dataset.st; setQuery({ status }); paint(); }));
    main.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-rep]').dataset.rep;
      if (b.dataset.act === 'hide' && !await confirmDialog({ title: 'Confirmar ação de moderação?', danger: true, confirmLabel: 'Confirmar' })) return;
      try { await community.resolveReport(id, b.dataset.act); toast({ type: 'success', text: 'Denúncia resolvida.' }); paint(); } catch (e) { toastError(e); }
    }));
  };
  await paint();
}
