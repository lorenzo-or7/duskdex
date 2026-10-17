"""Gera dist-preview/: cópia do frontend adaptada para publicação como página online (modo demo).

A página publicada é envolvida num esqueleto HTML próprio e bloqueia hosts externos (exceto Google Fonts),
então: remove doctype/html/head/body, retira manifest e preconnects da TCGdex e ativa o aviso de prévia.
Uso: python3 tools/build-preview.py
"""
import re
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
src, out = root / 'frontend', root / 'dist-preview'
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(src, out, ignore=shutil.ignore_patterns('manifest.webmanifest', 'sets.json', 'languages.json'))

page = (src / 'index.html').read_text(encoding='utf-8')
head = re.search(r'<head>(.*)</head>', page, re.S).group(1)
body = re.search(r'<body>(.*)</body>', page, re.S).group(1)
head = re.sub(r'\s*<link rel="(manifest|preconnect)" href="https://(api|assets)\.tcgdex\.net"[^>]*>', '', head)
head = re.sub(r'\s*<link rel="manifest"[^>]*>', '', head)
head = re.sub(r'\s*<meta charset="utf-8">|\s*<meta name="viewport"[^>]*>', '', head)
head = re.sub(r'<title>[^<]*</title>', '<title>DuskDex</title>', head)
flag = '<script>window.DUSKDEX_PREVIEW = true; document.documentElement.setAttribute("lang", "pt-BR");</script>'
(out / 'index.html').write_text(head.strip() + '\n' + flag + '\n' + body.strip() + '\n', encoding='utf-8')
# A hospedagem da prévia não serve .gz: publica o catálogo descomprimido (o app lê .json quando DUSKDEX_PREVIEW).
import gzip
for gz in list(out.rglob('*.json.gz')):
    gz.with_suffix('').write_bytes(gzip.decompress(gz.read_bytes()))
    gz.unlink()
print(f'{sum(1 for _ in out.rglob("*") if _.is_file())} arquivos em {out}')
