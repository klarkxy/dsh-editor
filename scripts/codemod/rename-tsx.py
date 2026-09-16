#!/usr/bin/env python3
"""Rename codemod-modified .ts files to .tsx and update import specifiers.

For every target file (from targets.txt) that git reports modified and that
still has a .ts extension: `git mv` it to .tsx, then walk all source files and
rewrite import/export specifiers that resolve to the renamed file.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)

targets = [
    line.strip()
    for line in open('scripts/codemod/targets.txt', encoding='utf-8')
    if line.strip()
]

def modified(path):
    out = subprocess.run(
        ['git', 'status', '--short', '--', path],
        capture_output=True, text=True,
    ).stdout.strip()
    return bool(out)

renamed = {}  # old posix path -> new posix path
for t in targets:
    if not t.endswith('.ts') or not os.path.exists(t) or not modified(t):
        continue
    new = t[:-3] + '.tsx'
    subprocess.run(['git', 'mv', t, new], check=True)
    renamed[t] = new

if not renamed:
    print('nothing to rename')
    sys.exit(0)

# Collect every source file that may reference the renamed modules.
source_files = []
for base in ('packages', 'apps/desktop/src', 'apps/desktop/test', 'e2e', 'scripts'):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', 'lib', 'dist')]
        for name in filenames:
            if name.endswith(('.ts', '.tsx', '.mts', '.cts', '.mjs', '.js')):
                source_files.append(os.path.join(dirpath, name))

spec_re = re.compile(r"""(['"])(\.\.?/[^'"]+)\1""")

def resolve(spec, importer_dir):
    return os.path.normpath(os.path.join(importer_dir, spec)).replace('\\', '/')

renamed_abs = {os.path.normpath(k).replace('\\', '/'): v for k, v in renamed.items()}

changed_files = 0
for sf in source_files:
    rel = os.path.relpath(sf).replace('\\', '/')
    importer_dir = os.path.dirname(rel)
    text = open(sf, encoding='utf-8').read()
    def repl(m):
        quote, spec = m.groups()
        if not spec.endswith('.ts'):
            return m.group(0)
        target = resolve(spec, importer_dir)
        if target in renamed_abs:
            return f'{quote}{spec[:-3]}.tsx{quote}'
        return m.group(0)
    new_text = spec_re.sub(repl, text)
    if new_text != text:
        open(sf, 'w', encoding='utf-8').write(new_text)
        changed_files += 1

print(f'renamed {len(renamed)} files, updated imports in {changed_files} files')
for old, new in sorted(renamed.items()):
    print(f'  {old} -> {new}')
