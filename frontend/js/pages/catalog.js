import { html, render, debounce, normalize } from '../core/html.js';
import { icon } from '../core/icons.js';
import * as tcg from '../api/tcgdex.js';
import { data, card as cached } from '../api/index.js';
import { prefs } from '../core/prefs.js';
import { cardTile, hydrateImages } from '../components/card.js';
import { navigate, setQuery } from '../router.js';
import { resolveSnapshot } from '../components/card-picker.js';
import { addToCollectionFlow, addToWishlist } from '../features/actions.js';
import { cardKeyOf, GENERATIONS } from '../features/domain.js';
import { SEED_CARDS } from '../features/seed.js';
import { toastError } from '../components/toast.js';

const PER_PAGE = 30;

export default async function catalog(ctx, main) {
  const q0 = ctx.query;
  const st = {
    lang: q0.lang || prefs.get('catalogLang') || 'en',
    q: q0.q || '', num: q0.num || '', rarity: q0.rarity || '', kind: q0.kind || '', type: q0.type || '', cat: q0.cat || '', art: q0.art || '',
    set: q0.set || '', year: q0.year || '', legal: q0.legal || '', gen: q0.gen || '', sort: q0.sort || '', owned: q0.owned === '1', wish: q0.wish === '1', offline: q0.offline === '1',
    page: 1, results: [], more: false, loading: false, error: null, selecting: false, selected: new Map(),
    setInfo: null, series: null, openSerie: q0.serie || null, serieSets: {}, filtersOpen: !!(q0.num || q0.rarity || q0.kind || q0.type || q0.cat || q0.art || q0.year || q0.legal),
  };
  let alive = true;
  const db = data();
  const [copies, wishlist] = await Promise.all([db.listCopies(), db.listWishlist()]);
  const ownedCount = new Map();
  copies.filter((c) => c.status !== 'removed').forEach((c) => ownedCount.set(c.cardId, (ownedCount.get(c.cardId) || 0) + 1));
  const wishIds = new Set(wishlist.map((w) => w.cardId));

  render(main, html`<div class="page page--wide">
    <div class="page-head"><div><div class="page-head__eyebrow">Catálogo internacional</div><h1>Catálogo</h1><p>Cartas oficiais via <a href="https://tcgdex.dev/" target="_blank" rel="noopener">TCGdex</a>. Pesquise por nome, filtre, explore séries e expansões.</p><p class="text-xs muted" data-source></p></div>
      <div class="btn-group"><button class="btn" type="button" data-selectmode>${icon('select')} Selecionar várias</button></div></div>
    <div class="catalog-head">
      <div class="catalog-bar">
        <div class="catalog-search grow">${icon('search')}<input class="input" type="search" placeholder="Pesquisar cartas — ex.: Darkrai, Pikachu, Charizard" value="${st.q}" data-q aria-label="Pesquisar cartas" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="suggest"><div class="suggest" id="suggest" role="listbox" hidden></div></div>
        <select class="select catalog-bar__lang" data-lang aria-label="Idioma do catálogo"><option value="${st.lang}">${tcg.langLabel(st.lang)}</option></select>
        <button class="btn btn--lg" type="button" data-filters aria-expanded="${st.filtersOpen}">${icon('filter')} Filtros</button>
      </div>
      <div class="filters" data-filterbox ${st.filtersOpen ? '' : 'hidden'}></div>
      <div class="chips" data-chips></div>
    </div>
    <div data-selbar></div>
    <div data-body></div>
  </div>`);

  const $ = (s) => main.querySelector(s);
  const qInput = $('[data-q]'); const langSel = $('[data-lang]'); const body = $('[data-body]'); const sug = $('#suggest');

  const paintSource = () => {
    const el = $('[data-source]');
    if (!el) return;
    if (!tcg.isLocal(st.lang)) { el.textContent = `${tcg.langLabel(st.lang)}: consulta ao vivo na API da TCGdex (requer internet).`; return; }
    tcg.catalogMeta(st.lang).then((m) => {
      if (alive) el.textContent = `${tcg.langLabel(st.lang)}: base local com ${m.cards.toLocaleString('pt-BR')} cartas físicas em ${m.sets} expansões (dados da TCGdex de ${new Date(m.generatedAt).toLocaleDateString('pt-BR')}). Busca instantânea, funciona sem internet. Imagens da TCGdex${m.altImages ? `; quando faltam, o app usa a versão em inglês ou a base PokemonTCG (${m.altImages.toLocaleString('pt-BR')} cartas com imagem alternativa)` : ''}.`;
    }).catch(() => { el.textContent = ''; });
  };
  paintSource();

  // ---------- idiomas (descoberta dinâmica)
  tcg.discoverLanguages().then((langs) => {
    if (!alive) return;
    render(langSel, html`${langs.map((l) => html`<option value="${l.code}" ${l.code === st.lang ? 'selected' : ''}>${l.label}</option>`)}`);
  }).catch(() => { langSel.title = 'Não foi possível listar idiomas (TCGdex indisponível).'; });
  langSel.addEventListener('change', () => { st.lang = langSel.value; paintSource(); prefs.set('catalogLang', st.lang); st.set = ''; st.setInfo = null; st.series = null; st.serieSets = {}; rarities = null; types = null; years = null; kinds = null; st.kind = ''; st.year = ''; st.legal = ''; st.gen = ''; if (st.filtersOpen) loadFilterLists(); sync(); paintFilters(); load(true); });

  // ---------- filtros
  let rarities = null; let types = null; let years = null; let kinds = null;
  const paintFilters = async () => {
    const box = $('[data-filterbox]');
    const setMode = !!st.set && !tcg.isLocal(st.lang); // na base local, os filtros valem também dentro da expansão
    render(box, html`
      <label class="field"><span class="field__label">Número</span><input class="input" data-f="num" value="${st.num}" placeholder="ex.: 25"></label>
      <label class="field"><span class="field__label">Categoria</span><select class="select" data-f="cat" ${setMode ? 'disabled' : ''}><option value="">Todas</option>${['Pokemon', 'Trainer', 'Energy'].map((c) => html`<option value="${c}" ${st.cat === c ? 'selected' : ''}>${{ Pokemon: 'Pokémon', Trainer: 'Treinador', Energy: 'Energia' }[c]}</option>`)}</select></label>
      <label class="field"><span class="field__label">Raridade</span><select class="select" data-f="rarity" ${setMode || !rarities ? 'disabled' : ''}><option value="">${rarities ? 'Todas' : 'Carregando…'}</option>${(rarities || []).map((r) => html`<option value="${r}" ${st.rarity === r ? 'selected' : ''}>${tcg.rarityLabel(r)}</option>`)}</select></label>
      <label class="field"><span class="field__label">Tipo de carta</span><select class="select" data-f="kind" ${setMode || !kinds ? 'disabled' : ''}><option value="">${kinds ? 'Todas (GX, ex, V…)' : tcg.isLocal(st.lang) ? 'Carregando…' : 'Indisponível'}</option>${(kinds || []).map((k) => html`<option value="${k.id}" ${st.kind === k.id ? 'selected' : ''}>${k.label}</option>`)}</select></label>
      <label class="field"><span class="field__label">Tipo</span><select class="select" data-f="type" ${setMode || !types ? 'disabled' : ''}><option value="">${types ? 'Todos' : 'Carregando…'}</option>${(types || []).map((r) => html`<option value="${r}" ${st.type === r ? 'selected' : ''}>${tcg.typeLabel(r)}</option>`)}</select></label>
      <label class="field"><span class="field__label">Artista</span><input class="input" data-f="art" value="${st.art}" placeholder="ex.: Arita" ${setMode ? 'disabled' : ''}></label>
      <label class="field"><span class="field__label">Ordenar</span><select class="select" data-f="sort"><option value="">${tcg.isLocal(st.lang) ? 'Relevância' : 'Padrão da API'}</option><option value="name" ${st.sort === 'name' ? 'selected' : ''}>Nome (A→Z)</option><option value="-name" ${st.sort === '-name' ? 'selected' : ''}>Nome (Z→A)</option><option value="localId" ${st.sort === 'localId' ? 'selected' : ''}>Número</option>${tcg.isLocal(st.lang) ? html`<option value="-releaseDate" ${st.sort === '-releaseDate' ? 'selected' : ''}>Lançamento (recentes)</option><option value="releaseDate" ${st.sort === 'releaseDate' ? 'selected' : ''}>Lançamento (antigas)</option>` : ''}</select></label>
      <label class="field"><span class="field__label">Ano de lançamento</span>${years ? html`<select class="select" data-f="year"><option value="">Todos</option>${years.map((y) => html`<option ${st.year === y ? 'selected' : ''}>${y}</option>`)}</select>` : html`<select class="select" disabled title="Disponível no inglês (base local)"><option>${tcg.isLocal(st.lang) ? 'Carregando…' : 'Só no inglês'}</option></select>`}</label>
      <label class="field"><span class="field__label">Legalidade (formato)</span><select class="select" data-f="legal"><option value="">Qualquer</option><option value="standard" ${st.legal === 'standard' ? 'selected' : ''}>Standard</option><option value="expanded" ${st.legal === 'expanded' ? 'selected' : ''}>Expanded</option></select></label>
      <div class="field"><span class="field__label">Minha coleção</span><div class="chips"><button class="chip" type="button" data-toggle="owned" aria-pressed="${st.owned}">${icon('layers')} Possuídas</button><button class="chip" type="button" data-toggle="wish" aria-pressed="${st.wish}">${icon('heart')} Wishlist</button></div></div>
      ${setMode ? html`<p class="text-xs muted" style="grid-column:1/-1">Navegando por expansão: raridade, tipo, categoria e artista não se aplicam aos resumos de carta desta lista (a TCGdex só retorna id, número, nome e imagem). Use a busca geral para esses filtros.</p>` : ''}
      <p class="text-xs muted" style="grid-column:1/-1">“Possuídas” e “Wishlist” filtram os resultados já carregados com base nos seus dados.</p>`);
    box.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', debounce(() => {
      st[el.dataset.f] = el.value.trim(); sync(); load(true);
    }, el.tagName === 'INPUT' ? 450 : 0)));
    box.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => { st[b.dataset.toggle] = !st[b.dataset.toggle]; b.setAttribute('aria-pressed', String(st[b.dataset.toggle])); sync(); paintResults(); }));
  };
  const loadFilterLists = () => {
    if (rarities) return;
    tcg.listYears(st.lang).then((y) => { years = y; paintFilters(); }).catch(() => {});
    tcg.listKinds(st.lang).then((k) => { kinds = k || []; paintFilters(); }).catch(() => { kinds = []; });
    tcg.listRarities(st.lang).then((r) => { rarities = (r || []).filter(Boolean); paintFilters(); }).catch(() => { rarities = []; paintFilters(); });
    tcg.listTypes(st.lang).then((r) => { types = (r || []).filter(Boolean); paintFilters(); }).catch(() => { types = []; paintFilters(); });
  };
  $('[data-filters]').addEventListener('click', (e) => {
    st.filtersOpen = !st.filtersOpen; $('[data-filterbox]').hidden = !st.filtersOpen; e.currentTarget.setAttribute('aria-expanded', String(st.filtersOpen));
    if (st.filtersOpen) loadFilterLists();
  });
  if (st.filtersOpen) loadFilterLists();

  const sync = () => {
    setQuery({ q: st.q, lang: st.lang, num: st.num, rarity: st.rarity, kind: st.kind, type: st.type, cat: st.cat, art: st.art, set: st.set, year: st.year, legal: st.legal, gen: st.gen, sort: st.sort, owned: st.owned ? '1' : '', wish: st.wish ? '1' : '', serie: st.openSerie || '', offline: st.offline ? '1' : '' });
    paintChips();
  };
  const paintChips = () => {
    const chips = [];
    if (st.set) chips.push(['set', `Expansão: ${st.setInfo?.name || st.set}`]);
    if (st.num) chips.push(['num', `Nº ${st.num}`]);
    if (st.kind) chips.push(['kind', tcg.kindLabel(st.kind)]);
    if (st.rarity) chips.push(['rarity', tcg.rarityLabel(st.rarity)]);
    if (st.type) chips.push(['type', tcg.typeLabel(st.type)]);
    if (st.cat) chips.push(['cat', { Pokemon: 'Pokémon', Trainer: 'Treinador', Energy: 'Energia' }[st.cat] || st.cat]);
    if (st.art) chips.push(['art', `Artista: ${st.art}`]);
    if (st.year) chips.push(['year', `Ano: ${st.year}`]);
    if (st.legal) chips.push(['legal', `Legal no ${st.legal === 'standard' ? 'Standard' : 'Expanded'}`]);
    if (st.gen) { const g = GENERATIONS.find((x) => String(x.gen) === st.gen); chips.push(['gen', `Geração ${st.gen}${g ? ` · ${g.label}` : ''}`]); }
    if (st.offline) chips.push(['offline', 'Exemplos offline']);
    render($('[data-chips]'), html`${chips.map(([k, l]) => html`<button class="chip" type="button" aria-pressed="true" data-clear="${k}">${l} ${icon('x')}</button>`)}`);
    $('[data-chips]').querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.clear; st[k] = k === 'offline' ? false : ''; if (k === 'set') st.setInfo = null; sync(); paintFilters(); load(true);
    }));
  };

  // ---------- autocomplete
  let sugIdx = -1;
  const suggest = debounce(async () => {
    if (st.q.length < 2 || st.offline) { sug.hidden = true; return; }
    try {
      const names = await tcg.suggestNames(st.lang, st.q);
      if (!alive || document.activeElement !== qInput) return;
      sugIdx = -1;
      render(sug, html`${names.map((n, i) => html`<button type="button" role="option" data-s="${n}" id="sg${i}">${icon('search')}${n}</button>`)}`);
      sug.hidden = !names.length; qInput.setAttribute('aria-expanded', String(!sug.hidden));
      sug.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); qInput.value = st.q = b.dataset.s; sug.hidden = true; sync(); load(true); }));
    } catch { sug.hidden = true; }
  }, 280);
  const runSearch = debounce(() => { sync(); load(true); }, 420);
  qInput.addEventListener('input', () => { st.q = qInput.value.trim(); suggest(); runSearch(); });
  qInput.addEventListener('keydown', (e) => {
    const opts = [...sug.querySelectorAll('[data-s]')];
    if (e.key === 'ArrowDown' && opts.length) { e.preventDefault(); sugIdx = (sugIdx + 1) % opts.length; }
    else if (e.key === 'ArrowUp' && opts.length) { e.preventDefault(); sugIdx = (sugIdx - 1 + opts.length) % opts.length; }
    else if (e.key === 'Enter') { if (sugIdx >= 0 && opts[sugIdx]) { qInput.value = st.q = opts[sugIdx].dataset.s; } sug.hidden = true; runSearch.cancel(); sync(); load(true); return; }
    else if (e.key === 'Escape') { sug.hidden = true; return; }
    else return;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === sugIdx)));
    qInput.setAttribute('aria-activedescendant', opts[sugIdx]?.id || '');
  });
  qInput.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));

  // ---------- seleção múltipla
  $('[data-selectmode]').addEventListener('click', (e) => {
    st.selecting = !st.selecting; st.selected.clear();
    e.currentTarget.setAttribute('aria-pressed', String(st.selecting));
    paintSelbar(); paintResults();
  });
  const paintSelbar = () => {
    const box = $('[data-selbar]');
    if (!st.selecting) { box.innerHTML = ''; return; }
    render(box, html`<div class="selection-bar"><strong>${st.selected.size} selecionada(s)</strong><span class="grow"></span>
      <button class="btn btn--sm btn--primary" type="button" data-batch-add ${st.selected.size ? '' : 'disabled'}>${icon('plus')} Adicionar à coleção</button>
      <button class="btn btn--sm" type="button" data-batch-wish ${st.selected.size ? '' : 'disabled'}>${icon('heart')} Wishlist</button>
      <button class="btn btn--sm btn--ghost" type="button" data-batch-cancel>Cancelar</button></div>`);
    box.querySelector('[data-batch-cancel]').addEventListener('click', () => $('[data-selectmode]').click());
    box.querySelector('[data-batch-add]')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const snaps = [];
        for (const [, it] of st.selected) snaps.push(it.key && it.source ? it : await resolveSnapshot(it, st.lang));
        const res = await addToCollectionFlow(snaps);
        if (res) { $('[data-selectmode]').click(); res.copies?.forEach((c) => ownedCount.set(c.cardId, (ownedCount.get(c.cardId) || 0) + 1)); paintResults(); }
      } catch (err) { toastError(err); }
      e.target.disabled = false;
    });
    box.querySelector('[data-batch-wish]')?.addEventListener('click', async () => {
      for (const [, it] of st.selected) { const s = it.key && it.source ? it : await resolveSnapshot(it, st.lang); await addToWishlist(s); wishIds.add(s.id); }
      $('[data-selectmode]').click();
    });
  };

  // ---------- carregamento
  const load = async (reset) => {
    if (reset) { st.page = 1; st.results = []; st.more = false; st.total = null; }
    st.error = null;
    if (st.offline) { st.results = SEED_CARDS.filter((c) => (!st.q || normalize(c.name).includes(normalize(st.q))) && (!st.num || c.localId === st.num)); st.more = false; paintResults(); return; }
    if (!st.q && !st.num && !st.rarity && !st.kind && !st.type && !st.cat && !st.art && !st.set && !st.year && !st.gen) { paintBrowse(); return; }
    st.loading = true; paintResults();
    const token = Symbol('req'); load.token = token;
    try {
      if (st.set && tcg.isLocal(st.lang)) {
        if (!st.setInfo || st.setInfo.id !== st.set) st.setInfo = await tcg.getSet(st.lang, st.set);
      }
      if (st.set && !tcg.isLocal(st.lang)) {
        if (!st.setInfo || st.setInfo.id !== st.set) st.setInfo = await tcg.getSet(st.lang, st.set);
        let cards = (st.setInfo.cards || []).map((c) => ({ ...c, set: { id: st.setInfo.id, name: st.setInfo.name } }));
        if (st.q) cards = cards.filter((c) => normalize(c.name).includes(normalize(st.q)));
        if (st.num) cards = cards.filter((c) => String(c.localId) === st.num);
        if (st.sort === 'name') cards.sort((a, b) => a.name.localeCompare(b.name));
        if (st.sort === '-name') cards.sort((a, b) => b.name.localeCompare(a.name));
        st.results = cards; st.more = false;
      } else {
        const [sortField, sortOrder] = st.sort ? (st.sort.startsWith('-') ? [st.sort.slice(1), 'DESC'] : [st.sort, 'ASC']) : [null, null];
        const gen = st.gen ? GENERATIONS.find((g) => String(g.gen) === st.gen) : null;
        const list = await tcg.searchCards(st.lang, { name: st.q, localId: st.num, rarity: st.rarity, kind: st.kind || undefined, types: st.type, category: st.cat, illustrator: st.art, set: st.set || undefined, year: st.year || undefined, legal: st.legal || undefined, dex: gen ? [gen.from, gen.to] : undefined, page: st.page, perPage: PER_PAGE, sortField: sortField || (st.set && tcg.isLocal(st.lang) && !st.q ? 'releaseDate' : null), sortOrder });
        if (load.token !== token || !alive) return;
        st.results = st.results.concat(list || []);
        st.total = list?.total ?? null;
        // cartas sem versão neste idioma na TCGdex, mas presentes na base em inglês
        if (st.page === 1) {
          st.extra = st.q && !st.set && !st.offline ? await tcg.englishOnly(st.lang, { name: st.q, localId: st.num || undefined, rarity: st.rarity || undefined, kind: st.kind || undefined, types: st.type || undefined, category: st.cat || undefined }).catch(() => []) : [];
          if (load.token !== token || !alive) return;
        }
        st.more = st.total != null ? st.results.length < st.total : (list || []).length === PER_PAGE;
      }
    } catch (e) { if (load.token === token) st.error = e; }
    st.loading = false;
    if (alive) { paintChips(); paintResults(); }
  };

  const visible = () => st.results.filter((c) => (!st.owned || ownedCount.has(c.id)) && (!st.wish || wishIds.has(c.id)));

  const paintResults = () => {
    if (st.error) {
      render(body, html`<div class="state state--error"><div class="state__icon">${icon(st.error.kind === 'network' ? 'offline' : 'alert')}</div>
        <h3>${st.error.kind === 'network' ? 'Sem conexão com a TCGdex' : 'Não foi possível carregar o catálogo'}</h3><p>${st.error.message}</p>
        <div class="btn-group"><button class="btn btn--primary" type="button" data-retry>${icon('refresh')} Tentar novamente</button><button class="btn" type="button" data-offline>${icon('sparkles')} Ver exemplos offline</button></div></div>`);
      body.querySelector('[data-retry]').addEventListener('click', () => load(true));
      body.querySelector('[data-offline]').addEventListener('click', () => { st.offline = true; sync(); load(true); });
      return;
    }
    const list = visible();
    if (st.loading && !st.results.length) {
      render(body, html`<div class="card-grid">${Array.from({ length: 12 }, () => html`<div class="stack" style="gap:8px"><div class="skeleton" style="aspect-ratio:63/88;border-radius:4.6%/3.3%"></div><div class="skeleton" style="height:12px;width:70%"></div></div>`)}</div>`);
      return;
    }
    const head = st.set && st.setInfo ? html`<div class="row" style="margin-bottom:16px;gap:14px">
        <button class="btn btn--sm btn--ghost" type="button" data-backsets>${icon('arrowLeft')} Expansões</button>
        ${tcg.setLogoSources(st.setInfo).length ? html`<img src="${tcg.setLogoSources(st.setInfo)[0]}" data-fallbacks="${tcg.setLogoSources(st.setInfo).slice(1).join('|')}" alt="" style="height:36px">` : ''}
        <div><strong>${st.setInfo.name}</strong><div class="text-xs muted">${st.setInfo.serie?.name || ''} · ${st.setInfo.releaseDate || ''} · ${st.setInfo.cardCount?.official ?? '?'} oficiais / ${st.setInfo.cardCount?.total ?? '?'} no total</div></div></div>` : '';
    const offlineNote = st.offline ? html`<div class="alert alert--warning" style="margin-bottom:16px">${icon('info')}<div><strong>Exemplos offline</strong> — amostra embutida no demo para testar sem internet. <button class="btn btn--sm btn--ghost" type="button" data-online>Voltar ao catálogo online</button></div></div>` : '';
    const extra = st.owned || st.wish ? [] : (st.extra || []);
    const extraHtml = extra.length ? html`<section class="lang-extra"><h3 class="lang-extra__title">${icon('globe')} Só na base em inglês <span class="badge">${extra.length}</span></h3>
      <p class="text-sm muted">A TCGdex não tem versão em ${tcg.langLabel(st.lang)} destas cartas (comum em promos e expansões antigas). Abra a carta para adicioná-la; ao adicionar, escolha o idioma da sua carta física.</p>
      <div class="card-grid">${extra.map((c, i) => cardTile(c, { qty: ownedCount.get(c.id) || 0, attrs: `data-extra-id="${c.id}"`, index: i, meta: [c.set?.name, c.localId ? `#${c.localId}` : null, 'EN'].filter(Boolean).join(' · ') }))}</div></section>` : '';
    if (!list.length && extra.length) {
      render(body, html`${offlineNote}${head}<p class="text-sm muted">Nenhuma carta com esse nome em ${tcg.langLabel(st.lang)}.</p>${extraHtml}`);
    } else if (!list.length) {
      render(body, html`${offlineNote}${head}<div class="state"><div class="state__icon">${icon('search')}</div><h3>Nenhuma carta encontrada</h3><p>${st.owned || st.wish ? 'Nenhum resultado carregado corresponde aos filtros da sua coleção.' : 'Revise o nome, os filtros ou troque o idioma — nem toda carta existe em todos os idiomas.'}</p></div>`);
    } else {
      render(body, html`${offlineNote}${head}<p class="text-sm muted" style="margin-bottom:12px">${st.total != null && !st.owned && !st.wish ? `${st.total.toLocaleString('pt-BR')} carta(s)${st.more ? ` · mostrando ${list.length}` : ''}` : `${list.length} carta(s)${st.more ? ' carregadas' : ''}`} · ${tcg.langLabel(st.offline ? 'en' : st.lang)}${tcg.isLocal(st.lang) && !st.offline ? ' · base local' : ''}</p>
        <div class="card-grid">${list.map((c, i) => cardTile(c.key ? c : { ...c, set: c.set || null }, {
    qty: ownedCount.get(c.id) || 0, wish: wishIds.has(c.id), selectable: st.selecting, selected: st.selected.has(c.id), attrs: `data-id="${c.id}"`, index: i % PER_PAGE,
    meta: [c.set?.name, c.localId ? `#${c.localId}` : null].filter(Boolean).join(' · ') || c.id,
  }))}</div>
        ${st.more ? html`<div class="pager"><button class="btn" type="button" data-more ${st.loading ? 'disabled' : ''}>${st.loading ? 'Carregando…' : 'Carregar mais'}</button></div>` : ''}
        ${st.more ? '' : extraHtml}`);
    }
    hydrateImages(body);
    body.querySelectorAll('[data-extra-id]').forEach((t) => t.addEventListener('click', (e) => {
      if (e.target.closest('[data-open]')) navigate(`/carta/${encodeURIComponent(t.dataset.extraId)}?lang=en`);
    }));
    body.querySelector('[data-online]')?.addEventListener('click', () => { st.offline = false; sync(); load(true); });
    body.querySelector('[data-backsets]')?.addEventListener('click', () => { st.set = ''; st.setInfo = null; sync(); paintFilters(); load(true); });
    body.querySelector('[data-more]')?.addEventListener('click', () => { st.page++; load(false); });
    // carregamento progressivo ao rolar
    const moreBtn = body.querySelector('[data-more]');
    if (moreBtn && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((ents) => { if (ents[0].isIntersecting && !st.loading) { io.disconnect(); st.page++; load(false); } }, { rootMargin: '400px' });
      io.observe(moreBtn);
    }
    body.querySelectorAll('.card-tile[data-id]').forEach((t) => {
      const c = st.results.find((x) => x.id === t.dataset.id);
      t.addEventListener('click', (e) => {
        if (st.selecting) {
          e.preventDefault();
          if (st.selected.has(c.id)) st.selected.delete(c.id); else st.selected.set(c.id, c);
          t.classList.toggle('is-selected', st.selected.has(c.id));
          paintSelbar();
          return;
        }
        if (e.target.closest('[data-open]')) navigate(`/carta/${encodeURIComponent(c.id)}?lang=${st.offline ? 'en' : st.lang}`);
      });
    });
  };

  // ---------- navegação por séries e expansões
  const paintBrowse = async () => {
    render(body, html`<div class="center-loader"><span class="loader"><span class="loader__eclipse"></span>Carregando séries…</span></div>`);
    try {
      if (!st.series) st.series = (await tcg.listSeries(st.lang)) || [];
      if (!alive) return;
      const openId = st.openSerie || st.series[st.series.length - 1]?.id;
      if (openId && !st.serieSets[openId]) st.serieSets[openId] = await tcg.getSerie(st.lang, openId);
      if (!alive) return;
      const serie = st.serieSets[openId];
      render(body, html`
        <div class="panel" style="margin-bottom:20px"><div class="panel__head"><h2 class="panel__title">${icon('globe')} Explorar por série</h2><span class="text-xs muted">${st.series.length} séries em ${tcg.langLabel(st.lang)}</span></div>
          <div class="chips">${[...st.series].reverse().map((s) => html`<button class="chip" type="button" data-serie="${s.id}" aria-pressed="${s.id === openId}">${s.name}</button>`)}</div></div>
        ${serie ? html`<section class="serie-block"><h2>${serie.name}</h2>
          <div class="set-grid">${[...(serie.sets || [])].reverse().map((s) => html`<button class="set-card" type="button" data-set="${s.id}">
            <div class="set-card__logo">${tcg.setLogoSources(s).length ? html`<img src="${tcg.setLogoSources(s)[0]}" data-fallbacks="${tcg.setLogoSources(s).slice(1).join('|')}" alt="" loading="lazy">` : html`<span>${s.name}</span>`}</div>
            <div class="set-card__name">${s.name}</div>
            <div class="set-card__meta">${tcg.setSymbolSources(s).length ? html`<img src="${tcg.setSymbolSources(s)[0]}" data-fallbacks="${tcg.setSymbolSources(s).slice(1).join('|')}" alt="" loading="lazy">` : ''}<span title="${s.cardCount?.official && s.cardCount?.total > s.cardCount.official ? `${s.cardCount.official} numeradas + ${s.cardCount.total - s.cardCount.official} secretas/extras` : ''}">${s.cardCount?.total || s.cardCount?.official || '?'} cartas · ${s.id}</span></div></button>`)}</div></section>` : ''}
        <div class="panel"><div class="panel__head"><h2 class="panel__title">${icon('sparkles')} Gerações Pokémon</h2>${tcg.isLocal(st.lang) ? html`<span class="text-xs muted">pelo nº da Pokédex (campo dexId)</span>` : ''}</div>
          ${tcg.isLocal(st.lang)
    ? html`<div class="chips">${GENERATIONS.map((g) => html`<button class="chip" type="button" data-gen="${g.gen}">Geração ${g.gen} · ${g.label}</button>`)}</div>`
    : html`<p class="text-sm muted">A exploração por geração usa a base local, disponível por enquanto em inglês.</p>`}</div>`);
      body.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => {
        const logo = img.closest('.set-card__logo');
        if (logo) { const span = document.createElement('span'); span.textContent = logo.closest('.set-card').querySelector('.set-card__name')?.textContent || ''; logo.replaceChildren(span); } else img.remove();
      }, { once: true }));
      body.querySelectorAll('[data-serie]').forEach((b) => b.addEventListener('click', () => { st.openSerie = b.dataset.serie; sync(); paintBrowse(); }));
      body.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => { st.set = b.dataset.set; sync(); paintFilters(); load(true); }));
      body.querySelectorAll('[data-gen]').forEach((b) => b.addEventListener('click', () => { st.gen = b.dataset.gen; sync(); load(true); }));
    } catch (e) { st.error = e; paintResults(); }
  };

  paintFilters();
  paintChips();
  await load(true);
  return () => { alive = false; };
}

export { cached, cardKeyOf };
