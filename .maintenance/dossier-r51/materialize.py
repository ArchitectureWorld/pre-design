"""One-time exact source transport. Never accesses deployment configuration."""
import base64, hashlib, json, lzma, os, re, subprocess
from pathlib import Path

ROOT = Path.cwd()
BASE = 'be0591f708ed1ffe6dfd0f968c28293aceda8edb'
PACKED = 'eff22a4db892f16523f532d6e4d9346209cd21750d4c8de139c2b34ead4673f5'
RAW = '606f0b27ddf46a2bb1579371007be30782cbcc426cfa7f8f369255811e7eefe1'
assert subprocess.check_output(['git','rev-parse','HEAD^'],text=True).strip() == BASE, 'Unexpected source baseline'
parts = sorted((ROOT/'.maintenance/dossier-r51').glob('payload-part-*.b64'))
assert len(parts)==5, 'Payload incomplete'
packed = base64.b64decode(''.join(p.read_text().strip() for p in parts), validate=True)
assert hashlib.sha256(packed).hexdigest()==PACKED, 'Packed payload hash mismatch'
raw=lzma.decompress(packed)
assert hashlib.sha256(raw).hexdigest()==RAW, 'Source payload hash mismatch'
bundle=json.loads(raw)
assert bundle['manifest']['baseCommit']==BASE
files=bundle['files']
for item in bundle['manifest']['payloadFiles']:
    assert hashlib.sha256(files[item['path']].encode()).hexdigest()==item['sha256']
for path,content in files.items():
    assert path.startswith(('web/app/src/dossier/','web/app/tests/','scripts/dossier-r5.1/','docs/dossier-r5.1/'))
    assert not Path(path).is_absolute() and '..' not in Path(path).parts
    dst=ROOT/path
    assert dst.resolve().is_relative_to(ROOT.resolve())
    assert not dst.exists(), f'Refusing to overwrite new path: {path}'
    dst.parent.mkdir(parents=True,exist_ok=True)
    dst.write_bytes(content.encode())
    if path.endswith('.sh'):dst.chmod(0o755)
patcher=ROOT/'.maintenance/dossier-r51/patches.mjs'
patcher.write_bytes(bundle['patcher'].encode())
node=r'''
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PATCHERS,PINS} from './.maintenance/dossier-r51/patches.mjs';
for(const [path,fn] of Object.entries(PATCHERS)){
 const raw=await readFile(path);
 const hash=createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
 if(hash!==PINS[path])throw new Error('SOURCE_BASELINE_MISMATCH:'+path);
 await writeFile(path,fn(raw.toString('utf8')));
}
'''
subprocess.run(['node','--input-type=module','-'],input=node,text=True,check=True)
notice='> **R5.1 项目总档已集成（目标机待验收）：** 本地部署先读 [交接说明](docs/dossier-r5.1/DEPLOYMENT_HANDOFF.md)。不要重复运行旧压缩包安装器；本分支源码已接入总档。\n\n'
with (ROOT/'HANDOFF.md').open('r',encoding='utf-8') as f:old=f.read()
(ROOT/'HANDOFF.md').write_text(notice+old,encoding='utf-8')
readme=ROOT/'web/app/README.md'
readme.write_text('> **R5.1：** 已接入项目总档。部署与真实 DSH 验收见 [本地 Agent 交接](../../docs/dossier-r5.1/DEPLOYMENT_HANDOFF.md)；保留以下历史说明及固定入口。\n\n'+readme.read_text(),encoding='utf-8')
manifest=bundle['manifest']
manifest['integratedFiles']=[]
for path in sorted([*files,'web/app/src/server.mjs','web/app/build-prototype.mjs','HANDOFF.md','web/app/README.md']):
    raw=(ROOT/path).read_bytes()
    manifest['integratedFiles'].append({'path':path,'sha256':hashlib.sha256(raw).hexdigest(),'gitBlobSha':hashlib.sha1(f'blob {len(raw)}\0'.encode()+raw).hexdigest()})
manifest['sourceSyncOnly']=True
manifest['deploymentPerformed']=False
manifest['realDshVerified']=False
(ROOT/'docs/dossier-r5.1/SOURCE_MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Materialized',len(files),'new files plus 4 existing integration/documentation files; no deployment performed.')
