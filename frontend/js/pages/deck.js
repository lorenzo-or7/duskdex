import { html, render, debounce } from '../core/html.js';
import { icon } from '../core/icons.js';
import { data, card, changed } from '../api/index.js';
import { analyzeDeck, validateDeck, pickCopiesForDeck, equivalenceStatus, DECK_FORMATS } from '../features/domain.js';
import { cardArt, hydrateImages, finishLabel, zoomCard } from '../components/card.js';
import { pickCards } from '../components/card-picker.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { openMenu } from '../components/menu.js';
import { toast, toastError } from '../components/toast.js';
import { navigate } from '../router.js';
import { loadAll, copyWhere } from '../stores/state.js';
import { locationOptions } from '../features/actions.js';
import { cardImageUrl } from '../api/tcgdex.js';
import { escape } from '../core/html.js';

const GROUPS = [['Pokemon', 'Pokémon'], ['Trainer', 'Treinador'], ['Energy', 'Energia'], ['?', 'Sem categoria (dados parciais)']];
const EQ = { confirmed: ['badge--success', 'Compatibilidade confirmada'], review: ['badge--warning', 'Requer revisão'], not_allowed: ['badge--danger', 'Não permitido'] };

export default async function deckPage(ctx, main) {
  const db = data();
  let deck = await db.getDeck(ctx.params.id);
  if (!deck) { render(main, html`<div class="page"><div class="state state--error"><div class="state__icon">${icon('swords')}</div><h3>Deck não encontrado</h3><a class="btn btn--primary" href="#/decks">Ver decks</a></div></div>`); return; }
  let s = await loadAll(['copies', 'binders', 'locations', 'decks', 'wishlist']);
  const save = { state: 'saved', at: deck.updatedAt, rev: 0 };

  const persist = async () => {
    save.state = 'saving'; paintStatus();
    try {
      // O objeto local continua sendo a fonte da verdade da tela (os botões +/− apontam para ele);
      // do salvo só vêm os metadados. Edições feitas durante o salvamento não se perdem.
      const sent = save.rev;
      const saved = await db.saveDeck(deck);
      const { cards, name, description, format, ...meta } = saved;
      Object.assign(deck, meta);
      save.at = deck.updatedAt; changed('decks');
      save.state = save.rev === sent ? 'saved' : 'dirty';
    } catch (e) {
      save.state = 'error'; save.error = e.message;
      if (e.code === 'CONFLICT') { toast({ type: 'warning', title: 'Conflito', text: 'O deck foi alterado em outra aba. Recarregando a versão atual.' }); deck = await db.getDeck(deck.id); paint(); }
      else toastError(e);
    }
    paintStatus();
  };
  const autosave = debounce(persist, 700);
  const dirty = () => { save.rev++; save.state = 'dirty'; paintStatus(); autosave(); };

  const paintStatus = () => {
    const el = main.querySelector('[data-save]');
    if (!el) return;
    const t = { saved: `${icon('check')} Salvo${db.mode === 'demo' ? ' neste navegador' : ' no servidor'} às ${new Date(save.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, saving: 'Salvando…', dirty: 'Alterações pendentes…', error: `${icon('alert')} Falha ao salvar` }[save.state];
    el.innerHTML = String(t);
    el.style.color = save.state === 'error' ? 'var(--danger)' : save.state === 'saved' ? 'var(--success)' : 'var(--text-2)';
  };

  const paint = () => {
    const a = analyzeDeck(deck, s.copies, card);
    const v = validateDeck(deck, card);
    const groups = GROUPS.map(([k, label]) => ({ k, label, lines: a.lines.filter((l) => (l.card?.category || '?') === k) })).filter((g) => g.lines.length);
    const [sl, sc] = { virtual: ['Virtual', ''], reserved: ['Reservas feitas (local)', 'badge--warning'], assembled: ['Montado fisicamente', 'badge--success'] }[deck.status] || ['Virtual', ''];
    render(main, html`<div class="page page--wide">
      <a class="btn btn--ghost btn--sm" href="#/decks" style="margin-bottom:14px">${icon('arrowLeft')} Decks</a>
      <div class="page-head" style="align-items:center">
        <div class="grow" style="min-width:260px">
          <div class="page-head__eyebrow">Deck Builder <span class="badge ${sc}" style="margin-left:8px">${sl}</span></div>
          <h1 class="sr-only">${deck.name}</h1>
          <input class="input display" style="font-size:2rem;height:56px;background:transparent;border-color:transparent;padding-left:0" value="${deck.name}" maxlength="80" data-name aria-label="Nome do deck">
          <div class="row text-sm" style="gap:12px"><span data-save></span></div>
        </div>
        <div class="btn-group">
          <select class="select" style="width:auto" data-format aria-label="Formato">${Object.entries(DECK_FORMATS).map(([k, f]) => html`<option value="${k}" ${deck.format === k ? 'selected' : ''}>${f.label}</option>`)}</select>
          <button class="btn" type="button" data-more aria-label="Mais ações">${icon('more')}</button>
          <button class="btn" type="button" data-savenow>${icon('check')} Salvar</button>
          <button class="btn btn--primary" type="button" data-add>${icon('plus')} Adicionar cartas</button>
        </div>
      </div>
      <textarea class="textarea" data-desc maxlength="600" placeholder="Descrição, estratégia, observações…" style="min-height:60px;margin-bottom:20px">${deck.description || ''}</textarea>
      <div class="deck-layout">
        <section class="panel">
          <div class="panel__head"><h2 class="panel__title">${icon('list')} Lista · ${v.total} carta(s)</h2><span class="text-xs muted">possui / disponível / falta</span></div>
          ${deck.cards.length ? html`<div class="deck-list">${groups.map((g) => html`<div class="deck-group"><h3><span>${g.label}</span><span>${g.lines.reduce((n, l) => n + l.qty, 0)}</span></h3>
            ${g.lines.map((l) => {
    const cands = l.candidates.length ? l.candidates : [];
    return html`<div class="deck-line" data-key="${l.cardKey}">
                <button type="button" class="card-tile__btn" data-zoom aria-label="Ampliar ${l.card?.name || ''}">${cardArt(l.card)}</button>
                <div style="min-width:0"><div class="deck-line__name">${l.card?.name || l.cardKey} <span class="text-xs muted">${l.card?.set?.name || ''} ${l.card?.localId ? `#${l.card.localId}` : ''}</span></div>
                  <div class="deck-line__own"><span class="${l.owned >= l.qty ? 'ok' : ''}">possui ${l.owned}</span><span class="${l.available >= l.qty ? 'ok' : ''}">disponível ${l.available}</span>${l.reservedElsewhere ? html`<span class="res">${l.reservedElsewhere} em outro deck</span>` : ''}${l.reservedHere ? html`<span class="res">${l.reservedHere} reservada(s)</span>` : ''}${l.missing ? html`<span class="miss">faltam ${l.missing}</span>` : html`<span class="ok">${icon('check')} completo</span>`}
                  ${cands.length && l.missing ? html`<button class="badge badge--warning" type="button" data-eq style="cursor:pointer">${cands.length} impressão(ões) possivelmente equivalente(s)</button>` : ''}</div></div>
                <div class="row" style="gap:4px"><div class="stepper stepper--sm"><button type="button" data-dec aria-label="Diminuir">${icon('minus')}</button><output>${l.qty}</output><button type="button" data-inc aria-label="Aumentar">${icon('plus')}</button></div><button class="icon-btn" type="button" data-rm aria-label="Remover da lista">${icon('x')}</button></div>
              </div>`;
  })}</div>`)}</div>` : html`<div class="state"><div class="state__icon">${icon('swords')}</div><h3>Lista vazia</h3><p>Adicione cartas do catálogo, da sua coleção ou dos exemplos offline.</p><button class="btn btn--primary" type="button" data-add2>${icon('plus')} Adicionar cartas</button></div>`}
        </section>
        <aside class="deck-sticky stack stack--lg">
          <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('layers')} Coleção</h2><span class="badge ${a.missing ? 'badge--warning' : 'badge--success'}">${a.progress}%</span></div>
            <div class="progress"><div class="progress__bar" style="width:${a.progress}%"></div></div>
            <div class="row row--between text-sm mt-3"><span>Necessárias <strong>${a.need}</strong></span><span>Disponíveis <strong>${a.have}</strong></span><span>Faltam <strong style="color:${a.missing ? 'var(--danger)' : 'var(--success)'}">${a.missing}</strong></span></div>
            <p class="text-xs muted mt-2">Conta apenas a mesma impressão (mesmo id TCGdex, qualquer idioma). Cópias reservadas para outros decks não contam como disponíveis.</p>
            <div class="btn-group mt-3"><button class="btn btn--sm" type="button" data-wishmissing ${a.missing ? '' : 'disabled'}>${icon('heart')} Faltantes → Wishlist</button></div></section>
          <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('shield')} Validação</h2><span class="badge ${v.structural === 'valid' ? 'badge--success' : v.structural === 'invalid' ? 'badge--danger' : 'badge--warning'}">${v.structural === 'valid' ? 'Estruturalmente válido' : v.structural === 'invalid' ? 'Inválido' : 'Parcial'}</span>${v.legal === 'legal' ? html`<span class="badge badge--success">Legal</span>` : v.legal === 'illegal' ? html`<span class="badge badge--danger">Carta fora do formato</span>` : ''}</div>
            <div class="validity">${v.checks.map((c) => html`<div class="validity__item validity__item--${c.status === 'ok' ? 'ok' : c.status === 'bad' ? 'bad' : 'unknown'}">${icon(c.status === 'ok' ? 'check' : c.status === 'bad' ? 'x' : 'alert')}<span>${c.text}</span></div>`)}</div>
            <p class="text-xs muted mt-3">Regras estruturais e legalidade por carta (lista pública da TCGdex). Confirme rotação e banimentos no anúncio oficial antes de torneios.</p></section>
          <section class="panel"><div class="panel__head"><h2 class="panel__title">${icon('package')} Deck físico</h2></div>
            ${deck.status === 'assembled' ? html`<p class="text-sm muted">As cartas estão no local “Deck box · ${deck.name}”. Cada cópia está alocada somente neste deck.</p><div class="btn-group mt-3"><button class="btn btn--sm" type="button" data-picklist>${icon('list')} Lista de cartas</button><button class="btn btn--sm btn--danger" type="button" data-disassemble>Desmontar</button></div>`
    : html`<p class="text-sm muted">Verifique disponibilidade, escolha cópias, reserve, gere a lista de separação e confirme a montagem.</p>
              ${!db.capabilities.deckAssembly ? html`<p class="text-xs" style="color:var(--warning)">Indisponível neste modo.</p>` : db.mode === 'demo' ? html`<p class="text-xs" style="color:var(--warning)">Sem conta, reservas e montagem ficam apenas neste navegador.</p>` : ''}
              <div class="btn-group mt-3"><button class="btn btn--sm btn--primary" type="button" data-assemble ${deck.cards.length && db.capabilities.deckAssembly ? '' : 'disabled'}>${icon('swords')} Montagem física</button>${deck.status === 'reserved' ? html`<button class="btn btn--sm btn--ghost" type="button" data-release>Liberar reservas</button>` : ''}</div>`}
          </section>
        </aside>
      </div></div>`);
    hydrateImages(main);
    paintStatus();
    bind(a);
  };

  const bind = (a) => {
    const $ = (q) => main.querySelector(q);
    $('[data-name]').addEventListener('input', (e) => { deck.name = e.target.value.trim() || deck.name; dirty(); });
    $('[data-desc]').addEventListener('input', (e) => { deck.description = e.target.value; dirty(); });
    $('[data-format]').addEventListener('change', (e) => { deck.format = e.target.value; dirty(); paint(); });
    $('[data-savenow]').addEventListener('click', () => { autosave.cancel(); persist(); });
    const add = async () => {
      const snaps = await pickCards({ title: 'Adicionar cartas ao deck', multi: true, confirmLabel: 'Adicionar ao deck' });
      if (!snaps?.length) return;
      for (const sn of snaps) {
        const line = deck.cards.find((l) => l.cardKey === sn.key);
        if (line) line.qty = Math.min(60, line.qty + 1); else deck.cards.push({ cardKey: sn.key, cardId: sn.id, qty: 1 });
      }
      paint(); dirty();
    };
    $('[data-add]').addEventListener('click', add);
    $('[data-add2]')?.addEventListener('click', add);
    main.querySelectorAll('.deck-line').forEach((row) => {
      // a linha é buscada no momento do clique, sempre no deck atual
      const key = row.dataset.key;
      const lineNow = () => deck.cards.find((l) => l.cardKey === key);
      const line = lineNow();
      const info = a.lines.find((l) => l.cardKey === key);
      row.querySelector('[data-inc]').addEventListener('click', () => { const l = lineNow(); if (!l) return; l.qty = Math.min(60, l.qty + 1); paint(); dirty(); });
      row.querySelector('[data-dec]').addEventListener('click', () => { const l = lineNow(); if (l && l.qty > 1) { l.qty--; paint(); dirty(); } });
      row.querySelector('[data-rm]').addEventListener('click', () => { deck.cards = deck.cards.filter((l) => l.cardKey !== key); paint(); dirty(); });
      row.querySelector('[data-zoom]').addEventListener('click', () => zoomCard(info.card, info.card?.source === 'custom' ? null : cardImageUrl(info.card?.image, 'high')));
      row.querySelector('[data-eq]')?.addEventListener('click', () => equivalenceDialog(line, info));
    });
    $('[data-more]').addEventListener('click', (e) => openMenu(e.currentTarget, [
      { label: 'Duplicar deck', icon: 'copy', onClick: async () => { try { const d = await db.duplicateDeck(deck.id); changed('decks'); navigate(`/decks/${d.id}`); } catch (err) { toastError(err); } } },
      { label: 'Exportar lista (texto)', icon: 'download', onClick: exportText },
      { separator: true },
      { label: 'Excluir deck', icon: 'trash', danger: true, onClick: async () => {
        if (!await confirmDialog({ title: `Excluir “${deck.name}”?`, message: 'Reservas deste deck serão liberadas. Decks montados precisam ser desmontados antes.', danger: true, confirmLabel: 'Excluir' })) return;
        try { await db.deleteDeck(deck.id); changed('decks'); navigate('/decks'); } catch (err) { toastError(err); }
      } },
    ]));
    $('[data-wishmissing]')?.addEventListener('click', async () => {
      let n = 0;
      for (const l of a.lines.filter((x) => x.missing)) { await db.addWishlist({ cardKey: l.cardKey, cardId: l.cardId, qty: l.missing, note: `Para o deck “${deck.name}”` }); n++; }
      changed('wishlist');
      toast({ type: 'success', text: `${n} carta(s) faltante(s) adicionada(s) à Wishlist.`, action: { label: 'Ver', onClick: () => navigate('/wishlist') } });
    });
    $('[data-assemble]')?.addEventListener('click', assembleFlow);
    $('[data-release]')?.addEventListener('click', async () => { try { await db.releaseReservations(deck.id); deck = await db.getDeck(deck.id); s = await loadAll(['copies', 'binders', 'locations', 'decks', 'wishlist']); changed('decks'); paint(); toast({ type: 'success', text: 'Reservas liberadas.' }); } catch (e) { toastError(e); } });
    $('[data-disassemble]')?.addEventListener('click', disassembleFlow);
    $('[data-picklist]')?.addEventListener('click', () => pickListDialog(s.copies.filter((c) => c.reservedFor === deck.id), 'Cartas do deck montado'));
  };

  const equivalenceDialog = (line, info) => {
    const m = openModal({
      title: `Impressões equivalentes · ${info.card?.name || ''}`, size: 'lg',
      body: html`<div class="stack"><p class="muted text-sm">Comparação por identidade de jogo (nome, categoria e textos de ataque/habilidade/efeito) — nunca só pelo nome. Rotação, banimentos e erratas não são verificados.</p>
        <div class="card-list">${info.candidates.map((c) => {
    const cd = card(c.cardKey); const eq = equivalenceStatus(info.card, cd);
    return html`<div class="card-row" style="grid-template-columns:48px minmax(0,1fr) auto"><div style="width:48px">${cardArt(cd)}</div>
            <div class="card-row__main"><div class="card-row__name">${cd?.name} <span class="text-xs muted">${cd?.set?.name || ''} #${cd?.localId || ''} · ${c.lang.toUpperCase()} · ${finishLabel(c.finish)}</span></div><div class="card-row__meta"><span class="badge ${EQ[eq.status][0]}">${EQ[eq.status][1]}</span><span>${eq.reason}</span></div></div>
            <button class="btn btn--sm" type="button" data-use="${c.cardKey}" ${eq.status === 'not_allowed' ? 'disabled' : ''}>Usar esta impressão</button></div>`;
  })}</div></div>`,
    });
    hydrateImages(m.body);
    m.body.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', async () => {
      const cd = card(b.dataset.use);
      const ok = await confirmDialog({ title: 'Substituir impressão?', message: `A linha passará a usar ${cd.name} (${cd.set?.name || ''} #${cd.localId}). Confirme que a substituição é aceitável no formato em que você vai jogar.`, confirmLabel: 'Substituir' });
      if (!ok) return;
      const existing = deck.cards.find((l) => l.cardKey === cd.key && l !== line);
      if (existing) { existing.qty += line.qty; deck.cards = deck.cards.filter((l) => l !== line); } else { line.cardKey = cd.key; line.cardId = cd.id; }
      m.close(); paint(); dirty();
    }));
  };

  const exportText = () => {
    const lines = deck.cards.map((l) => { const c = card(l.cardKey); return `${l.qty} ${c?.name || l.cardId} ${c?.set?.id ? c.set.id.toUpperCase() : ''} ${c?.localId || ''}`.trim(); }).join('\n');
    const m = openModal({ title: 'Exportar decklist', body: html`<textarea class="textarea mono" style="min-height:260px" readonly>${`${deck.name}\n\n${lines}`}</textarea><p class="text-xs muted mt-2">Compartilhar a lista não expõe localização física das cartas.</p>`, footer: html`<button class="btn btn--primary" type="button" data-copy>${icon('copy')} Copiar</button>` });
    m.foot.querySelector('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(m.body.querySelector('textarea').value); toast({ type: 'success', text: 'Lista copiada.' }); } catch { m.body.querySelector('textarea').select(); } });
  };

  const pickListDialog = (copies, title) => {
    const ctx2 = s;
    const sorted = [...copies].sort((x, y) => copyWhere(x, ctx2).localeCompare(copyWhere(y, ctx2)));
    const m = openModal({
      title, size: 'lg',
      body: html`<div class="table-wrap"><table class="table"><thead><tr><th style="width:34px"></th><th>Carta</th><th>Onde pegar</th></tr></thead><tbody>${sorted.map((c) => html`<tr><td><input type="checkbox" class="checkbox" aria-label="Separada"></td><td><strong>${card(c.cardKey)?.name || '—'}</strong> <span class="text-xs muted">${c.lang.toUpperCase()} · ${finishLabel(c.finish)}</span></td><td class="text-sm">${copyWhere(c, ctx2)}</td></tr>`)}</tbody></table></div>`,
      footer: html`<button class="btn" type="button" data-print>${icon('printer')} Imprimir lista</button><button class="btn btn--primary" type="button" data-close>Fechar</button>`,
    });
    m.foot.querySelector('[data-print]').addEventListener('click', () => {
      const w = window.open('', '_blank');
      if (!w) return toast({ type: 'warning', text: 'Permita pop-ups para imprimir.' });
      w.document.write(`<!doctype html><meta charset="utf-8"><title>Lista de separação — ${escape(deck.name)}</title><style>body{font-family:system-ui;padding:24px}td,th{padding:6px 10px;border-bottom:1px solid #ccc;text-align:left}</style><h2>Lista de separação — ${escape(deck.name)}</h2><table><tr><th>✓</th><th>Carta</th><th>Onde pegar</th></tr>${sorted.map((c) => `<tr><td>☐</td><td>${escape(card(c.cardKey)?.name || '')}</td><td>${escape(copyWhere(c, ctx2))}</td></tr>`).join('')}</table><script>print()<\/script>`);
      w.document.close();
    });
  };

  const assembleFlow = async () => {
    if (!deck.cards.length) return;
    autosave.cancel(); await persist();
    s = await loadAll(['copies', 'binders', 'locations', 'decks', 'wishlist']);
    const a = analyzeDeck(deck, s.copies, card);
    const { picks, shortages } = pickCopiesForDeck(deck, s.copies);
    const chosen = new Set(picks.map((p) => p.copyId));
    let step = 1;
    const m = openModal({ title: 'Montagem física do deck', size: 'xl', body: html`<div data-flow></div>`, footer: html`<div data-foot style="display:contents"></div>` });
    const flow = m.body.querySelector('[data-flow]');
    const foot = m.foot.querySelector('[data-foot]');
    const steps = () => html`<div class="steps" aria-label="Etapa ${step} de 4">${[1, 2, 3, 4].map((i) => html`<span class="${i <= step ? 'is-done' : ''}"></span>`)}</div>`;
    const paintStep = () => {
      if (step === 1) {
        render(flow, html`${steps()}<h3 style="margin-bottom:10px">1 · Disponibilidade</h3>
          <div class="table-wrap"><table class="table"><thead><tr><th>Carta</th><th class="num">Precisa</th><th class="num">Possui</th><th class="num">Disponível</th><th class="num">Falta</th></tr></thead><tbody>
          ${a.lines.map((l) => html`<tr><td>${l.card?.name || l.cardKey}</td><td class="num">${l.qty}</td><td class="num">${l.owned}</td><td class="num">${l.available}${l.reservedElsewhere ? html` <span class="text-xs" style="color:var(--warning)">(${l.reservedElsewhere} em outro deck)</span>` : ''}</td><td class="num" style="color:${l.missing ? 'var(--danger)' : 'var(--success)'}">${l.missing}</td></tr>`)}
          </tbody></table></div>
          ${shortages.length ? html`<div class="alert alert--warning mt-3">${icon('alert')}<div>Faltam ${a.missing} carta(s). Você pode montar parcialmente agora e adicionar as faltantes à Wishlist.</div></div>` : html`<div class="alert alert--success mt-3">${icon('check')}<div>Todas as cartas estão disponíveis.</div></div>`}`);
        render(foot, html`<button class="btn btn--ghost" type="button" data-x>Cancelar</button><button class="btn btn--primary" type="button" data-n ${picks.length ? '' : 'disabled'}>Escolher cópias ${icon('chevronRight')}</button>`);
      } else if (step === 2) {
        const pool = s.copies.filter((c) => c.status !== 'removed' && deck.cards.some((l) => l.cardId === c.cardId) && (!c.reservedFor || c.reservedFor === deck.id));
        render(flow, html`${steps()}<h3 style="margin-bottom:10px">2 · Cópias escolhidas</h3><p class="text-sm muted" style="margin-bottom:10px">Selecionamos primeiro cópias já reservadas e as que não estão em fichários. Ajuste se preferir.</p>
          <div class="table-wrap"><table class="table"><thead><tr><th style="width:34px"></th><th>Carta</th><th>Versão</th><th>Onde está</th></tr></thead><tbody>
          ${pool.map((c) => html`<tr><td><input type="checkbox" class="checkbox" data-c="${c.id}" ${chosen.has(c.id) ? 'checked' : ''} ${c.deckAssembled && c.reservedFor !== deck.id ? 'disabled' : ''}></td><td>${card(c.cardKey)?.name}</td><td class="text-sm">${c.lang.toUpperCase()} · ${finishLabel(c.finish)}</td><td class="text-sm">${copyWhere(c, s)}</td></tr>`)}
          </tbody></table></div><p class="text-sm mt-3" data-cnt></p>`);
        const upd = () => {
          const over = deck.cards.filter((l) => [...chosen].filter((id) => s.copies.find((c) => c.id === id)?.cardId === l.cardId).length > l.qty);
          flow.querySelector('[data-cnt]').innerHTML = `${chosen.size} cópia(s) selecionada(s)${over.length ? ` · <span style="color:var(--danger)">acima do necessário: ${over.map((l) => escape(card(l.cardKey)?.name || '')).join(', ')}</span>` : ''}`;
          foot.querySelector('[data-n]').disabled = !chosen.size || over.length > 0;
        };
        render(foot, html`<button class="btn btn--ghost" type="button" data-b>${icon('chevronLeft')} Voltar</button><button class="btn btn--primary" type="button" data-n>Reservar cópias ${icon('chevronRight')}</button>`);
        flow.querySelectorAll('[data-c]').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) chosen.add(cb.dataset.c); else chosen.delete(cb.dataset.c); upd(); }));
        upd();
      } else if (step === 3) {
        const list = s.copies.filter((c) => chosen.has(c.id));
        const sorted = [...list].sort((x, y) => copyWhere(x, s).localeCompare(copyWhere(y, s)));
        render(flow, html`${steps()}<h3 style="margin-bottom:10px">3 · Lista de separação</h3>
          <div class="alert" style="margin-bottom:10px">${icon('info')}<div>${list.length} cópia(s) reservada(s) para este deck${db.mode === 'demo' ? ' <strong>somente neste navegador</strong>' : ''}. Separe-as fisicamente seguindo a lista.</div></div>
          <div class="table-wrap"><table class="table"><thead><tr><th style="width:34px">✓</th><th>Carta</th><th>Onde pegar</th></tr></thead><tbody>
          ${sorted.map((c) => html`<tr><td><input type="checkbox" class="checkbox" data-got aria-label="Separada"></td><td><strong>${card(c.cardKey)?.name}</strong> <span class="text-xs muted">${c.lang.toUpperCase()} · ${finishLabel(c.finish)}</span></td><td class="text-sm">${copyWhere(c, s)}</td></tr>`)}
          </tbody></table></div>`);
        render(foot, html`<button class="btn btn--ghost" type="button" data-x>Fechar (manter reservas)</button><button class="btn btn--primary" type="button" data-n>Separei as cartas ${icon('chevronRight')}</button>`);
      } else {
        render(flow, html`${steps()}<h3 style="margin-bottom:10px">4 · Confirmar montagem</h3>
          <p class="muted">As ${chosen.size} cópia(s) serão movidas para o local “Deck box · ${deck.name}”. Cópias que estavam em fichários liberam seus bolsos. Tudo entra no histórico do inventário e pode ser revertido.</p>
          <label class="field mt-3"><span class="field__label">Guardar a deck box dentro de</span><select class="select" data-parent><option value="">— Nível principal —</option>${locationOptions(s.locations.filter((l) => !l.system), null)}</select></label>`);
        render(foot, html`<button class="btn btn--ghost" type="button" data-b>${icon('chevronLeft')} Voltar</button><button class="btn btn--crimson" type="button" data-n>${icon('swords')} Confirmar montagem física</button>`);
      }
      hydrateImages(flow);
      foot.querySelector('[data-x]')?.addEventListener('click', () => m.close());
      foot.querySelector('[data-b]')?.addEventListener('click', () => { step--; paintStep(); });
      foot.querySelector('[data-n]')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          if (step === 2) {
            await db.reserveCopies(deck.id, [...chosen]);
            deck = await db.getDeck(deck.id); s = await loadAll(['copies', 'binders', 'locations', 'decks', 'wishlist']); changed('decks');
          }
          if (step === 4) {
            await db.assembleDeck(deck.id, { parentLocationId: flow.querySelector('[data-parent]').value || null });
            deck = await db.getDeck(deck.id); s = await loadAll(['copies', 'binders', 'locations', 'decks', 'wishlist']); changed('inventory');
            toast({ type: 'success', title: 'Deck montado', text: 'As cópias agora estão alocadas somente neste deck.' });
            m.close(); paint(); return;
          }
          step++; paintStep();
        } catch (err) { toastError(err); e.target.disabled = false; }
      });
    };
    paintStep();
    m.el.addEventListener('click', () => {}, { once: true });
    const origClose = m.close; m.close = (r) => { origClose(r); paint(); };
  };

  const disassembleFlow = async () => {
    const res = await new Promise((resolve) => {
      let r = null;
      const mm = openModal({
        title: 'Desmontar deck físico',
        body: html`<div class="stack"><p class="muted">Para onde as cartas voltam? As reservas serão liberadas.</p><select class="select" data-d>${locationOptions(s.locations, data().inboxId)}</select></div>`,
        footer: html`<button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok>Desmontar</button>`,
        onClose: () => resolve(r),
      });
      mm.foot.querySelector('[data-ok]').addEventListener('click', () => { r = mm.body.querySelector('[data-d]').value; mm.close(); });
    });
    if (!res) return;
    try { await db.disassembleDeck(deck.id, res); deck = await db.getDeck(deck.id); s = await loadAll(['copies', 'binders', 'locations', 'decks', 'wishlist']); changed('inventory'); paint(); toast({ type: 'success', text: 'Deck desmontado; cartas devolvidas.' }); } catch (e) { toastError(e); }
  };

  paint();
  return () => { autosave.cancel(); if (save.state === 'dirty') persist(); };
}
