"""Simulação da API TCGdex para testes E2E (o ambiente de CI pode não ter internet).

As respostas seguem os formatos documentados em https://tcgdex.dev/reference/card e /reference/set
(o objeto da carta swsh3-136 é o exemplo oficial da documentação).
"""
import json
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs

FIX = Path(__file__).parent / 'fixtures'
CARD_PNG = (FIX / 'card.png').read_bytes()

SET_SWSH3 = {
    "cardCount": {"firstEd": 0, "holo": 64, "normal": 137, "official": 189, "reverse": 155, "total": 201},
    "cards": [
        {"id": "swsh3-1", "image": "https://assets.tcgdex.net/en/swsh/swsh3/1", "localId": "1", "name": "Butterfree V"},
        {"id": "swsh3-136", "image": "https://assets.tcgdex.net/en/swsh/swsh3/136", "localId": "136", "name": "Furret"},
        {"id": "swsh3-201", "image": "https://assets.tcgdex.net/en/swsh/swsh3/201", "localId": "201", "name": "Capture Energy"},
    ],
    "id": "swsh3", "legal": {"expanded": True, "standard": False},
    "logo": "https://assets.tcgdex.net/en/swsh/swsh3/logo", "name": "Darkness Ablaze", "releaseDate": "2020-08-14",
    "serie": {"id": "swsh", "name": "Sword & Shield"}, "symbol": "https://assets.tcgdex.net/univ/swsh/swsh3/symbol",
}

FURRET = {
    "category": "Pokemon", "id": "swsh3-136", "illustrator": "tetsuya koizumi", "image": "https://assets.tcgdex.net/en/swsh/swsh3/136",
    "localId": "136", "name": "Furret", "rarity": "Uncommon",
    "set": {"cardCount": {"official": 189, "total": 201}, "id": "swsh3", "logo": "https://assets.tcgdex.net/en/swsh/swsh3/logo", "name": "Darkness Ablaze", "symbol": "https://assets.tcgdex.net/univ/swsh/swsh3/symbol"},
    "variants": {"firstEdition": False, "holo": False, "normal": True, "reverse": True, "wPromo": False},
    "dexId": [162], "hp": 110, "types": ["Colorless"], "evolveFrom": "Sentret",
    "description": "It makes a nest to suit its long and skinny body. The nest is impossible for other Pokémon to enter.",
    "stage": "Stage1",
    "attacks": [
        {"cost": ["Colorless"], "name": "Feelin' Fine", "effect": "Draw 3 cards."},
        {"cost": ["Colorless"], "name": "Tail Smash", "effect": "Flip a coin. If tails, this attack does nothing.", "damage": 90},
    ],
    "weaknesses": [{"type": "Fighting", "value": "×2"}], "retreat": 1, "regulationMark": "D",
    "legal": {"standard": False, "expanded": True}, "updated": "2024-02-04T22:55:32+02:00",
}

BUTTERFREE = {**FURRET, "id": "swsh3-1", "localId": "1", "name": "Butterfree V", "rarity": "Rare Holo V", "image": "https://assets.tcgdex.net/en/swsh/swsh3/1", "dexId": [12], "hp": 210, "stage": "Basic", "types": ["Grass"], "attacks": [{"cost": ["Grass"], "name": "Test Attack", "damage": 30}]}
CAPTURE = {"category": "Energy", "id": "swsh3-201", "localId": "201", "name": "Capture Energy", "rarity": "Rare", "image": "https://assets.tcgdex.net/en/swsh/swsh3/201", "set": FURRET["set"], "variants": {"normal": False, "holo": True, "reverse": False, "firstEdition": False}, "energyType": "Special", "effect": "Test effect.", "updated": "2024-01-01T00:00:00Z"}
CARDS = {c["id"]: c for c in (FURRET, BUTTERFREE, CAPTURE)}
LANGS_OK = {"en", "fr", "pt-br"}
SERIES = [{"id": "base", "name": "Base"}, {"id": "swsh", "name": "Sword & Shield", "logo": "https://assets.tcgdex.net/en/swsh/swsh1/logo"}]


def handle(route):
    url = urlparse(route.request.url)
    if url.netloc == 'assets.tcgdex.net':
        if url.path.endswith(('.webp', '.png', '.jpg')) and re.search(r'/(low|high)\.', url.path):
            return route.fulfill(status=200, body=CARD_PNG, content_type='image/png')
        return route.fulfill(status=404, body='')
    m = re.match(r'^/v2/([a-z-]+)/(.*)$', url.path)
    if not m:
        return route.fulfill(status=404, body='{}')
    lang, rest = m.groups()
    q = parse_qs(url.query)
    if lang not in LANGS_OK:
        return route.fulfill(status=404, content_type='application/json', body=json.dumps({"type": "https://tcgdex.dev/errors/language-invalid", "title": "Language Invalid"}), headers={'Access-Control-Allow-Origin': '*'})

    def ok(obj):
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(obj), headers={'Access-Control-Allow-Origin': '*'})

    if rest == 'series':
        return ok(SERIES)
    if rest == 'series/swsh':
        return ok({"id": "swsh", "name": "Sword & Shield", "sets": [{"id": "swsh3", "name": "Darkness Ablaze", "logo": SET_SWSH3["logo"], "symbol": SET_SWSH3["symbol"], "cardCount": {"official": 189, "total": 201}}]})
    if rest == 'sets/swsh3':
        return ok(SET_SWSH3)
    if rest == 'rarities':
        return ok(["Common", "Uncommon", "Rare", "Rare Holo V"])
    if rest == 'types':
        return ok(["Colorless", "Fire", "Grass"])
    if rest == 'cards':
        name = (q.get('name', [''])[0]).replace('like:', '').lower()
        res = [{"id": c["id"], "localId": c["localId"], "name": c["name"], "image": c["image"]} for c in CARDS.values() if name in c["name"].lower()]
        return ok(res)
    mc = re.match(r'^cards/(.+)$', rest)
    if mc and mc.group(1) in CARDS:
        return ok(CARDS[mc.group(1)])
    return route.fulfill(status=404, content_type='application/json', body='{"title":"Not Found"}', headers={'Access-Control-Allow-Origin': '*'})
