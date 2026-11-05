#!/usr/bin/env python3
"""Export all Roma pages to Markdown (with page/block dates) for giving context to AI agents.
Usage: python3 scripts/export-markdown.py [out_dir]   (default: exports/)"""
import json, os, re, sys, glob, datetime, zipfile

src = os.path.expanduser('~/Library/Application Support/RomaNotes/pages')
out = sys.argv[1] if len(sys.argv) > 1 else 'exports'
ENC = re.compile(r'\{\{encrypt:[^}]+\}\}')
d = lambda s: (s or '')[:10]

def stamp(b):
    c, u = d(b.get('createdAt')), d(b.get('updatedAt'))
    if not c: return ''
    return f' _({c})_' if not u or u == c else f' _({c}, editado {u})_'

def md(blocks, ind=0):
    lines = []
    for b in blocks:
        c = b.get('content', '') or ''
        kids = b.get('children') or []
        if not c.strip() and not kids: continue
        c = '[encrypted]' if ENC.search(c) else c.replace('\n', '\n' + '  ' * (ind + 1))
        lines.append('  ' * ind + '- ' + c + stamp(b))
        if kids: lines += md(kids, ind + 1)
    return lines

def span(blocks):
    cs, us, st = [], [], list(blocks)
    while st:
        b = st.pop(); st += b.get('children') or []
        if not (b.get('content') or '').strip(): continue
        if b.get('createdAt'): cs.append(b['createdAt'])
        if b.get('updatedAt') or b.get('createdAt'): us.append(b.get('updatedAt') or b['createdAt'])
    return (min(cs) if cs else None, max(us) if us else None)

pages = []
for f in glob.glob(src + '/*.json'):
    try: p = json.load(open(f))
    except Exception: continue
    body = md(p.get('blocks') or [])
    if not body: continue
    c, u = span(p.get('blocks') or [])
    meta = (f'creada {d(c)}' if c else '') + (f' · editada {d(u)}' if u and d(u) != d(c) else '')
    pages.append((p, meta, '\n'.join(body)))

daily = sorted([x for x in pages if x[0].get('isDaily')], key=lambda x: x[0]['id'], reverse=True)
other = sorted([x for x in pages if not x[0].get('isDaily')], key=lambda x: x[0]['title'].lower())
page_md = lambda p, m, b: f"# {p['title']}\n" + (f'{m}\n' if m else '') + f'\n{b}'
section = lambda items: '\n\n'.join(page_md(*x) for x in items)
head = (f'Roma Research — export de todas las notas, generado {datetime.date.today()}.\n'
        'Sintaxis Roam: [[enlaces a páginas]], #tags, {{[[TODO]]}}/{{[[DONE]]}}, **negrita**. Los bloques cifrados aparecen como [encrypted].\n'
        'Fechas: bajo cada título, cuándo se creó y se editó por última vez la página. Al final de cada bloque, '
        '_(fecha de creación, editado fecha de última edición)_. Los bloques sin fecha no la tienen registrada.\n\n')

os.makedirs(out, exist_ok=True)
with open(f'{out}/roma-todo.md', 'w') as fh:
    fh.write(head + '## NOTAS DIARIAS (más recientes primero)\n\n' + section(daily) + '\n\n## PÁGINAS\n\n' + section(other) + '\n')
with zipfile.ZipFile(f'{out}/roma-paginas-md.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for x in daily + other:
        name = re.sub(r'[<>:"/\\|?*\x00-\x1F]', '_', x[0]['title'])[:150] + '.md'
        z.writestr(('diarias/' if x[0].get('isDaily') else 'paginas/') + name, page_md(*x) + '\n')
print(f'{len(pages)} pages → {out}/roma-todo.md, {out}/roma-paginas-md.zip')
