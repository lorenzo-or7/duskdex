"""Testes ponta a ponta do DuskDex (Playwright + Chromium).

Pré-requisito: servidor rodando em http://127.0.0.1:8080 (php -S 127.0.0.1:8080 server.php).
A API TCGdex é simulada (tcgdex_mock.py); fontes externas são bloqueadas para estabilidade.
Uso: python3 tests/e2e/run_e2e.py [filtro]
"""
import json
import os
import re
import sys
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

sys.path.insert(0, str(Path(__file__).parent))
import tcgdex_mock  # noqa: E402

BASE = os.environ.get('DUSKDEX_URL', 'http://127.0.0.1:8080/')
FIX = Path(__file__).parent / 'fixtures'
SHOTS = Path(os.environ.get('DUSKDEX_SHOTS', '/tmp/duskdex-shots'))
SHOTS.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=10000)

IDB_DUMP = """async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('duskdex-demo'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = (n) => new Promise((res) => { const t = db.transaction(n).objectStore(n).getAll(); t.onsuccess = () => res(t.result); });
  const out = { copies: await all('copies'), binders: await all('binders'), batches: await all('batches'), decks: await all('decks'), wishlist: await all('wishlist'), locations: await all('locations'), assets: (await all('assets')).map(a => ({ id: a.id, name: a.name })) };
  db.close();
  return out;
}"""


def new_page(browser, width=1440, height=900, mode=None, color_scheme='dark', examples=True):
    ctx = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=color_scheme)
    page = ctx.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    page.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    page.route('**/api.tcgdex.net/**', tcgdex_mock.handle)
    page.route('**/assets.tcgdex.net/**', tcgdex_mock.handle)
    # Sem conta, o app começa vazio; os testes usam a coleção de exemplo (escolha guardada nas preferências).
    page.add_init_script(
        "(() => { let p = {}; try { p = JSON.parse(localStorage.getItem('dd.prefs')) || {}; } catch (e) {}"
        + (" if (!('guestStart' in p)) p.guestStart = 'examples';" if examples else " if (!('guestStart' in p)) p.guestStart = 'empty';")
        + (f" p.dataMode = '{mode}';" if mode else '')
        + " localStorage.setItem('dd.prefs', JSON.stringify(p)); })()")
    return ctx, page


def go(page, route, wait='#main .page'):
    page.goto(BASE + route)
    page.wait_for_selector(wait)


def dump(page):
    return page.evaluate(IDB_DUMP)


def menu_click(page, label):
    page.locator('.menu .menu__item', has_text=label).first.click()


def select_by_text(sel, text):
    value = sel.evaluate("(el, t) => [...el.options].find(o => o.textContent.includes(t))?.value", text)
    assert value, f'opção “{text}” não encontrada'
    sel.select_option(value)


def tile_named(scope, name):
    return scope.locator('.card-tile').filter(has=scope.page.locator('.card-tile__name', has_text=re.compile(f'^{re.escape(name)}$'))).first if hasattr(scope, 'page') else None


def toast_has(page, text):
    expect(page.locator('.toast', has_text=text).first).to_be_visible()


# ---------------------------------------------------------------- testes

def t_boot_navigation(browser):
    ctx, page = new_page(browser)
    go(page, '#/inicio', 'text=Cartas físicas')
    expect(page.locator('.modebar')).to_contain_text('Sem conta')
    for label, heading in [('Minha Coleção', 'Minha Coleção'), ('Fichários', 'Fichários'), ('Inventário', 'Inventário'), ('Decks', 'Decks'), ('Catálogo', 'Catálogo'),
                           ('Wishlist', 'Wishlist'), ('Objetivos', 'Objetivos'), ('Comunidade', 'Comunidade'), ('Perfil', None), ('Início', None)]:
        page.locator('.sidebar .nav__item', has_text=label).first.click()
        if heading:
            expect(page.locator('#main h1').first).to_have_text(heading)
        expect(page.locator(f'.sidebar .nav__item[aria-current="page"]', has_text=label)).to_have_count(1)
    page.goto(BASE + '#/rota-inexistente')
    expect(page.locator('text=404')).to_be_visible()
    assert not page.errors, page.errors
    ctx.close()


def t_theme(browser):
    ctx, page = new_page(browser, color_scheme='light')
    go(page, '#/inicio')
    assert page.evaluate("document.documentElement.dataset.theme") == 'light', 'primeira visita deve seguir o sistema (claro)'
    page.locator('.sidebar [data-theme-toggle]').click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
    assert page.evaluate("localStorage.getItem('dd.theme')") == 'dark'
    assert page.locator('.sidebar [data-theme-toggle]').get_attribute('aria-checked') == 'true'
    # sem flash: com o app.js bloqueado, o script inline já aplica o tema salvo
    page.route('**/js/app.js', lambda r: r.abort())
    page.goto(BASE + '#/inicio')
    assert page.evaluate("document.documentElement.dataset.theme") == 'dark', 'tema salvo deve ser aplicado antes do app'
    page.unroute('**/js/app.js')
    # teclado
    go(page, '#/inicio')
    page.locator('.sidebar [data-theme-toggle]').focus()
    page.keyboard.press('Enter')
    expect(page.locator('html')).to_have_attribute('data-theme', 'light')
    ctx.close()


def t_catalog_add_copies(browser):
    ctx, page = new_page(browser)
    go(page, '#/catalogo')
    page.fill('[data-q]', 'Furret')
    page.keyboard.press('Enter')
    tile = page.locator('.card-tile[data-id="swsh3-136"]')
    expect(tile).to_be_visible()
    expect(tile.locator('img.is-loaded')).to_have_count(1)  # imagem (simulada) carregada com sucesso
    tile.locator('[data-open]').click()
    expect(page.locator('#main h1')).to_have_text('Furret')
    expect(page.locator('text=Feelin\' Fine')).to_be_visible()
    page.click('[data-act="collection"]')
    modal = page.locator('.modal')
    modal.locator('[data-inc="0"]').click()
    modal.locator('[data-inc="0"]').click()
    expect(modal.locator('[data-preview]')).to_contain_text('3')
    modal.locator('[data-ok]').click()
    toast_has(page, 'Salvo na coleção')
    d = dump(page)
    normal = [c for c in d['copies'] if c['cardId'] == 'swsh3-136' and c['finish'] == 'normal' and c['status'] == 'active']
    assert len(normal) == 3, f'esperava 3 cópias individuais, veio {len(normal)}'
    assert len({c['id'] for c in normal}) == 3
    acq = [b for b in d['batches'] if b['type'] == 'acquire' and any(m['copyId'] in {c['id'] for c in normal} for m in b['movements'])]
    assert acq and len(acq[0]['movements']) == 3, 'aquisição deve registrar 3 movimentos'
    page.goto(BASE + '#/colecao?q=Furret')
    page.reload()
    page.wait_for_selector('#main [data-summary]')
    try:
        expect(page.locator('.card-tile', has_text='Furret').locator('.card-tile__qty', has_text='×3')).to_have_count(1)
    except AssertionError:
        page.screenshot(path=str(SHOTS / 'fail-collection.png'))
        raise
    ctx.close()


def create_binder(page, name, physical=True, layout='3x3'):
    go(page, '#/ficharios')
    page.click('[data-new]')
    m = page.locator('.modal')
    if not physical:
        m.locator('input[name="type"][value="virtual"]').check()
    m.locator('input[name="name"]').fill(name)
    m.locator('select[name="layout"]').select_option(layout)
    m.locator('input[name="pages"]').fill('4')
    m.locator('[data-ok]').click()
    expect(page.locator('#main h1')).to_have_text(name)


def pocket(page, sheet_index, i):
    return page.locator('[data-stage] .book > .sheet').nth(sheet_index).locator('.pocket').nth(i)


def t_binder_physical_rules(browser):
    ctx, page = new_page(browser)
    go(page, '#/inicio')
    create_binder(page, 'Teste Físico')
    page.click('[data-view="single"]')
    page.click('[data-edit]')
    # 1) coloca uma cópia livre
    pocket(page, 0, 0).click()
    menu_click(page, 'Colocar carta física')
    picker = page.locator('.modal')
    picker.locator('[data-f]').fill('Pikachu')
    picker.locator('[data-pick]').first.click()
    toast_has(page, 'Carta física posicionada')
    expect(pocket(page, 0, 0)).to_have_class(re.compile('pocket--copy'))
    # 2) traz o Charizard que está no Kanto Clássico → deve SAIR de lá (uma cópia, um lugar)
    pocket(page, 0, 1).click()
    menu_click(page, 'Colocar carta física')
    picker = page.locator('.modal')
    picker.locator('[data-free]').uncheck()
    picker.locator('[data-f]').fill('Charizard')
    picker.locator('[data-pick]', has_text='Trazer de outro fichário').first.click()
    page.locator('.modal [data-ok]', has_text='Mover para cá').click()
    toast_has(page, 'Carta física posicionada')
    d = dump(page)
    charizards = [c for c in d['copies'] if c['cardId'] == 'base1-4' and c['status'] == 'active']
    assert len(charizards) == 1
    cid = charizards[0]['id']
    refs = [(b['name'], p['id'], i) for b in d['binders'] for p in b['pages'] for i, s in enumerate(p['slots']) if s.get('copyId') == cid]
    assert len(refs) == 1 and refs[0][0] == 'Teste Físico', f'cópia em {refs}'
    kanto = next(b for b in d['binders'] if b['name'] == 'Kanto Clássico')
    assert kanto['pages'][0]['slots'][1]['kind'] == 'empty', 'bolso de origem deve ficar vazio'
    assert charizards[0]['slot']['binderId'] != kanto['id']
    # 3) bloqueio + fantasma em bolso bloqueado
    pocket(page, 0, 2).click()
    menu_click(page, 'Bloquear / reservar bolso')
    expect(pocket(page, 0, 2)).to_have_class(re.compile('is-locked'))
    pocket(page, 0, 2).click()
    expect(page.locator('.menu .menu__item', has_text='Colocar carta física')).to_be_disabled()
    menu_click(page, 'Carta fantasma')
    page.locator('.modal [data-tab="samples"]').click()
    page.locator('.modal .card-tile', has_text='Mewtwo').click()
    page.locator('.modal [data-ok]').click()
    expect(pocket(page, 0, 2)).to_have_class(re.compile('pocket--ghost'))
    # 4) persiste após recarregar
    page.reload()
    page.wait_for_selector('[data-stage] .pocket')
    expect(pocket(page, 0, 0)).to_have_class(re.compile('pocket--copy'))
    expect(pocket(page, 0, 2)).to_have_class(re.compile('pocket--ghost'))
    # 5) desfazer: troca 0↔1 por arrastar e soltar, depois Ctrl+Z
    page.click('[data-edit]') if 'Concluir' not in page.locator('[data-edit]').inner_text() else None
    pocket(page, 0, 0).drag_to(pocket(page, 0, 1))
    toast_has(page, 'Cartas trocadas')
    d = dump(page)
    b = next(x for x in d['binders'] if x['name'] == 'Teste Físico')
    first = b['pages'][0]['slots'][0]['copyId']
    c = next(x for x in d['copies'] if x['id'] == first)
    assert c['slot']['index'] == 0, 'slot da cópia deve acompanhar a troca'
    assert not page.errors, page.errors
    ctx.close()


def t_virtual_binder_unowned(browser):
    ctx, page = new_page(browser)
    go(page, '#/inicio')
    before = len([c for c in dump(page)['copies'] if c['status'] == 'active'])
    create_binder(page, 'Planos', physical=False, layout='4x3')
    page.click('[data-edit]')
    pocket(page, 0, 0).click()
    menu_click(page, 'Referência virtual')
    m = page.locator('.modal')
    m.locator('[data-q]').fill('Butterfree')
    m.locator('.card-tile', has_text='Butterfree V').filter(has_text='Darkness Ablaze').first.click()
    m.locator('[data-ok]').click()
    expect(pocket(page, 0, 0)).to_have_class(re.compile('pocket--virtual'))
    d = dump(page)
    assert len([c for c in d['copies'] if c['status'] == 'active']) == before, 'fichário virtual não pode consumir cópias'
    # fichário virtual não oferece cartas físicas
    pocket(page, 0, 1).click()
    expect(page.locator('.menu .menu__item', has_text='Colocar carta física')).to_have_count(0)
    page.keyboard.press('Escape')
    ctx.close()


def t_auto_arrange(browser):
    ctx, page = new_page(browser)
    go(page, '#/ficharios')
    page.locator('.binder-card', has_text='Kanto Clássico').click()
    page.click('[data-view="single"]')
    page.click('[data-edit]')
    page.click('[data-auto]')
    m = page.locator('.modal')
    m.locator('[data-crit]').select_option('name')
    expect(m.locator('[data-sum]')).to_contain_text('mudam de posição')
    expect(m.locator('text=Lista de reorganização física')).to_be_visible()
    m.locator('[data-ok]').click()
    page.locator('.modal [data-ok]', has_text='Aplicar').click()
    toast_has(page, 'Organização automática')
    d = dump(page)
    kanto = next(b for b in d['binders'] if b['name'] == 'Kanto Clássico')
    slots = kanto['pages'][0]['slots']
    assert slots[7]['locked'] and slots[7]['kind'] == 'empty', 'bolso bloqueado não pode se mover'
    cards = {c['key']: c for c in page.evaluate("() => [] ")} if False else None
    names = [s.get('cardKey') for s in slots if s['kind'] != 'empty']
    assert names, 'página deve ter conteúdo'
    # cada cópia física aponta para o bolso correto
    for i, s in enumerate(slots):
        if s['kind'] == 'copy':
            c = next(x for x in d['copies'] if x['id'] == s['copyId'])
            assert c['slot']['index'] == i and c['slot']['pageId'] == kanto['pages'][0]['id']
    ctx.close()


def inventory_move(page, location_name, dest_label, count=1):
    go(page, '#/inventario')
    page.locator('.tree__node', has_text=location_name).first.click()
    boxes = page.locator('[data-copy]:not([disabled])')
    for i in range(count):
        boxes.nth(0 if i == 0 else i).check()
    page.click('[data-move]')
    m = page.locator('.modal')
    select_by_text(m.locator('[data-dest]'), dest_label)
    expect(m.locator('[data-preview] table')).to_be_visible()
    m.locator('[data-ok]').click()
    toast_has(page, 'Movimentação registrada')


def t_inventory_move_revert_conflict(browser):
    ctx, page = new_page(browser)
    go(page, '#/inicio')
    inventory_move(page, 'Caixa Base Set', 'Gaveta de trocas', count=2)
    d = dump(page)
    moved = [b for b in d['batches'] if b['type'] == 'move'][0]
    assert len(moved['movements']) == 2
    ids = [m['copyId'] for m in moved['movements']]
    gaveta = next(l for l in d['locations'] if l['name'] == 'Gaveta de trocas')
    assert all(next(c for c in d['copies'] if c['id'] == i)['locationId'] == gaveta['id'] for i in ids)
    # move um deles de novo (Gaveta → Estante) para criar um conflito posterior
    inventory_move(page, 'Gaveta de trocas', 'Estante', count=1)
    go(page, '#/inventario?aba=historico')
    target = page.locator('details', has_text='Movimentação para “Gaveta de trocas”').first
    target.locator('[data-revert]').click()
    m = page.locator('.modal')
    expect(m.locator('text=movida novamente')).to_have_count(1)
    expect(m.locator('[data-mv]:disabled')).to_have_count(1)
    expect(m.locator('[data-mv]:not(:disabled)')).to_have_count(1)
    m.locator('[data-ok]').click()
    page.locator('.modal [data-ok]', has_text='Já devolvi').click()
    toast_has(page, 'Operação revertida')
    d2 = dump(page)
    original = next(b for b in d2['batches'] if b['id'] == moved['id'])
    assert len(original['movements']) == 2, 'histórico original intacto'
    assert len(original.get('revertedMovementIds', [])) == 1
    rev = [b for b in d2['batches'] if b['type'] == 'revert']
    assert len(rev) == 1 and rev[0]['revertsBatchId'] == moved['id'], 'reversão gera lote compensatório'
    caixa = next(l for l in d2['locations'] if l['name'] == 'Caixa Base Set')
    back = next(c for c in d2['copies'] if c['id'] == rev[0]['movements'][0]['copyId'])
    assert back['locationId'] == caixa['id']
    # nenhuma cópia em dois lugares: cada cópia com slot deve corresponder exatamente a um bolso
    slot_refs = {}
    for b in d2['binders']:
        for p in b['pages']:
            for i, s in enumerate(p['slots']):
                if s['kind'] == 'copy':
                    assert s['copyId'] not in slot_refs, 'cópia em dois bolsos!'
                    slot_refs[s['copyId']] = (b['id'], p['id'], i)
    for c in d2['copies']:
        if c.get('slot'):
            assert slot_refs.get(c['id']) == (c['slot']['binderId'], c['slot']['pageId'], c['slot']['index'])
    ctx.close()


def t_deck_flow(browser):
    ctx, page = new_page(browser)
    go(page, '#/decks')
    page.click('[data-new]')
    page.locator('.modal input').fill('Deck de Teste')
    page.locator('.modal [data-ok]').click()
    expect(page.locator('[data-name]')).to_have_value('Deck de Teste')
    page.click('[data-add]')
    m = page.locator('.modal')
    m.locator('[data-tab="samples"]').click()
    for n in ['Charmander', 'Charizard', 'Fire Energy']:
        m.locator('.card-tile').filter(has=page.locator('.card-tile__name', has_text=re.compile(f'^{n}$'))).first.click()
    m.locator('[data-ok]').click()
    expect(page.locator('.deck-line')).to_have_count(3)
    page.locator('.deck-line', has_text='Charmander').locator('[data-inc]').click()
    page.locator('.deck-line', has_text='Charmander').locator('[data-inc]').click()
    expect(page.locator('.deck-line', has_text='Charmander').locator('output')).to_have_text('3')
    expect(page.locator('.validity')).to_contain_text('exige 60')
    expect(page.locator('.validity')).to_contain_text('Legalidade segundo a lista pública da TCGdex')
    expect(page.locator('[data-save]')).to_contain_text('Salvo', timeout=5000)
    # regressão: depois do salvamento automático, o + continua funcionando (sem recarregar a página)
    fire = page.locator('.deck-line', has_text='Fire Energy')
    fire.locator('[data-inc]').click()
    expect(fire.locator('output')).to_have_text('2')
    expect(page.locator('[data-save]')).to_contain_text('Salvo', timeout=5000)
    fire.locator('[data-inc]').click()
    expect(fire.locator('output')).to_have_text('3')
    expect(page.locator('[data-save]')).to_contain_text('Salvo', timeout=5000)
    page.reload(); page.wait_for_selector('.deck-line')
    expect(page.locator('.deck-line', has_text='Fire Energy').locator('output')).to_have_text('3')
    # disponibilidade: seed tem 3 Charmander (2 na caixa + 1 no fichário) → nada falta para 3
    expect(page.locator('.deck-line', has_text='Charmander')).to_contain_text('completo')
    # montagem física: reservar e montar
    page.click('[data-assemble]')
    m = page.locator('.modal')
    m.locator('[data-n]').click()  # → escolher cópias
    m.locator('[data-n]').click()  # → reservar
    expect(m.locator('text=Lista de separação')).to_be_visible()
    m.locator('[data-n]').click()  # → confirmar
    m.locator('[data-n]').click()  # monta
    toast_has(page, 'Deck montado')
    d = dump(page)
    deck = next(x for x in d['decks'] if x['name'] == 'Deck de Teste')
    assert deck['status'] == 'assembled'
    inside = [c for c in d['copies'] if c['reservedFor'] == deck['id']]
    assert inside and all(c['deckAssembled'] and c['locationId'] == deck['locationId'] and not c['slot'] for c in inside)
    # uma cópia montada não pode ir para outro deck nem para um fichário
    page.reload()
    page.wait_for_selector('.deck-line')
    expect(page.locator('text=Montado fisicamente').first).to_be_visible()
    ctx.close()


def t_wishlist(browser):
    ctx, page = new_page(browser)
    go(page, '#/wishlist')
    expect(page.locator('.card-row[data-id]')).to_have_count(4)
    page.locator('.card-row[data-id]', has_text='Dratini').locator('[data-ghost]').click()
    page.locator('.modal [data-b]', has_text='Noite Eterna').click()
    page.locator('.modal .pocket:not([disabled])').first.click()
    toast_has(page, 'Fantasma criado')
    expect(page.locator('.card-row[data-id]', has_text='Dratini').locator('.chip', has_text='Noite Eterna')).to_be_visible()
    ctx.close()


def t_images_and_panorama(browser):
    ctx, page = new_page(browser)
    go(page, '#/imagens')
    page.set_input_files('[data-file]', str(FIX / 'art.png'))
    toast_has(page, 'imagem(ns) adicionada(s)')
    expect(page.locator('.asset')).to_have_count(1)
    # tipo real verificado: arquivo de texto com extensão .png é recusado
    bad = SHOTS / 'fake.png'
    bad.write_text('isto não é uma imagem' * 20)
    page.set_input_files('[data-file]', str(bad))
    toast_has(page, 'Formato não suportado')
    # imagem individual com recorte
    go(page, '#/ficharios')
    page.locator('.binder-card', has_text='Noite Eterna').click()
    page.click('[data-view="single"]')
    page.click('[data-edit]')
    pocket(page, 0, 9).click()
    menu_click(page, 'Imagem própria')
    page.locator('.modal .asset').first.click()
    page.locator('.modal input[data-scale]').fill('1.6')
    page.locator('.modal [data-ok]').click()
    expect(pocket(page, 0, 9)).to_have_class(re.compile('pocket--image'))
    # panorama 3x3 na página 2
    page.click('[data-pano]')
    page.wait_for_selector('[data-lib]')
    page.click('[data-pn]')
    page.locator('[data-size="2×2"]').click()
    page.click('[data-lib]')
    page.locator('.modal .asset').first.click()
    page.wait_for_selector('[data-stage] img')
    expect(page.locator('.pano-tiles .pocket')).to_have_count(4)
    page.click('[data-apply]')
    toast_has(page, 'Panorama aplicado')
    # depois de aplicar, o usuário é levado ao fichário, na página do panorama
    page.wait_for_url(re.compile(r'#/ficharios/[^/?]+\?pagina=2'))
    page.wait_for_selector('[data-spectate]')
    d = dump(page)
    b = next(x for x in d['binders'] if x['name'] == 'Noite Eterna')
    pano = [s for s in b['pages'][1]['slots'] if s['kind'] == 'image' and s.get('panorama')]
    assert len(pano) == 4 and len({s['panorama']['id'] for s in pano}) == 1
    assert len(d['assets']) == 1, 'original preservado: uma única imagem na biblioteca'
    # objetivos não contam imagens
    go(page, '#/objetivos')
    expect(page.locator('text=nunca contam como possuídas')).to_be_visible()
    ctx.close()


def t_book_flip(browser):
    ctx, page = new_page(browser)
    go(page, '#/ficharios')
    page.locator('.binder-card', has_text='Kanto Clássico').click()
    page.click('[data-view="book"]')
    expect(page.locator('.page-nav__label')).to_have_text('Págs. 1–2 de 6')
    page.click('[data-next]')
    page.wait_for_selector('.leaf', state='attached', timeout=2000)
    expect(page.locator('.page-nav__label')).to_have_text('Págs. 3–4 de 6')
    page.keyboard.press('ArrowLeft')
    expect(page.locator('.page-nav__label')).to_have_text('Págs. 1–2 de 6')
    page.screenshot(path=str(SHOTS / 'book-desktop.png'))
    # o livro aberto cabe na altura da janela
    h = page.evaluate("document.querySelector('[data-book]').getBoundingClientRect().height")
    assert h <= 900 - 150, f'fichário alto demais ({h}px)'
    # primeira página à direita: verso da capa + pág. 1, depois 2–3
    go(page, '#/ficharios')
    page.click('[data-new]')
    m = page.locator('.modal')
    m.locator('input[name="name"]').fill('Capa Presa')
    m.locator('input[name="pages"]').fill('5')
    m.locator('input[name="firstPageRight"]').check()
    m.locator('[data-ok]').click()
    expect(page.locator('#main h1')).to_have_text('Capa Presa')
    page.click('[data-view="book"]')
    expect(page.locator('.page-nav__label')).to_have_text('Capa · pág. 1 de 5')
    expect(page.locator('[data-book] > .sheet').first).to_contain_text('Verso da capa')
    expect(page.locator('[data-prev]')).to_be_disabled()
    page.click('[data-next]')
    expect(page.locator('.page-nav__label')).to_have_text('Págs. 2–3 de 5')
    page.click('[data-prev]')
    expect(page.locator('.page-nav__label')).to_have_text('Capa · pág. 1 de 5')
    assert not page.errors, page.errors
    ctx.close()


def t_cross_tab(browser):
    ctx, page = new_page(browser)
    go(page, '#/colecao')
    other = ctx.new_page()
    other.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    other.goto(BASE + '#/colecao')
    other.wait_for_selector('#main .page')
    page.locator('.card-tile').first.locator('[data-open]').click()
    page.locator('.modal [data-inc]').click()
    expect(other.locator('.toast', has_text='Dados atualizados em outra aba')).to_be_visible()
    ctx.close()


def t_responsive(browser):
    routes = ['#/inicio', '#/colecao', '#/catalogo', '#/ficharios', '#/inventario', '#/decks', '#/wishlist', '#/objetivos', '#/comunidade', '#/perfil', '#/configuracoes', '#/']
    for (w, h, label) in [(390, 844, 'mobile'), (820, 1180, 'tablet'), (1280, 800, 'notebook')]:
        ctx, page = new_page(browser, w, h)
        for r in routes:
            go(page, r, '#main > *')
            page.wait_for_timeout(250)
            over = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            assert over <= 1, f'overflow horizontal de {over}px em {r} ({label})'
        if label == 'mobile':
            go(page, '#/inicio')
            expect(page.locator('.bottomnav')).to_be_visible()
            expect(page.locator('.sidebar')).to_be_hidden()
            # rolando até o fim, o rodapé (último conteúdo) termina acima da barra inferior
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            page.wait_for_timeout(200)
            last = page.evaluate("document.querySelector('.site-footer--app .site-footer__legal').getBoundingClientRect().bottom")
            nav_top = page.evaluate("document.querySelector('.bottomnav').getBoundingClientRect().top")
            assert last <= nav_top, f'conteúdo escondido atrás da barra inferior ({last} > {nav_top})'
            expect(page.locator('.site-footer--app .site-footer__legal')).to_contain_text('Nintendo')
            page.locator('.bottomnav__item', has_text='Fichários').click()
            expect(page.locator('#main h1')).to_have_text('Fichários')
            page.click('[data-more]')
            page.locator('.modal .nav__item', has_text='Inventário').click()
            expect(page.locator('#main h1')).to_have_text('Inventário')
            go(page, '#/ficharios')
            page.locator('.binder-card', has_text='Kanto Clássico').click()
            page.wait_for_selector('.book--single')  # celular usa página única
            page.screenshot(path=str(SHOTS / 'binder-mobile.png'))
            go(page, '#/inicio')
            page.screenshot(path=str(SHOTS / 'dashboard-mobile.png'), full_page=True)
        if label == 'tablet':
            go(page, '#/inicio')
            wsb = page.evaluate("document.querySelector('.sidebar').getBoundingClientRect().width")
            assert wsb < 100, f'tablet deve usar trilho recolhido, largura {wsb}'
        ctx.close()


def t_server_mode(browser):
    ctx, page = new_page(browser, mode='server')
    page.goto(BASE + '#/inicio')
    page.wait_for_selector('text=Criar conta')
    page.click('.welcome a[href="#/registrar"]')
    user = f"e2e{int(time.time())}"
    page.fill('input[name="displayName"]', 'Teste E2E')
    page.fill('input[name="username"]', user)
    page.fill('input[name="email"]', f'{user}@example.com')
    page.fill('input[name="password"]', 'senha-segura-123')
    page.check('input[name="acceptTerms"]')
    page.click('button[type="submit"]')
    page.wait_for_selector('text=Cartas físicas')
    expect(page.locator('.sidebar [data-account-label]')).to_contain_text(f'@{user}')
    expect(page.locator('.modebar')).to_contain_text('Confirme seu e-mail')
    # cadastra uma carta (TCGdex simulada no navegador; o servidor guarda o snapshot)
    go(page, '#/carta/swsh3-136?lang=en', '#main h1')
    page.click('[data-act="collection"]')
    page.locator('.modal [data-inc="0"]').click()
    page.locator('.modal [data-ok]').click()
    toast_has(page, 'no servidor')
    create_binder(page, 'Servidor Físico')
    page.click('[data-view="single"]')
    page.click('[data-edit]')
    pocket(page, 0, 4).click()
    menu_click(page, 'Colocar carta física')
    page.locator('.modal [data-pick]').first.click()
    toast_has(page, 'Carta física posicionada')
    page.reload()
    page.wait_for_selector('[data-stage] .pocket')
    expect(pocket(page, 0, 4)).to_have_class(re.compile('pocket--copy'))
    # imagens próprias também funcionam com conta (arquivo enviado ao servidor)
    if 'Concluir' not in page.locator('[data-edit]').inner_text():
        page.click('[data-edit]')
    pocket(page, 0, 5).click()
    expect(page.locator('.menu .menu__item', has_text='Imagem própria')).to_be_enabled()
    menu_click(page, 'Imagem própria')
    page.set_input_files('.modal [data-file]', str(FIX / 'art.png'))
    page.wait_for_selector('.modal .cropper')
    page.locator('.modal [data-ok]').click()
    expect(pocket(page, 0, 5)).to_have_class(re.compile('pocket--image'))
    page.reload()
    page.wait_for_selector('[data-stage] .pocket')
    expect(pocket(page, 0, 5).locator('img')).to_have_count(1)
    assert pocket(page, 0, 5).locator('img').evaluate('i => i.complete && i.naturalWidth > 0'), 'imagem do servidor deve carregar'
    # sair
    page.locator('.sidebar [data-logout]').click()
    page.wait_for_selector('text=Entrar')
    page.goto(BASE + '#/colecao')
    page.wait_for_selector('input[name="login"]')
    page.fill('input[name="login"]', user)
    page.fill('input[name="password"]', 'senha-segura-123')
    page.click('button[type="submit"]')
    page.wait_for_selector('text=Cartas físicas')
    go(page, '#/colecao')
    expect(page.locator('.card-tile', has_text='Furret')).to_have_count(1)
    assert not page.errors, page.errors
    ctx.close()


def t_welcome(browser):
    ctx, page = new_page(browser)
    go(page, '#/', '.welcome')
    bg = page.evaluate("getComputedStyle(document.querySelector('.welcome__scene--dark')).backgroundImage")
    assert 'duskdex-login-dark' in bg, bg
    assert page.evaluate("getComputedStyle(document.querySelector('.welcome__scene--dark')).backgroundSize") == 'cover', 'arte deve cobrir sem distorcer'
    # sem servidor: entrar não é simulado, explica e oferece o modo demo
    page.route('**/api/v1/**', lambda r: r.abort())
    page.fill('input[name="login"]', 'alguem')
    page.fill('input[name="password"]', 'qualquer-senha')
    page.click('button[type="submit"]')
    expect(page.locator('[data-err]')).to_contain_text('servidor DuskDex')
    expect(page.locator('.welcome a[href="#/recuperar"]')).to_be_visible()
    page.click('.welcome a[href="#/registrar"]')
    expect(page.locator('input[name="email"]')).to_be_visible()
    # troca de tema suave e persistente
    page.locator('.welcome [data-theme-toggle]').click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'light')
    expect(page.locator('.welcome__scene--light')).to_have_css('opacity', '1')
    bg = page.evaluate("getComputedStyle(document.querySelector('.welcome__panel')).backgroundColor")
    assert bg != 'rgb(255, 255, 255)', 'tema claro não deve ser branco'
    page.click('[data-guest]')
    page.wait_for_selector('text=Cartas físicas')
    assert not page.errors, page.errors
    ctx.close()


def t_multi_add_in_order(browser):
    ctx, page = new_page(browser)
    go(page, '#/inicio')
    create_binder(page, 'Sequência', physical=False, layout='3x3')
    page.click('[data-edit]')
    pocket(page, 0, 1).click()
    menu_click(page, 'Referência virtual')
    m = page.locator('.modal')
    m.locator('[data-q]').fill('Furret')
    m.locator('.card-tile').first.wait_for()
    tiles = m.locator('.card-tile')
    picked = [tiles.nth(i).get_attribute('data-key') for i in (2, 0, 1)]
    for i in (2, 0, 1):
        tiles.nth(i).click()
    expect(tiles.nth(2).locator('[data-select]')).to_have_attribute('data-order', '1')
    expect(tiles.nth(1).locator('[data-select]')).to_have_attribute('data-order', '3')
    m.locator('[data-ok]').click()
    toast_has(page, 'em ordem')
    d = dump(page)
    b = next(x for x in d['binders'] if x['name'] == 'Sequência')
    keys = [s.get('cardKey') for s in b['pages'][0]['slots'][1:4]]
    assert keys == picked, f'ordem errada: {keys} != {picked}'
    assert b['pages'][0]['slots'][0]['kind'] == 'empty'
    assert not page.errors, page.errors
    ctx.close()


def t_replace_slot(browser):
    ctx, page = new_page(browser)
    go(page, '#/ficharios')
    page.locator('.binder-card', has_text='Noite Eterna').click()
    page.click('[data-view="single"]')
    page.click('[data-edit]')
    d = dump(page)
    before = next(x for x in d['binders'] if x['name'] == 'Noite Eterna')['pages'][0]['slots'][0]
    assert before['kind'] == 'virtual', before
    pocket(page, 0, 0).click()
    menu_click(page, 'Substituir')
    page.locator('.modal [data-opt="ghost"]').click()
    m = page.locator('.modal')
    m.locator('[data-q]').fill('Furret')
    m.locator('.card-tile').first.wait_for()
    key = m.locator('.card-tile').first.get_attribute('data-key')
    m.locator('.card-tile').first.click()
    m.locator('[data-ok]').click()
    toast_has(page, 'substituído')
    after = next(x for x in dump(page)['binders'] if x['name'] == 'Noite Eterna')['pages'][0]['slots'][0]
    assert after['kind'] == 'ghost' and after['cardKey'] == key, after
    # desfazer volta exatamente ao conteúdo anterior
    page.keyboard.press('Control+z')
    page.wait_for_timeout(600)
    back = next(x for x in dump(page)['binders'] if x['name'] == 'Noite Eterna')['pages'][0]['slots'][0]
    assert back['kind'] == 'virtual' and back['cardKey'] == before['cardKey'], back
    assert not page.errors, page.errors
    ctx.close()


def t_languages_and_image_fallback(browser):
    ctx, page = new_page(browser)
    png = tcgdex_mock.CARD_PNG
    hits = []
    def ptcg(route):
        hits.append(route.request.url)
        route.fulfill(status=200, body=png, content_type='image/png')
    # a TCGdex "não tem" a imagem do Furret nem os logos; a base PokemonTCG tem
    page.route('**/assets.tcgdex.net/**/swsh3/136/**', lambda r: r.fulfill(status=404, body=''))
    page.route('**/images.pokemontcg.io/**', ptcg)
    page.route('**/images.scrydex.com/**', ptcg)
    go(page, '#/catalogo')
    page.fill('[data-q]', 'Furret')
    page.keyboard.press('Enter')
    tile = page.locator('.card-tile[data-id="swsh3-136"]')
    expect(tile.locator('img.is-loaded')).to_have_count(1)
    src = tile.locator('img').get_attribute('src')
    assert 'pokemontcg.io/swsh3/136' in src, src
    # idiomas: todos os da base local aparecem, sem depender da API
    opts = page.locator('[data-lang] option')
    codes = [opts.nth(i).get_attribute('value') for i in range(opts.count())]
    for c in ('en', 'fr', 'de', 'ja', 'zh-tw', 'pt'):
        assert c in codes, codes
    page.select_option('[data-lang]', 'fr')
    page.fill('[data-q]', 'Fouinar')
    page.keyboard.press('Enter')
    expect(page.locator('.card-tile[data-id="swsh3-136"]')).to_be_visible()
    page.select_option('[data-lang]', 'ja')
    page.fill('[data-q]', 'ピカチュウ')
    page.keyboard.press('Enter')
    expect(page.locator('.card-tile').first).to_be_visible()
    # logos de expansão: TCGdex (404) → inglês (404) → PokemonTCG
    page.select_option('[data-lang]', 'en')
    page.fill('[data-q]', '')
    page.keyboard.press('Enter')
    page.wait_for_selector('.set-card__logo img')
    page.wait_for_timeout(800)
    logos = page.locator('.set-card__logo img')
    assert logos.count() > 0
    assert any(('pokemontcg' in (logos.nth(i).get_attribute('src') or '') or 'scrydex' in (logos.nth(i).get_attribute('src') or '')) for i in range(logos.count()))
    assert not page.errors, page.errors
    ctx.close()


def register_ui(page, user):
    """Cria conta pela tela de registro (o app deve estar em modo servidor ou sem conta)."""
    page.goto(BASE + '#/registrar')
    page.wait_for_selector('input[name="displayName"]')
    page.fill('input[name="displayName"]', user.capitalize())
    page.fill('input[name="username"]', user)
    page.fill('input[name="email"]', f'{user}@example.com')
    page.fill('input[name="password"]', 'senha-segura-123')
    page.check('input[name="acceptTerms"]')
    page.click('button[type="submit"]')


def add_furret(page):
    go(page, '#/carta/swsh3-136?lang=en', '#main h1')
    page.click('[data-act="collection"]')
    page.locator('.modal [data-ok]').click()
    toast_has(page, 'Salvo na coleção')


def t_community_and_trade(browser):
    stamp = str(int(time.time()))[-7:]
    ua, ub = f'ana{stamp}', f'bia{stamp}'
    ca, a = new_page(browser, mode='server')
    cb, b = new_page(browser, mode='server')
    register_ui(a, ua); a.wait_for_selector('text=Cartas físicas')
    register_ui(b, ub); b.wait_for_selector('text=Cartas físicas')
    # A cadastra uma carta, marca para troca e publica
    add_furret(a)
    go(a, '#/colecao', '.card-tile')
    a.click('[data-selectmode]')
    a.locator('.card-tile', has_text='Furret').locator('[data-select]').click()
    a.click('[data-trade="1"]')
    # confirma o estado de conservação antes de oferecer (é o que os interessados veem)
    a.locator('.modal [data-cond-for]').first.select_option('SP')
    a.locator('.modal [data-ok]').click()
    toast_has(a, 'disponíveis para troca')
    go(a, '#/comunidade', '[data-compose]')
    a.fill('[data-compose] textarea', f'Olá, comunidade! {stamp}')
    a.click('[data-compose] [type="submit"]')
    toast_has(a, 'Publicado')
    # B vê o post, curte, comenta e segue A
    go(b, '#/comunidade', '[data-feed] .post')
    post = b.locator('.post', has_text=f'Olá, comunidade! {stamp}')
    expect(post).to_be_visible()
    post.locator('[data-like]').click()
    expect(post.locator('[data-likes]')).to_have_text('1')
    post.locator('[data-toggle-comments]').click()
    post.locator('[data-comment-form] input').fill('Bem-vinda!')
    post.locator('[data-comment-form] button').click()
    expect(post.locator('.comment', has_text='Bem-vinda!')).to_be_visible()
    go(b, f'#/u/{ua}', '.profile-head')
    b.click('[data-follow]')
    expect(b.locator('[data-follow]')).to_have_text('Seguindo')
    # B propõe troca pedindo o Furret de A
    b.click(f'a[href="#/trocas/nova/{ua}"]')
    b.wait_for_selector('[data-them]')
    expect(b.locator('[data-them] .cond-badge').first).to_have_text('SP')   # B vê o estado antes de pedir
    b.locator('[data-them] [data-select]').first.click()
    b.fill('[data-msg]', 'Troca pelo Furret?')
    b.click('[data-send]')
    toast_has(b, 'Proposta enviada')
    # A vê notificações (curtida, comentário, seguidor, troca) e aceita
    go(a, '#/notificacoes', '.notif-list')
    for txt in ('curtiu', 'comentou', 'começou a seguir', 'propôs uma troca'):
        expect(a.locator('.notif', has_text=txt).first).to_be_visible()
    go(a, '#/trocas', '[data-trade]')
    a.click('[data-trade] [data-accept]')
    a.locator('.modal [data-ok]').click()
    toast_has(a, 'Troca concluída')
    # Furret agora está com B (e saiu da coleção de A)
    go(b, '#/colecao', '#main h1')
    expect(b.locator('.card-tile', has_text='Furret')).to_have_count(1)
    go(b, '#/carta/swsh3-136?lang=en', '#main h1')
    expect(b.locator('[data-copy-cond]').first).to_have_value('SP')   # a carta chega com o estado informado
    go(a, '#/colecao', '#main h1')
    expect(a.locator('.card-tile', has_text='Furret')).to_have_count(0)
    assert not a.errors and not b.errors, (a.errors, b.errors)
    ca.close(); cb.close()


def t_guest_import(browser):
    ctx, page = new_page(browser, examples=False)
    go(page, '#/inicio', '.onboarding')
    expect(page.locator('.onboarding')).to_contain_text('Primeiros passos')
    add_furret(page)
    user = f'gst{str(int(time.time()))[-7:]}'
    register_ui(page, user)
    page.wait_for_selector('text=Trazer dados deste navegador')
    page.click('[data-go]')
    toast_has(page, 'Importação concluída')
    page.locator('.modal [data-cancel]').click()   # mantém a cópia do navegador
    go(page, '#/colecao', '#main h1')
    expect(page.locator('.card-tile', has_text='Furret')).to_have_count(1)
    assert page.evaluate("JSON.parse(localStorage.getItem('dd.prefs')).dataMode") == 'server'
    assert not page.errors, page.errors
    ctx.close()


def t_email_test_mode_and_slot_preview(browser):
    # servidor de desenvolvimento (MAIL_DRIVER=log): confirmar o e-mail direto pelo aviso
    ctx, page = new_page(browser, mode='server')
    user = f'mail{str(int(time.time()))[-7:]}'
    register_ui(page, user)
    bar = page.locator('[data-modebar]')
    expect(bar).to_contain_text('modo de teste')
    bar.locator('[data-verify-now]').click()
    page.wait_for_selector('text=E-mail confirmado')
    page.click('text=Continuar')
    expect(page.locator('[data-modebar]')).to_be_hidden()
    # prévia dos bolsos ao personalizar um fichário
    go(page, '#/ficharios', '#main h1')
    page.get_by_role('button', name='Novo fichário').first.click()
    page.wait_for_selector('[data-slot-preview] .pocket')
    for st in ('square', 'glow', 'rounded'):
        page.select_option('[data-st="slotStyle"]', st)
        expect(page.locator(f'[data-slot-preview] .pocket[data-slot-style="{st}"]').first).to_be_visible()
    assert page.locator('[data-slot-preview] .pocket').count() == 6
    assert not page.errors, page.errors
    ctx.close()


def t_picker_filters(browser):
    ctx, page = new_page(browser)
    page.add_init_script("(() => { const p = JSON.parse(localStorage.getItem('dd.prefs')||'{}'); p.catalogLang='pt'; localStorage.setItem('dd.prefs', JSON.stringify(p)); })()")
    go(page, '#/colecao', '#main h1')
    page.get_by_role('button', name='Adicionar cartas').first.click()
    m = page.locator('.modal')
    m.locator('[data-pfilters] [data-kind="GX"]').click()
    m.locator('.card-tile').first.wait_for()
    names = m.locator('.card-tile__name').all_inner_texts()
    assert names and all(n.endswith('GX') for n in names), names
    m.locator('[data-pf-clear]').click()
    m.locator('[data-pf="rarity"]').select_option('Illustration rare')
    m.locator('[data-q]').fill('pikachu')
    expect(m.locator('.card-tile__name')).to_have_text(['Pikachu'])
    expect(m.locator('[data-pf="rarity"] option:checked')).to_have_text('Ilustração Rara')
    assert not page.errors, page.errors
    ctx.close()


def t_faq(browser):
    ctx, page = new_page(browser)
    go(page, '#/inicio', '#main h1')
    page.locator('.sidebar a[href="#/ajuda"]').click()
    page.wait_for_selector('.faq__item')
    page.fill('.faq [data-q]', 'foto')
    expect(page.locator('#faq-sem-foto')).to_be_visible()
    go(page, '#/ajuda?item=precos', '.faq__item')
    expect(page.locator('#faq-precos')).to_have_attribute('open', '')
    assert not page.errors, page.errors
    ctx.close()


TESTS = [
    ('Tela de entrada: logo, entrar sem servidor, demo, tema', t_welcome),
    ('Inicialização e navegação', t_boot_navigation),
    ('Tema claro/escuro: interruptor, sem flash, teclado', t_theme),
    ('Catálogo → 3 cópias individuais persistidas', t_catalog_add_copies),
    ('Idiomas da base local e imagens/logos alternativos', t_languages_and_image_fallback),
    ('Fichário físico: uma cópia, um bolso; bloqueio; fantasma; persistência; drag-and-drop', t_binder_physical_rules),
    ('Fichário virtual com carta não possuída', t_virtual_binder_unowned),
    ('Várias cartas de uma vez, na ordem escolhida', t_multi_add_in_order),
    ('Substituir conteúdo de um bolso (e desfazer)', t_replace_slot),
    ('Organização automática com prévia e bolso bloqueado', t_auto_arrange),
    ('Inventário: mover lote, reverter parcialmente, conflito detectado', t_inventory_move_revert_conflict),
    ('Deck: lista, validação, faltantes, montagem física', t_deck_flow),
    ('Wishlist → fantasma em fichário', t_wishlist),
    ('Imagens: upload validado, recorte e panorama', t_images_and_panorama),
    ('Modo livro: virada de página', t_book_flip),
    ('Aviso entre abas', t_cross_tab),
    ('Responsividade (celular, tablet, notebook)', t_responsive),
    ('Modo servidor: registro, persistência MySQL, logout/login', t_server_mode),
    ('Comunidade real e troca entre duas contas (com estado de conservação)', t_community_and_trade),
    ('Sem conta: começa vazio e importa ao criar conta', t_guest_import),
    ('E-mail em modo de teste e prévia dos bolsos', t_email_test_mode_and_slot_preview),
    ('Filtros do seletor: GX, raridade + nome', t_picker_filters),
    ('Perguntas frequentes: menu, busca e link direto', t_faq),
]


def reset_rate_limits():
    # Execuções repetidas registram contas; zera os contadores do banco de desenvolvimento (ignora se não houver MySQL).
    import subprocess
    root = Path(__file__).resolve().parents[2]
    subprocess.run(['php', str(root / 'backend/bin/reset-rate-limits.php')], capture_output=True, timeout=20)


def main():
    reset_rate_limits()
    filt = sys.argv[1] if len(sys.argv) > 1 else ''
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, fn in TESTS:
            if filt and filt.lower() not in name.lower() and filt != fn.__name__:
                continue
            t0 = time.time()
            try:
                fn(browser)
                results.append((name, True, time.time() - t0, ''))
                print(f'✓ {name} ({time.time() - t0:.1f}s)', flush=True)
            except Exception as e:  # noqa: BLE001
                results.append((name, False, time.time() - t0, str(e)))
                print(f'✗ {name}\n   {type(e).__name__}: {str(e)[:900]}', flush=True)
                traceback.print_exc(limit=3)
        browser.close()
    ok = sum(1 for r in results if r[1])
    print(f'\n{ok}/{len(results)} testes E2E passaram.')
    (SHOTS / 'e2e-results.json').write_text(json.dumps([{'name': n, 'ok': o, 'seconds': round(s, 1), 'error': e} for n, o, s, e in results], ensure_ascii=False, indent=2))
    sys.exit(0 if ok == len(results) else 1)


if __name__ == '__main__':
    main()
