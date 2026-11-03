/** One-time verified source transport; scoped to the owner-requested v2.1.0 branch. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { brotliDecompressSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
const root=process.cwd(), dir=resolve(root,'scripts/.pre-v210-m2-transfer')
const sha=b=>createHash('sha256').update(b).digest('hex')
const expectedPaths=[".github/workflows/pre-v2.1.0.yml", "HANDOFF.md", "README.md", "docs/development/v2.1.0-progress.md", "docs/pre-v2.1.0-handoff.md", "docs/pre-v2.1.0-milestone2-handoff.md", "docs/superpowers/plans/2026-09-24-pre-v210-regional-od.md", "examples/research/regional-od.request.json", "package.json", "research/planning-v1.2/README.md", "research/planning-v1.2/catalog-lock.json", "scripts/build-research-regional-demo.ts", "scripts/verify-regional-audit.ts", "scripts/verify-research-v210.mjs", "src/commands/register.ts", "src/index.ts", "src/research-v2/command.ts", "src/research-v2/index.ts", "src/research-v2/regional-bundle.ts", "src/research-v2/regional-command.ts", "src/research-v2/regional-od.ts", "src/research-v2/regional-render.ts", "src/research-v2/regional-schema.ts", "src/research-v2/run-store.ts", "src/research-v2/specification.ts", "tests/built-package.spec.ts", "tests/commands.spec.ts", "tests/helpers/regional-od-fixture.ts", "tests/host-apply.spec.ts", "tests/research-v210-audit-bundle.spec.ts", "tests/research-v210-od-command.spec.ts", "tests/research-v210-regional-od.spec.ts", "tests/research-v210-run-store.spec.ts", "tests/research-v210-specification.spec.ts"]
const fail=code=>{throw new Error(code)}
execFileSync('git',['merge-base','--is-ancestor','c2d7f7e6e4854a4393c6c8dad65cbd1714bcfeae','HEAD'])
function unpack(prefix,count,digest,rawDigest,maxOutputLength){
  const encoded=Array.from({length:count},(_,i)=>readFileSync(resolve(dir,`${prefix}-${String(i).padStart(2,'0')}.b64`),'utf8')).join('')
  if(!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded))fail('TRANSFER_ENCODING_INVALID')
  const compressed=Buffer.from(encoded,'base64')
  if(compressed.toString('base64')!==encoded||sha(compressed)!==digest)fail('TRANSFER_HASH_MISMATCH')
  const raw=brotliDecompressSync(compressed,{maxOutputLength})
  if(sha(raw)!==rawDigest)fail('TRANSFER_RAW_HASH_MISMATCH')
  return {raw,compressed}
}
const payload=unpack('edits',5,'9e5131d3384f6076f43d802c295fc6074da3dc0df3ba2b4d6f43911ff5739d9d','3bdea4950f15c46e277f4d809d5b6d2511b5548bfa95b6bea3f6b5960b9e3150',512*1024)
const doc=JSON.parse(payload.raw.toString('utf8'))
if(doc.schemaVersion!=='pre-v210-m2-transfer.v1'||!Array.isArray(doc.files)||doc.files.length!==expectedPaths.length)fail('TRANSFER_SCHEMA_INVALID')
if(JSON.stringify(doc.files.map(f=>f.path).sort())!==JSON.stringify(expectedPaths))fail('TRANSFER_PATH_SET_MISMATCH')
function guard(path){
  if(typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'))fail('TRANSFER_PATH_INVALID')
  const target=resolve(root,path)
  if(relative(root,target).startsWith('..'))fail('TRANSFER_PATH_ESCAPE')
  let current=root
  for(const part of path.split('/')){current=resolve(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())fail('TRANSFER_SYMLINK')}
  return target
}
const writes=[]
for(const file of doc.files){
 const target=guard(file.path), old=existsSync(target)?readFileSync(target):null
 if((old===null?null:sha(old))!==file.baseSha256)fail('TRANSFER_BASE_CHANGED:'+file.path)
 let text
 if(file.baseSha256===null){if(typeof file.content!=='string'||file.edits!==undefined)fail('TRANSFER_CONTENT_INVALID');text=file.content}
 else{
  if(!Array.isArray(file.edits)||file.content!==undefined)fail('TRANSFER_EDITS_INVALID')
  const lines=old.toString('utf8').match(/[^\n]*\n|[^\n]+$/gu)??[]
  let end=0
  for(const e of file.edits){
    if(!Number.isInteger(e.start)||!Number.isInteger(e.deleteCount)||e.start<end||e.deleteCount<0||e.start+e.deleteCount>lines.length||!Array.isArray(e.insert)||e.insert.some(s=>typeof s!=='string'))fail('TRANSFER_EDIT_INVALID')
    end=e.start+e.deleteCount
  }
  for(const e of [...file.edits].reverse())lines.splice(e.start,e.deleteCount,...e.insert)
  text=lines.join('')
 }
 const body=Buffer.from(text,'utf8');if(sha(body)!==file.sha256)fail('TRANSFER_OUTPUT_MISMATCH:'+file.path)
 writes.push({target,body})
}
const source=unpack('spec',14,'eb2811de023245241493335cbfcd137964049c5a645c732f1f4d23e915e992ca','1ad0d7b0a2b52a84515cd97ab313c5596c0da02bea6175eaf4390d39d99d2a08',2*1024*1024)
const sourcePath='research/planning-v1.2/unified-data.json.br', sourceTarget=guard(sourcePath)
if(existsSync(sourceTarget))fail('TRANSFER_SOURCE_ALREADY_EXISTS')
writes.push({target:sourceTarget,body:source.compressed})
for(const w of writes){mkdirSync(dirname(w.target),{recursive:true});writeFileSync(w.target,w.body)}
writeFileSync(resolve(dir,'final-paths.json'),JSON.stringify([...expectedPaths,sourcePath]))
console.log(JSON.stringify({status:'VERIFIED_TRANSFER_APPLIED',files:writes.length,sourceSha256:sha(source.raw)}))
