// #/notificacoes — curtidas, comentários, novos seguidores e trocas.
import { html, render, timeAgo } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data } from '../api/index.js';
import { community } from '../api/community.js';
import { avatar } from './community.js';
import { syncNotifications } from '../shell.js';
import { toastError } from '../components/toast.js';

const ICON = { like: 'heart', comment: 'message', follow: 'userPlus', trade: 'repeat' };
const link = (n) => {
  if (!n.ref) return null;
  if (n.ref.type === 'post') return `#/comunidade/post/${n.ref.id}`;
  if (n.ref.type === 'trade') return '#/trocas';
  if (n.ref.type === 'user' && n.actor) return `#/u/${n.actor.username}`;
  return null;
};

export default async function notificationsPage(ctx, main) {
  const db = data();
  if (db.mode !== 'server' || !db.user) { location.hash = '#/entrar'; return; }
  const paint = async () => {
    let list = [];
    try { list = await community.notifications(); } catch (e) { toastError(e); }
    const unread = list.filter((n) => !n.read).length;
    render(main, html`<div class="page" style="max-width:820px">
      <div class="page-head"><div><div class="page-head__eyebrow">Comunidade</div><h1>Notificações</h1><p>${unread ? `${unread} não lida(s).` : 'Tudo em dia.'}</p></div>
        <div class="btn-group">${unread ? html`<button class="btn" type="button" data-readall>${icon('check')} Marcar todas como lidas</button>` : ''}<a class="btn" href="#/trocas">${icon('repeat')} Trocas</a></div></div>
      ${list.length ? html`<ul class="notif-list">${list.map((n) => {
    const href = link(n);
    const body = html`${n.actor ? avatar(n.actor, 'avatar--sm') : html`<span class="kpi__icon">${icon(ICON[n.type] || 'bell')}</span>`}<div class="grow" style="min-width:0"><div class="notif__text">${icon(ICON[n.type] || 'bell')} ${n.text}</div><div class="text-xs muted">${timeAgo(n.createdAt)}</div></div>${n.read ? '' : html`<span class="notif__dot" aria-label="não lida"></span>`}`;
    return html`<li class="notif ${n.read ? '' : 'is-unread'}">${href ? html`<a class="notif__link" href="${href}" data-n="${n.id}">${body}</a>` : html`<div class="notif__link">${body}</div>`}</li>`;
  })}</ul>` : html`<div class="state"><div class="state__icon">${icon('bell')}</div><h3>Nenhuma notificação</h3><p>Curtidas, comentários, novos seguidores e propostas de troca aparecem aqui.</p></div>`}
    </div>`);
    main.querySelector('[data-readall]')?.addEventListener('click', async () => { try { await community.markRead(); await syncNotifications(); paint(); } catch (e) { toastError(e); } });
    main.querySelectorAll('[data-n]').forEach((a) => a.addEventListener('click', () => { community.markRead([Number(a.dataset.n)]).then(() => syncNotifications()).catch(() => {}); }));
  };
  await paint();
}
