#!/usr/bin/env python3
"""Monta o pacote de hospedagem (Apache/cPanel, envio por FTP): dist-deploy/duskdex/ e duskdex-hospedagem.zip.

Layout: o site (frontend) fica na raiz da pasta; a API entra por api/index.php (via .htaccess);
backend/ e storage/ ficam bloqueados para acesso direto. Inclui instalar.php (instalação pelo navegador).
"""
import os, shutil, subprocess, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist-deploy' / 'duskdex'
ZIP = ROOT / 'dist-deploy' / 'duskdex-hospedagem.zip'

files = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\n')
if OUT.parent.exists():
    shutil.rmtree(OUT.parent)
OUT.mkdir(parents=True)

def put(src: str, dst: str):
    d = OUT / dst
    d.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / src, d)

for f in filter(None, files):
    if f.startswith('frontend/'):
        put(f, f[len('frontend/'):])
    elif f.startswith('backend/') and not f.startswith('backend/tests/'):
        put(f, f)
    elif f.startswith('deploy/'):
        put(f, f[len('deploy/'):])
    elif f in ('.env.example', 'storage/.htaccess'):
        put(f, f)

# hashes dos scripts inline do index.html para a Content-Security-Policy do .htaccess
import re, hashlib, base64
html = (OUT / 'index.html').read_text(encoding='utf-8')
hashes = ' '.join("'sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() + "'" for s in re.findall(r'<script>(.*?)</script>', html, re.S))
ht = OUT / '.htaccess'
ht.write_text(ht.read_text(encoding='utf-8').replace('__INLINE_SCRIPT_HASHES__', hashes), encoding='utf-8')

for d in ('storage/uploads', 'storage/mail'):
    (OUT / d).mkdir(parents=True, exist_ok=True)

ZIP.unlink(missing_ok=True)
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(OUT.rglob('*')):
        arc = 'duskdex/' + p.relative_to(OUT).as_posix() + ('/' if p.is_dir() else '')
        if p.is_dir():
            z.writestr(zipfile.ZipInfo(arc), '')
        else:
            z.write(p, arc, compress_type=zipfile.ZIP_STORED if p.suffix == '.gz' else zipfile.ZIP_DEFLATED)
print(f'{sum(1 for p in OUT.rglob("*") if p.is_file())} arquivos → {OUT}\n{ZIP} ({ZIP.stat().st_size // 1024} KB)')
