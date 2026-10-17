// Seletor de cartas reutilizável: catálogo TCGdex, coleção, amostras offline e carta personalizada.
import { html, render, debounce, uid, normalize } from '../core/html.js';
import { icon } from '../core/icons.js';
import { openModal } from './modal.js';
import { cardTile, cardArt, hydrateImages, finishLabel } from './card.js';
import { toast, toastError } from './toast.js';
import { prefs } from '../core/prefs.js';
import * as tcg from '../api/tcgdex.js';
import { data, rememberCards, card as cachedCard, allCachedCards } from '../api/index.js';
import { SEED_CARDS } from '../features/seed.js';
import { cardKeyOf } from '../features/domain.js';
import { validateImageFile } from '../features/image-tools.js';
import { copyWhere } from '../stores/state.js';

/** Converte um CardBrief/card em snapshot salvo, buscando a carta completa quando possível. */
export async function resolveSnapshot(brief, lang) {
  const key = cardKeyOf(brief.id, lang);
  const cached = cachedCard(key);
  if (cached && !cached.partial) return cached;
  try {
    const { card: full, lang: gotLang, fallbackFrom } = await tcg.getCard(brief.id, lang);
    const snap = tcg.toSnapshot(full, gotLang, { fallbackFrom });
    const [saved] = await rememberCards([{ ...snap, key: cardKeyOf(full.id, gotLang) }]);
    return saved;
  } catch (e) {
    // Sem a carta completa: guarda o resumo, sinalizado como parcial.
    const snap = tcg.toSnapshot(brief, lang);
    const [saved] = await rememberCards([{ ...snap, key, partial: true }]);
    toast({ type: 'warning', title: 'Dados parciais', text: `Não foi possível obter todos os dados de “${brief.name}” (${e.message}). Salvamos o resumo disponível.` });
    return saved;
  }
}

/**
 * pickCards({ title, multi, sources, confirmLabel }) → Promise<snapshot[] | null>
 */
export function pickCards({ title = 'Escolher carta', multi = false, sources = ['catalog', 'collection', 'samples', 'custom'], confirmLabel = 'Usar carta' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const state = { tab: sources[0], q: '', lang: prefs.get('catalogLang') || 'en', results: [], loading: false, error: null, selected: new Map(), page: 1, more: false,
      f: { kind: '', rarity: '', type: '', cat: '' }, lists: null, extra: [] };
    const hasFilter = () => Object.values(state.f).some(Boolean);
    const tabs = { catalog: ['grid', 'Catálogo TCGdex'], collection: ['layers', 'Minha coleção'], samples: ['sparkles', 'Exemplos offline'], custom: ['pencil', 'Personalizada'] };
    const m = openModal({
      title, size: 'xl',
      body: html`<div class="tabs" role="tablist">${sources.map((s) => html`<button class="tab" role="tab" type="button" data-tab="${s}" aria-selected="${s === state.tab}">${icon(tabs[s][0])}${tabs[s][1]}</button>`)}</div><div data-pane></div>`,
      footer: html`<span class="text-sm muted" data-count></span><span class="spacer"></span><button class="btn btn--ghost" type="button" data-close>Cancelar</button><button class="btn btn--primary" type="button" data-ok disabled>${confirmLabel}</button>`,
      onClose: () => resolve(result),
    });
    const pane = m.body.querySelector('[data-pane]');
    const okBtn = m.foot.querySelector('[data-ok]');
    const countEl = m.foot.querySelector('[data-count]');

    const updateFooter = () => {
      okBtn.disabled = state.selected.size === 0;
      countEl.textContent = state.selected.size ? `${state.selected.size} selecionada(s)${multi && state.selected.size > 1 ? ' · entram na ordem numerada' : ''}` : multi ? 'Selecione uma ou mais cartas, na ordem em que devem entrar' : 'Selecione uma carta';
    };

    const toggle = (key, item, lang) => {
      if (state.selected.has(key)) state.selected.delete(key);
      else {
        if (!multi) state.selected.clear();
        state.selected.set(key, { item, lang });
      }
      paintSelection();
      updateFooter();
    };

    // Marca as cartas selecionadas; na seleção múltipla, mostra a ordem (1, 2, 3…) em que entrarão.
    const paintSelection = () => {
      const order = [...state.selected.keys()];
      pane.querySelectorAll('.card-tile').forEach((t) => {
        const pos = order.indexOf(t.dataset.key);
        const on = pos !== -1;
        t.classList.toggle('is-selected', on);
        const btn = t.querySelector('[data-select]');
        if (!btn) return;
        btn.setAttribute('aria-pressed', String(on));
        if (multi) { if (on) btn.dataset.order = String(pos + 1); else delete btn.dataset.order; }
      });
    };

    const gridOf = (items, keyOf, langOf) => html`<div class="card-grid card-grid--sm">${items.map((it, i) => {
      const key = keyOf(it);
      return cardTile(it, { selectable: true, selected: state.selected.has(key), attrs: `data-key="${key}" data-i="${i}"`, index: i, hover: false, meta: [it.set?.name, it.localId ? `#${it.localId}` : null, langOf(it)?.toUpperCase()].filter(Boolean).join(' · ') });
    })}</div>`;

    const bindGrid = (items, keyOf, langOf, root = pane) => {
      hydrateImages(pane);
      paintSelection();
      root.querySelectorAll('.card-tile').forEach((t) => {
        const it = items[Number(t.dataset.i)];
        t.addEventListener('click', (e) => { e.preventDefault(); toggle(keyOf(it), it, langOf(it)); });
        t.addEventListener('dblclick', () => { if (!multi) { state.selected.clear(); toggle(keyOf(it), it, langOf(it)); okBtn.click(); } });
      });
    };

    // ---------- Catálogo
    const renderCatalog = () => {
      render(pane, html`<div class="row" style="margin-bottom:14px">
          <div class="input-group grow">${icon('search')}<input class="input" type="search" placeholder="Nome da carta (ex.: Pikachu, Glurak, リザードン)" value="${state.q}" data-q aria-label="Buscar no catálogo"></div>
          <select class="select" style="width:auto" data-lang aria-label="Idioma do catálogo"><option value="${state.lang}">${tcg.langLabel(state.lang)}</option></select>
        </div>
        <div class="picker-filters" data-pfilters></div>
        <div data-results></div>`);
      const q = pane.querySelector('[data-q]');
      const langSel = pane.querySelector('[data-lang]');
      paintFilters();
      loadLists();
      tcg.discoverLanguages().then((langs) => {
        render(langSel, html`${langs.map((l) => html`<option value="${l.code}" ${l.code === state.lang ? 'selected' : ''}>${l.label}</option>`)}`);
      }).catch(() => { /* mantém o idioma atual */ });
      langSel.addEventListener('change', () => { state.lang = langSel.value; prefs.set('catalogLang', state.lang); state.lists = null; loadLists(); search(true); });
      const run = debounce(() => search(true), 350);
      q.addEventListener('input', () => { state.q = q.value.trim(); run(); });
      q.focus();
      paintResults();
    };
    // ---------- Filtros do catálogo: mecânica (Mega, ex, GX, V…), raridade, tipo e categoria
    const loadLists = async () => {
      const lang = state.lang;
      const [kinds, rarities, types] = await Promise.all([
        tcg.listKinds(lang).catch(() => []), tcg.listRarities(lang).catch(() => []), tcg.listTypes(lang).catch(() => []),
      ]);
      if (lang !== state.lang) return;
      state.lists = { kinds: kinds || [], rarities: (rarities || []).filter((r) => r && r !== 'None'), types: (types || []).filter(Boolean) };
      paintFilters();
    };
    const paintFilters = () => {
      const box = pane.querySelector('[data-pfilters]');
      if (!box) return;
      const L = state.lists;
      const opt = (v, label, cur) => html`<option value="${v}" ${cur === v ? 'selected' : ''}>${label}</option>`;
      render(box, html`<div class="chips picker-filters__kinds" role="group" aria-label="Tipo de carta">
          <button type="button" class="chip" data-kind="" aria-pressed="${!state.f.kind}">Todas</button>
          ${(L?.kinds || []).map((k) => html`<button type="button" class="chip" data-kind="${k.id}" aria-pressed="${state.f.kind === k.id}">${k.label}</button>`)}
        </div>
        <div class="picker-filters__selects">
          <select class="select select--sm" data-pf="rarity" aria-label="Raridade" ${L ? '' : 'disabled'}>${opt('', 'Raridade: todas', state.f.rarity)}${(L?.rarities || []).map((r) => opt(r, tcg.rarityLabel(r), state.f.rarity))}</select>
          <select class="select select--sm" data-pf="type" aria-label="Tipo de energia" ${L ? '' : 'disabled'}>${opt('', 'Tipo: todos', state.f.type)}${(L?.types || []).map((t) => opt(t, tcg.typeLabel(t), state.f.type))}</select>
          <select class="select select--sm" data-pf="cat" aria-label="Categoria">${opt('', 'Categoria: todas', state.f.cat)}${opt('Pokemon', 'Pokémon', state.f.cat)}${opt('Trainer', 'Treinador', state.f.cat)}${opt('Energy', 'Energia', state.f.cat)}</select>
          ${hasFilter() ? html`<button type="button" class="btn btn--sm btn--ghost" data-pf-clear>${icon('x')} Limpar filtros</button>` : ''}
        </div>`);
      box.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { state.f.kind = b.dataset.kind; paintFilters(); search(true); }));
      box.querySelectorAll('[data-pf]').forEach((sel) => sel.addEventListener('change', () => { state.f[sel.dataset.pf] = sel.value; paintFilters(); search(true); }));
      box.querySelector('[data-pf-clear]')?.addEventListener('click', () => { state.f = { kind: '', rarity: '', type: '', cat: '' }; paintFilters(); search(true); });
    };
    const search = async (reset) => {
      if (reset) { state.page = 1; state.results = []; }
      if (state.q.length < 2 && !hasFilter()) { state.loading = false; state.error = null; paintResults(); return; }
      state.loading = true; state.error = null; paintResults();
      const myQ = state.q;
      try {
        const f = { ...state.f };
        const list = await tcg.searchCards(state.lang, {
          name: state.q.length >= 2 ? state.q : '', page: state.page, perPage: 36,
          kind: f.kind || undefined, rarity: f.rarity || undefined, types: f.type || undefined, category: f.cat || undefined,
          // só filtros, sem nome: mais recentes primeiro
          ...(state.q.length < 2 ? { sortField: 'releaseDate', sortOrder: 'DESC' } : {}),
        });
        if (myQ !== state.q || JSON.stringify(f) !== JSON.stringify(state.f)) return;
        state.results = state.results.concat(list || []);
        // cartas que só existem na base em inglês (sem versão no idioma escolhido)
        if (state.page === 1) {
          state.extra = state.q.length >= 2 ? await tcg.englishOnly(state.lang, { name: state.q, kind: f.kind || undefined, rarity: f.rarity || undefined, types: f.type || undefined, category: f.cat || undefined }).catch(() => []) : [];
          if (myQ !== state.q) return;
        }
        state.more = (list || []).length === 36;
      } catch (e) { state.error = e; }
      state.loading = false; paintResults();
    };
    const paintResults = () => {
      const box = pane.querySelector('[data-results]');
      if (!box) return;
      if (state.q.length < 2 && !hasFilter()) { render(box, html`<div class="state"><div class="state__icon">${icon('search')}</div><h3>Pesquise no catálogo</h3><p>Digite ao menos 2 letras ou escolha um filtro (ex.: GX, Ilustração Rara). A busca usa a base TCGdex embutida, no idioma escolhido.</p></div>`); return; }
      if (state.error) {
        render(box, html`<div class="state state--error"><div class="state__icon">${icon('offline')}</div><h3>Catálogo indisponível</h3><p>${state.error.message}</p>${sources.includes('samples') ? html`<button class="btn btn--primary" type="button" data-go-samples>Usar exemplos offline</button>` : ''}</div>`);
        box.querySelector('[data-go-samples]')?.addEventListener('click', () => setTab('samples'));
        return;
      }
      if (!state.results.length && state.loading) { render(box, html`<div class="card-grid card-grid--sm">${Array.from({ length: 12 }, () => html`<div><div class="skeleton" style="aspect-ratio:63/88"></div></div>`)}</div>`); return; }
      const extra = state.extra || [];
      if (!state.results.length && !extra.length) { render(box, html`<div class="state"><div class="state__icon">${icon('search')}</div><h3>Nenhuma carta encontrada</h3><p>Tente outro nome ou outro idioma.</p></div>`); return; }
      render(box, html`<div data-main>${state.results.length ? gridOf(state.results, (b) => cardKeyOf(b.id, state.lang), () => state.lang) : ''}</div>
        ${state.more ? html`<div class="pager"><button class="btn" type="button" data-more ${state.loading ? 'disabled' : ''}>${state.loading ? 'Carregando…' : 'Carregar mais'}</button></div>` : ''}
        ${extra.length ? html`<section class="lang-extra" data-extra><h3 class="lang-extra__title">${icon('globe')} Só na base em inglês <span class="badge">${extra.length}</span></h3>
          <p class="text-sm muted">A TCGdex não tem versão em ${tcg.langLabel(state.lang)} destas cartas (comum em promos e expansões antigas). Ao adicionar, escolha o idioma da sua carta física.</p>
          ${gridOf(extra, (b) => cardKeyOf(b.id, 'en'), () => 'en')}</section>` : ''}`);
      bindGrid(state.results, (b) => cardKeyOf(b.id, state.lang), () => state.lang, box.querySelector('[data-main]'));
      if (extra.length) bindGrid(extra, (b) => cardKeyOf(b.id, 'en'), () => 'en', box.querySelector('[data-extra]'));
      box.querySelector('[data-more]')?.addEventListener('click', () => { state.page++; search(false); });
    };

    // ---------- Coleção
    const renderCollection = async () => {
      render(pane, html`<div class="center-loader"><span class="loader"><span class="loader__eclipse"></span>Carregando coleção…</span></div>`);
      const copies = (await data().listCopies()).filter((c) => c.status !== 'removed');
      const keys = [...new Set(copies.map((c) => c.cardKey))];
      const cards = keys.map((k) => cachedCard(k)).filter(Boolean);
      const paint = (filter = '') => {
        const f = normalize(filter);
        const list = cards.filter((c) => !f || normalize(c.name).includes(f));
        render(pane.querySelector('[data-list]'), list.length ? gridOf(list, (c) => c.key, (c) => c.lang) : html`<div class="state"><div class="state__icon">${icon('layers')}</div><h3>Nada por aqui</h3><p>Sua coleção não tem cartas com esse nome.</p></div>`);
        bindGrid(list, (c) => c.key, (c) => c.lang);
      };
      render(pane, html`<div class="input-group" style="margin-bottom:14px">${icon('search')}<input class="input" type="search" placeholder="Filtrar minha coleção" data-f aria-label="Filtrar coleção"></div><div data-list></div>`);
      pane.querySelector('[data-f]').addEventListener('input', (e) => paint(e.target.value));
      paint();
    };

    // ---------- Amostras offline
    const renderSamples = () => {
      const list = SEED_CARDS;
      render(pane, html`<div class="alert alert--warning" style="margin-bottom:14px">${icon('info')}<div><strong>Exemplos offline.</strong> Pequena amostra embutida para testar sem internet. Os metadados podem divergir do catálogo oficial.</div></div>${gridOf(list, (c) => c.key, (c) => c.lang)}`);
      bindGrid(list, (c) => c.key, (c) => c.lang);
    };

    // ---------- Personalizada
    const renderCustom = () => {
      render(pane, html`<form class="form-grid" data-custom>
        <div class="alert span-2">${icon('info')}<div>Use para cartas que não existem na TCGdex (promos regionais, erros de impressão, cartas de evento). Elas ficam marcadas como <strong>Personalizada</strong> e nunca se misturam aos registros oficiais.</div></div>
        <label class="field span-2"><span class="field__label">Nome *</span><input class="input" name="name" required maxlength="80"></label>
        <label class="field"><span class="field__label">Expansão / origem</span><input class="input" name="setLabel" maxlength="60" placeholder="Ex.: Evento local 2024"></label>
        <label class="field"><span class="field__label">Número</span><input class="input" name="localId" maxlength="20"></label>
        <label class="field"><span class="field__label">Idioma</span><input class="input" name="lang" maxlength="10" value="pt-br"></label>
        <label class="field"><span class="field__label">Categoria</span><select class="select" name="category"><option value="">Não informada</option><option value="Pokemon">Pokémon</option><option value="Trainer">Treinador</option><option value="Energy">Energia</option></select></label>
        ${data().capabilities.assets ? html`<label class="field span-2"><span class="field__label">Imagem (opcional)</span><input class="input" type="file" name="image" accept="image/png,image/jpeg,image/webp" style="padding-top:8px"><span class="field__hint">PNG, JPEG ou WebP, até 15 MB. O arquivo original é preservado.</span></label>` : ''}
        <div class="span-2"><button class="btn btn--primary" type="submit">${icon('plus')} Criar carta personalizada</button></div>
      </form>`);
      pane.querySelector('[data-custom]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const name = String(fd.get('name') || '').trim();
        if (!name) return;
        let assetId = null;
        const file = fd.get('image');
        try {
          if (file && file.size) {
            const v = await validateImageFile(file);
            const meta = await data().addAsset({ blob: file, name: file.name, width: v.width, height: v.height, mime: v.mime });
            assetId = meta.id;
          }
          const id = uid('custom_');
          const snap = { key: `custom:${id}`, id, name, lang: String(fd.get('lang') || 'pt-br'), localId: String(fd.get('localId') || ''), setLabel: String(fd.get('setLabel') || ''), set: null, category: fd.get('category') || null, source: 'custom', assetId, partial: false, types: [], dexId: [] };
          const [saved] = await rememberCards([snap]);
          result = [saved];
          m.close();
        } catch (err) { toastError(err); }
      });
    };

    const setTab = (t) => {
      state.tab = t;
      m.body.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
      okBtn.hidden = t === 'custom';
      ({ catalog: renderCatalog, collection: renderCollection, samples: renderSamples, custom: renderCustom })[t]();
    };
    m.body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

    okBtn.addEventListener('click', async () => {
      okBtn.disabled = true; okBtn.textContent = 'Preparando…';
      try {
        const out = [];
        for (const [key, { item, lang }] of state.selected) {
          if (item.key && (item.source === 'demo-seed' || item.source === 'custom' || cachedCard(item.key))) {
            if (item.source === 'demo-seed' && !cachedCard(item.key)) await rememberCards([item]);
            out.push(cachedCard(item.key) || item);
          } else {
            out.push(await resolveSnapshot(item, lang || key.split(':')[0]));
          }
        }
        result = out;
        m.close();
      } catch (e) {
        toastError(e);
        okBtn.disabled = false; okBtn.textContent = confirmLabel;
      }
    });

    setTab(state.tab);
    updateFooter();
  });
}

/**
 * Escolhe UMA cópia física da coleção (para bolsos de fichário físico).
 * Mostra onde cada cópia está; cópias montadas em deck não podem ser escolhidas.
 */
export function pickCopy({ title = 'Escolher carta física', binderId = null } = {}) {
  return new Promise(async (resolve) => {
    let result = null;
    const [copies, binders, locations, decks] = await Promise.all([data().listCopies(), data().listBinders(), data().listLocations(), data().listDecks()]);
    const active = copies.filter((c) => c.status !== 'removed');
    const ctx = { binders, locations, decks };
    const m = openModal({
      title, size: 'lg',
      body: html`<div class="input-group" style="margin-bottom:12px">${icon('search')}<input class="input" type="search" placeholder="Filtrar por nome" data-f aria-label="Filtrar cópias"></div>
        <label class="checkbox text-sm" style="margin-bottom:12px"><input type="checkbox" data-free checked> Mostrar primeiro as que não estão em fichários</label>
        <div data-list></div>`,
      onClose: () => resolve(result),
    });
    const paint = () => {
      const f = normalize(m.body.querySelector('[data-f]').value);
      const freeFirst = m.body.querySelector('[data-free]').checked;
      let list = active.filter((c) => { const cd = cachedCard(c.cardKey); return !f || normalize(cd?.name).includes(f); });
      list.sort((a, b) => (freeFirst ? (a.slot ? 1 : 0) - (b.slot ? 1 : 0) : 0) || String(cachedCard(a.cardKey)?.name).localeCompare(String(cachedCard(b.cardKey)?.name)));
      list = list.slice(0, 200);
      const box = m.body.querySelector('[data-list]');
      if (!list.length) { render(box, html`<div class="state"><div class="state__icon">${icon('layers')}</div><h3>Nenhuma cópia disponível</h3><p>Cadastre cartas na sua coleção para colocá-las em fichários físicos.</p><a class="btn btn--primary" href="#/colecao?add=1">Adicionar cartas</a></div>`); return; }
      render(box, html`<div class="card-list">${list.map((c) => {
        const cd = cachedCard(c.cardKey);
        const blocked = c.deckAssembled;
        const inThis = c.slot?.binderId === binderId;
        return html`<div class="card-row" style="grid-template-columns:48px minmax(0,1fr) auto">
          <div style="width:48px">${cardArt(cd)}</div>
          <div class="card-row__main"><div class="card-row__name">${cd?.name || c.cardKey}</div>
            <div class="card-row__meta"><span>${cd?.set?.name || cd?.setLabel || ''} ${cd?.localId ? `#${cd.localId}` : ''}</span><span>${c.lang.toUpperCase()} · ${finishLabel(c.finish)}</span><span>${icon('pin')} ${copyWhere(c, ctx)}</span>${c.reservedFor ? html`<span class="badge badge--warning">reservada</span>` : ''}</div></div>
          <button class="btn btn--sm ${blocked ? '' : 'btn--primary'}" type="button" data-pick="${c.id}" ${blocked ? 'disabled' : ''} title="${blocked ? 'Montada em deck físico' : ''}">${inThis ? 'Mover para cá' : c.slot ? 'Trazer de outro fichário' : 'Escolher'}</button>
        </div>`;
      })}</div>`);
      hydrateImages(box);
      box.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { result = active.find((c) => c.id === b.dataset.pick); m.close(); }));
    };
    m.body.querySelector('[data-f]').addEventListener('input', paint);
    m.body.querySelector('[data-free]').addEventListener('change', paint);
    paint();
  });
}

export { allCachedCards };
