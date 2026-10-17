// Trocas (#/trocas, #/trocas/nova/:handle). Exigem conta no servidor.
// O DuskDex só registra o combinado entre as pessoas: não há pagamento nem envio pela plataforma.
// Ao aceitar, cada carta sai da coleção de quem entregou e entra (como cópia nova) na de quem recebeu.
import { html, render, timeAgo, plural, normalize } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { community } from '../api/community.js';
import { cardArt, hydrateImages, zoomCard, finishLabel } from '../components/card.js';
import { conditionBadge } from '../features/conditions.js';
import { confirmDialog, openModal } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { avatar } from './community.js';
import { navigate, setQuery } from '../router.js';
import { syncNotifications } from '../shell.js';

const STATUS = { pending: ['Pendente', 'badge--warning'], accepted: ['Concluída', 'badge--success'], declined: ['Recusada', 'badge--danger'], cancelled: ['Cancelada', ''] };

function needServer(main) {
  const db = data();
  render(main, html`<div class="page"><div class="page-head"><div><div class="page-head__eyebrow">Comunidade</div><h1>Trocas</h1></div></div>
    <div class="state"><div class="state__icon">${icon('repeat')}</div><h3>Trocas precisam de uma conta</h3>
    <p>Para combinar trocas com outros colecionadores, entre na sua conta. ${db.mode === 'demo' ? 'Sem conta, seus dados ficam só neste navegador — dá para levá-los para a conta depois.' : ''}</p>
    <div class="btn-group"><a class="btn btn--primary" href="#/entrar">${icon('login')} Entrar</a><a class="btn" href="#/registrar">${icon('userPlus')} Criar conta</a></div></div></div>`);
}

const itemTile = (it, { selectable = false, selected = false, attrs = '' } = {}) => html`<div class="trade-card ${it.available === false ? 'is-unavailable' : ''} ${selected ? 'is-selected' : ''}" ${attrs ? html`${attrs}` : ''}>
  <button type="button" class="card-tile__btn" ${selectable ? html`data-select` : html`data-zoomit="${it.cardKey}"`} aria-pressed="${selected}" aria-label="${it.card?.name || it.cardId}">${cardArt(it.card)}</button>
  <span class="trade-card__meta">${it.card?.name || it.cardId}<br><span class="trade-card__cond">${conditionBadge(it.condition || 'NM')}${it.conditionNow ? html`<span class="trade-card__changed" title="O dono mudou o estado depois da proposta">agora ${conditionBadge(it.conditionNow)}</span>` : ''}</span><span class="text-xs muted">${(it.lang || '').toUpperCase()} · ${finishLabel(it.finish)}${it.inMyWishlist ? ' · ' : ''}${it.inMyWishlist ? html`<span class="wish-dot">${icon('heart')} na sua wishlist</span>` : ''}</span></span>
  ${it.available === false ? html`<span class="badge badge--danger trade-card__flag">${it.conditionNow ? 'estado mudou' : 'indisponível'}</span>` : ''}</div>`;

export default async function tradesPage(ctx, main) {
  const db = data();
  if (db.mode !== 'server' || !db.user) { needServer(main); return; }
  if (ctx.params.handle) return compose(ctx, main);

  let box = ['incoming', 'outgoing', 'history'].includes(ctx.query.aba) ? ctx.query.aba : 'incoming';
  const paint = async () => {
    render(main, html`<div class="page page--wide">
      <div class="page-head"><div><div class="page-head__eyebrow">Comunidade</div><h1>Trocas</h1><p>Proponha trocas a outros colecionadores usando as cartas que eles marcaram “para troca”. O DuskDex registra o combinado e atualiza as duas coleções quando a troca é aceita.</p></div>
        <div class="btn-group"><button class="btn btn--primary" type="button" data-new>${icon('plus')} Nova troca</button><a class="btn" href="#/colecao?troca=1">${icon('layers')} Minhas cartas para troca</a></div></div>
      <div class="segmented" role="tablist" aria-label="Caixas" style="margin-bottom:18px">
        ${[['incoming', 'inbox', 'Recebidas'], ['outgoing', 'send', 'Enviadas'], ['history', 'history', 'Histórico']].map(([k, ic, l]) => html`<button type="button" data-box="${k}" aria-pressed="${box === k}">${icon(ic)} ${l}</button>`)}</div>
      <div class="stack stack--lg" data-list><div class="center-loader"><span class="loader"><span class="loader__eclipse"></span>Carregando…</span></div></div>
      <section class="panel mt-6"><div class="panel__head"><h2 class="panel__title">${icon('shield')} Antes de trocar</h2></div>
        <ul class="text-sm muted" style="margin:0;padding-left:18px;display:grid;gap:6px"><li>Combine envio ou encontro diretamente com a outra pessoa, em local seguro. O DuskDex não intermedeia pagamentos nem entregas.</li><li>Só aceite depois de conferir as cartas: ao aceitar, as coleções são atualizadas na hora.</li><li>Cada carta mostra o estado de conservação informado pelo dono (M, NM, SP, MP, HP, D ou HD). Se o estado mudar depois da proposta, a troca não pode ser aceita — peça uma nova.</li><li>Uma carta que mudou (removida, montada em deck ou já trocada) aparece como “indisponível” e a troca não pode ser aceita.</li><li>Use “Bloquear” no perfil para impedir novas propostas de alguém.</li></ul></section>
    </div>`);
    main.querySelectorAll('[data-box]').forEach((b) => b.addEventListener('click', () => { box = b.dataset.box; setQuery({ aba: box }); paint(); }));
    main.querySelector('[data-new]').addEventListener('click', pickCollector);
    const list = main.querySelector('[data-list]');
    try {
      const trades = await community.trades(box);
      render(list, trades.length ? html`${trades.map(tradeHtml)}` : html`<div class="state"><div class="state__icon">${icon('repeat')}</div><h3>${box === 'incoming' ? 'Nenhuma proposta recebida' : box === 'outgoing' ? 'Nenhuma proposta enviada' : 'Nenhuma troca concluída ainda'}</h3><p>${box === 'history' ? 'Trocas aceitas, recusadas e canceladas aparecem aqui.' : 'Encontre colecionadores na Comunidade e proponha uma troca.'}</p></div>`);
      hydrateImages(list);
      bindTrades(list, trades);
    } catch (e) { render(list, html`<div class="state state--error"><div class="state__icon">${icon('alert')}</div><h3>Não foi possível carregar</h3><p>${e.message}</p></div>`); }
  };

  const tradeHtml = (t) => {
    const other = t.direction === 'incoming' ? t.proposer : t.recipient;
    const [sl, sc] = STATUS[t.status] || [t.status, ''];
    // do ponto de vista de quem está vendo
    const iGive = t.direction === 'incoming' ? t.requested : t.offered;
    const iGet = t.direction === 'incoming' ? t.offered : t.requested;
    return html`<article class="panel trade" data-trade="${t.id}">
      <header class="trade__head">${avatar(other, 'avatar--sm')}<div class="grow"><strong>${t.direction === 'incoming' ? html`<a href="#/u/${other.username}">@${other.username}</a> propôs uma troca` : html`Proposta para <a href="#/u/${other.username}">@${other.username}</a>`}</strong><div class="text-xs muted">${timeAgo(t.createdAt)}${t.respondedAt ? ` · respondida ${timeAgo(t.respondedAt)}` : ''}</div></div><span class="badge ${sc}">${sl}</span></header>
      ${t.message ? html`<blockquote class="trade__msg">${t.message}</blockquote>` : ''}
      <div class="trade__sides">
        <div><h3 class="trade__label">${icon('download')} Você recebe <span class="muted">(${iGet.length})</span></h3>${iGet.length ? html`<div class="trade-grid">${iGet.map((it) => itemTile(it))}</div>` : html`<p class="text-sm muted">Nada — é um presente seu.</p>`}</div>
        <div><h3 class="trade__label">${icon('upload')} Você entrega <span class="muted">(${iGive.length})</span></h3>${iGive.length ? html`<div class="trade-grid">${iGive.map((it) => itemTile(it))}</div>` : html`<p class="text-sm muted">Nada — é um presente para você.</p>`}</div>
      </div>
      ${t.response ? html`<p class="text-sm muted">Resposta: “${t.response}”</p>` : ''}
      ${t.status === 'pending' ? html`<div class="btn-group">${t.direction === 'incoming' ? html`
        <button class="btn btn--primary" type="button" data-accept ${t.available ? '' : 'disabled'} title="${t.available ? '' : 'Uma das cartas não está mais disponível'}">${icon('check')} Aceitar troca</button>
        <button class="btn" type="button" data-decline>${icon('x')} Recusar</button>` : html`<button class="btn" type="button" data-cancel>${icon('x')} Cancelar proposta</button>`}
        ${!t.available ? html`<span class="text-sm" style="color:var(--danger)">${icon('alert')} Alguma carta mudou desde a proposta.</span>` : ''}</div>` : ''}
    </article>`;
  };

  const bindTrades = (root, trades) => {
    root.querySelectorAll('[data-trade]').forEach((el) => {
      const t = trades.find((x) => x.id === el.dataset.trade);
      el.querySelectorAll('[data-zoomit]').forEach((b) => b.addEventListener('click', () => { const it = [...t.offered, ...t.requested].find((x) => x.cardKey === b.dataset.zoomit); if (it?.card) zoomCard(it.card); }));
      el.querySelector('[data-accept]')?.addEventListener('click', async () => {
        const iGive = t.requested.length; const iGet = t.offered.length;
        if (!await confirmDialog({ title: 'Aceitar a troca?', message: `Você entrega ${plural(iGive, 'carta', 'cartas')} e recebe ${plural(iGet, 'carta', 'cartas')}. As duas coleções são atualizadas agora (as cartas recebidas vão para “Sem local definido”). Combine a entrega física com @${t.proposer.username}.`, confirmLabel: 'Aceitar troca' })) return;
        try { await community.accept(t.id); changed('copies'); toast({ type: 'success', title: 'Troca concluída', text: 'As cartas recebidas estão em “Sem local definido” no inventário.', action: { label: 'Ver inventário', onClick: () => navigate('/inventario') } }); syncNotifications(); paint(); } catch (e) { toastError(e); paint(); }
      });
      const close = async (fn, title, label) => {
        const msg = await askMessage(title, label);
        if (msg === null) return;
        try { await fn(t.id, msg); toast({ type: 'success', text: 'Pronto.' }); syncNotifications(); paint(); } catch (e) { toastError(e); }
      };
      el.querySelector('[data-decline]')?.addEventListener('click', () => close(community.decline, 'Recusar a troca?', 'Recusar'));
      el.querySelector('[data-cancel]')?.addEventListener('click', () => close(community.cancel, 'Cancelar a proposta?', 'Cancelar proposta'));
    });
  };

  await paint();
}

function askMessage(title, label) {
  return new Promise((resolve) => {
    let r = null;
    const m = openModal({
      title,
      body: html`<label class="field"><span class="field__label">Mensagem (opcional)</span><textarea class="textarea" maxlength="500" data-msg placeholder="Ex.: já troquei essa carta, obrigado!"></textarea></label>`,
      footer: html`<button class="btn btn--ghost" type="button" data-close>Voltar</button><button class="btn btn--crimson" type="button" data-ok>${label}</button>`,
      onClose: () => resolve(r),
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', () => { r = m.body.querySelector('[data-msg]').value.trim(); m.close(); });
  });
}

async function pickCollector() {
  const m = openModal({
    title: 'Trocar com quem?',
    body: html`<div class="stack"><div class="input-group">${icon('search')}<input class="input" type="search" placeholder="Buscar colecionador" data-q aria-label="Buscar colecionador"></div><div class="stack" style="gap:2px" data-res></div></div>`,
  });
  const res = m.body.querySelector('[data-res]');
  const load = async (q) => {
    try {
      const list = await community.users(q);
      render(res, list.length ? html`${list.map((u) => html`<a class="collector" href="#/trocas/nova/${u.username}" style="color:var(--text)">${avatar(u, 'avatar--sm')}<span><strong>${u.displayName}</strong> <span class="text-xs muted">@${u.username}</span></span></a>`)}` : html`<p class="text-sm muted">Ninguém encontrado.</p>`);
    } catch (e) { render(res, html`<p class="text-sm muted">${e.message}</p>`); }
  };
  let t = null;
  m.body.querySelector('[data-q]').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()), 300); });
  m.body.addEventListener('click', (e) => { if (e.target.closest('a')) m.close(); });
  load('');
}

// ---------------------------------------------------------------- nova proposta

async function compose(ctx, main) {
  const db = data();
  const handle = ctx.params.handle;
  if (handle === db.user.username) { navigate('/trocas'); return; }
  let profile; let theirs;
  try { [profile, theirs] = await Promise.all([community.profile(handle), community.tradable(handle)]); } catch (e) {
    render(main, html`<div class="page"><div class="state"><div class="state__icon">${icon('repeat')}</div><h3>Não foi possível abrir a troca</h3><p>${e.message}</p><a class="btn" href="#/trocas">Trocas</a></div></div>`);
    return;
  }
  const snaps = new Map(theirs.cards.map((c) => [c.key, c]));
  const theirItems = theirs.items.map((it) => ({ ...it, card: snaps.get(it.cardKey) }));
  const mine = (await db.listCopies()).filter((c) => c.status === 'active' && !c.deckAssembled && !c.custom).map((c) => ({ copyId: c.id, cardKey: c.cardKey, cardId: c.cardId, lang: c.lang, finish: c.finish, condition: c.condition || 'NM', card: card(c.cardKey), forTrade: c.forTrade }));
  const st = { want: new Set(), give: new Set(), qThem: '', qMine: '', onlyFlagged: mine.some((c) => c.forTrade) };

  const filter = (list, q) => (q ? list.filter((it) => normalize(it.card?.name || it.cardId).includes(normalize(q))) : list);
  const paint = () => {
    const shownMine = filter(st.onlyFlagged ? mine.filter((c) => c.forTrade) : mine, st.qMine);
    const shownThem = filter(theirItems, st.qThem);
    render(main, html`<div class="page page--wide">
      <a class="btn btn--ghost btn--sm" href="#/trocas" style="margin-bottom:14px">${icon('arrowLeft')} Trocas</a>
      <div class="page-head"><div><div class="page-head__eyebrow">Nova troca</div><h1>Trocar com @${profile.username}</h1><p>Escolha o que você quer das cartas que ${profile.displayName} marcou para troca, e o que você oferece em troca.</p></div></div>
      <div class="trade-compose">
        <section class="panel"><div class="panel__head"><h2 class="panel__title">${avatar(profile, 'avatar--xs')} Cartas de @${profile.username} <span class="badge">${st.want.size} escolhida(s)</span></h2></div>
          ${theirItems.length ? html`<div class="input-group" style="margin-bottom:10px">${icon('search')}<input class="input" type="search" placeholder="Filtrar" value="${st.qThem}" data-qthem aria-label="Filtrar cartas de @${profile.username}"></div>
          <div class="trade-grid trade-grid--pick">${shownThem.map((it) => itemTile(it, { selectable: true, selected: st.want.has(it.copyId), attrs: html`data-them="${it.copyId}"` }))}</div>`
    : html`<p class="text-sm muted">${theirs.hidden ? 'Este perfil não mostra cartas para troca.' : `@${profile.username} ainda não marcou cartas para troca. Você pode oferecer cartas suas mesmo assim (um presente) ou deixar uma mensagem.`}</p>`}</section>
        <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('layers')} Suas cartas <span class="badge">${st.give.size} escolhida(s)</span></h2>
          <label class="checkbox text-sm"><input type="checkbox" data-flagged ${st.onlyFlagged ? 'checked' : ''}> Só as marcadas para troca</label></div>
          <div class="input-group" style="margin-bottom:10px">${icon('search')}<input class="input" type="search" placeholder="Filtrar" value="${st.qMine}" data-qmine aria-label="Filtrar suas cartas"></div>
          ${shownMine.length ? html`<div class="trade-grid trade-grid--pick">${shownMine.slice(0, 300).map((it) => itemTile(it, { selectable: true, selected: st.give.has(it.copyId), attrs: html`data-mine="${it.copyId}"` }))}</div>${shownMine.length > 300 ? html`<p class="text-xs muted">Mostrando 300 de ${shownMine.length}. Use o filtro.</p>` : ''}` : html`<p class="text-sm muted">Nenhuma carta disponível.</p>`}</section>
      </div>
      <section class="panel mt-6 stack">
        <label class="field"><span class="field__label">Mensagem para @${profile.username} (opcional)</span><textarea class="textarea" maxlength="500" data-msg placeholder="Ex.: posso entregar no evento de sábado.">${st.msg || ''}</textarea></label>
        <div class="row row--between" style="flex-wrap:wrap;gap:12px"><span class="text-sm muted">Você recebe ${plural(st.want.size, 'carta', 'cartas')} e entrega ${plural(st.give.size, 'carta', 'cartas')}.</span>
          <button class="btn btn--primary btn--lg" type="button" data-send ${st.want.size + st.give.size ? '' : 'disabled'}>${icon('send')} Enviar proposta</button></div></section>
    </div>`);
    hydrateImages(main);
    main.querySelectorAll('[data-them] [data-select]').forEach((b) => b.addEventListener('click', () => { const id = b.closest('[data-them]').dataset.them; if (st.want.has(id)) st.want.delete(id); else st.want.add(id); keep(); paint(); }));
    main.querySelectorAll('[data-mine] [data-select]').forEach((b) => b.addEventListener('click', () => { const id = b.closest('[data-mine]').dataset.mine; if (st.give.has(id)) st.give.delete(id); else st.give.add(id); keep(); paint(); }));
    const refocus = (sel, key) => main.querySelector(sel)?.addEventListener('input', (e) => { st[key] = e.target.value; keep(); paint(); const el = main.querySelector(sel); el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
    refocus('[data-qthem]', 'qThem'); refocus('[data-qmine]', 'qMine');
    main.querySelector('[data-flagged]').addEventListener('change', (e) => { st.onlyFlagged = e.target.checked; keep(); paint(); });
    main.querySelector('[data-send]').addEventListener('click', async (e) => {
      keep();
      e.currentTarget.disabled = true;
      try {
        await community.propose({ to: profile.username, give: [...st.give], want: [...st.want], message: st.msg || '' });
        toast({ type: 'success', title: 'Proposta enviada', text: `@${profile.username} vai receber uma notificação.` });
        navigate('/trocas?aba=outgoing');
      } catch (err) { toastError(err); e.currentTarget.disabled = false; }
    });
  };
  const keep = () => { const m = main.querySelector('[data-msg]'); if (m) st.msg = m.value; };
  paint();
}
