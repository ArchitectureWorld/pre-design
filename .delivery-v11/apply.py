"""Apply the exact three reviewed Pre Skill edits, never guessed source."""
import hashlib
import json
from pathlib import Path
root = Path.cwd().resolve()
records = json.loads((root / '.delivery-v11/changes.json').read_text(encoding='utf-8'))
assert {r['path'] for r in records} == {'HANDOFF-2026-09-07.md', 'src/prompts/report-design-skill.ts', 'tests/report-design-skill.spec.ts'}
assert len(records) == 3
prepared = []
for row in records:
    target = root / row['path']
    assert not target.is_symlink() and root in target.resolve().parents
    original = target.read_text(encoding='utf-8')
    assert hashlib.sha256(original.encode()).hexdigest() == row['before'], row['path']
    result = original
    for start, end, replacement in reversed(row['edits']):
        assert 0 <= start <= end <= len(original)
        result = result[:start] + replacement + result[end:]
    assert hashlib.sha256(result.encode()).hexdigest() == row['after'], row['path']
    prepared.append((target, result))
for target, result in prepared:
    target.write_text(result, encoding='utf-8', newline='\n')
print('PRE_SKILL_DELTA_EXACT files=3')
