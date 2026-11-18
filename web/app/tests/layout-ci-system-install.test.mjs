import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = new URL('../../../scripts/layout-library/ci-system-install.sh', import.meta.url).pathname;
async function run(t, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ci-system-install-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls');
  const commands = {
    timeout: 'echo "timeout $*" >> "$CALL_LOG"\nshift\nduration=$1; shift\nif [[ "$duration" == "${FAKE_TIMEOUT:-}" ]]; then exit 124; fi\nexec "$@"',
    sudo: 'exec "$@"',
    'apt-get': 'echo "apt-get $*" >> "$CALL_LOG"\nif [[ " $* " == *" ${FAKE_FAIL:-never} "* ]]; then exit 100; fi',
    'fc-cache': 'echo "fc-cache $*" >> "$CALL_LOG"',
    'fc-match': 'echo "fc-match $*" >> "$CALL_LOG"',
    pdftotext: 'exit 0',
  };
  for (const [name, body] of Object.entries(commands)) await writeFile(join(dir, name), '#!/bin/bash\nset -eu\n' + body + '\n', { mode: 0o755 });
  const result = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: log, ...env } });
  return { ...result, log: await readFile(log, 'utf8').catch(() => '') };
}
test('system dependencies retain packages and bound diagnostic update/install/cache in order', async t => {
  const r = await run(t); assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /timeout --kill-after=15s 180s sudo apt-get .*update/);
  assert.match(r.log, /timeout --kill-after=15s 480s sudo apt-get .*install/);
  assert.match(r.log, /timeout --kill-after=15s 60s fc-cache -f/);
  for (const option of ['Acquire::http::Timeout=30', 'Acquire::https::Timeout=30', 'Acquire::Retries=2', 'DPkg::Lock::Timeout=30', 'APT::Update::Error-Mode=any']) assert.ok(r.log.includes(option), option);
  assert.ok(r.log.includes('poppler-utils fonts-noto-cjk libreoffice-impress libreoffice-writer python3'));
  assert.ok(!r.log.includes('-qq'));
  assert.ok(r.log.indexOf('update') < r.log.indexOf('install'));
  assert.ok(r.log.indexOf('install') < r.log.indexOf('fc-cache'));
});
for (const [name, env, status, absent] of [
  ['update timeout', { FAKE_TIMEOUT: '180s' }, 124, /install|fc-cache/],
  ['update nonzero', { FAKE_FAIL: 'update' }, 100, /install|fc-cache/],
  ['install timeout', { FAKE_TIMEOUT: '480s' }, 124, /fc-cache/],
  ['install nonzero', { FAKE_FAIL: 'install' }, 100, /fc-cache/],
  ['font cache timeout', { FAKE_TIMEOUT: '60s' }, 124, /fc-match/],
]) test(`${name} fails closed without later commands`, async t => {
  const r = await run(t, env); assert.equal(r.status, status, r.stderr); assert.doesNotMatch(r.log, absent);
});
