"""One-time transport of previously tested UTF-8 edits; never execute supplied data."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=root, text=True).strip()
# Actions normally uses a detached exact commit; publication is guarded by the workflow.
if branch and branch != 'v2.1.0':
    raise SystemExit('Refusing to modify another branch')
edits = json.loads((root / 'scripts/pre-v210-integration.json').read_text())
prepared = []
seen = set()
for name, old_hash, new_hash, hunks in edits:
    p = root / name
    if name in seen or p.is_symlink() or not p.resolve().is_relative_to(root):
        raise SystemExit('Unsafe or duplicate edit path')
    seen.add(name)
    old = p.read_bytes()
    if hashlib.sha256(old).hexdigest() != old_hash:
        raise SystemExit('BASE_FILE_CHANGED: ' + name)
    lines = old.decode('utf-8').splitlines(keepends=True)
    last = 0
    for start, end, replacement in hunks:
        if not isinstance(start, int) or not isinstance(end, int) or not last <= start <= end <= len(lines) or not isinstance(replacement, str):
            raise SystemExit('INVALID_HUNK: ' + name)
        last = end
    for start, end, replacement in reversed(hunks):
        lines[start:end] = [replacement]
    new = ''.join(lines).encode('utf-8')
    if hashlib.sha256(new).hexdigest() != new_hash:
        raise SystemExit('TARGET_FILE_MISMATCH: ' + name)
    prepared.append((p, new))
if len(prepared) != 16:
    raise SystemExit('Unexpected integration scope')
for p, data in prepared:
    p.write_bytes(data)
    print('VERIFIED_EDIT', p.relative_to(root))
