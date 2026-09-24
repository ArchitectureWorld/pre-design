import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const repository = process.env.GITHUB_REPOSITORY;
const parent = process.env.GITHUB_SHA;
const token = process.env.GH_TOKEN;
if (repository !== 'ArchitectureWorld/pre-design' || !/^[a-f0-9]{40}$/.test(parent ?? '') || !token) throw new Error('INTEGRATION_CONTEXT_INVALID');
const git = (...args) => execFileSync('git', args, { maxBuffer: 16 * 1024 * 1024 });
const tested = readFileSync('/tmp/pre-v210-m3/TESTED_TREE.txt','utf8').trim();
git('diff','--exit-code');
git('diff','--cached','--check');
if (git('write-tree').toString().trim() !== tested) throw new Error('TESTED_TREE_CHANGED');
async function api(path, method = 'GET', payload) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    method, headers: {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},
    ...(payload === undefined ? {} : {body:JSON.stringify(payload)}), signal:AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`GIT_API_${method}_${response.status}_${path}`);
  return response.json();
}
if ((await api('git/ref/heads/v2.1.0')).object.sha !== parent) throw new Error('BRANCH_ADVANCED');
const staged = new Map(git('ls-files','--stage','-z').toString('utf8').split('\0').filter(Boolean).map(line => {
  const m = /^(\d{6}) ([a-f0-9]{40}) 0\t(.+)$/su.exec(line);
  if (!m) throw new Error('INDEX_ENTRY_INVALID');
  return [m[3], {mode:m[1],sha:m[2]}];
}));
const changes = git('diff','--cached','--name-status','--no-renames','-z').toString('utf8').split('\0').filter(Boolean);
if (changes.length % 2 !== 0) throw new Error('DIFF_RECORD_INVALID');
const entries = [];
for (let i = 0; i < changes.length; i += 2) {
  const [status, path] = [changes[i], changes[i+1]];
  if (!['A','M','D'].includes(status) || path.startsWith('/') || path.split('/').some(p=>p==='..'||p==='')) throw new Error('UNSUPPORTED_CHANGE');
  if (status === 'D') { entries.push({path,mode:'100644',type:'blob',sha:null}); continue; }
  const entry = staged.get(path);
  if (!entry || !['100644','100755'].includes(entry.mode)) throw new Error('INDEX_MODE_INVALID');
  const bytes = git('show',`:${path}`);
  const sha = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
  if (sha !== entry.sha) throw new Error('INDEX_BYTES_MISMATCH');
  const blob = await api('git/blobs','POST',{content:bytes.toString('base64'),encoding:'base64'});
  if (blob.sha !== sha) throw new Error('REMOTE_BLOB_MISMATCH');
  entries.push({path,mode:entry.mode,type:'blob',sha});
}
const base = git('rev-parse',`${parent}^{tree}`).toString().trim();
const tree = await api('git/trees','POST',{base_tree:base,tree:entries});
if (tree.sha !== tested) throw new Error('REMOTE_TESTED_TREE_MISMATCH');
const identity = {name:'github-actions[bot]',email:'41898282+github-actions[bot]@users.noreply.github.com',date:new Date().toISOString()};
const commit = await api('git/commits','POST',{message:'feat(v2.1.0): integrate verified source-bound peer research and regional OD bridge',tree:tested,parents:[parent],author:identity,committer:identity});
if ((await api('git/ref/heads/v2.1.0')).object.sha !== parent) throw new Error('BRANCH_ADVANCED');
await api('git/refs/heads/v2.1.0','PATCH',{sha:commit.sha,force:false});
if ((await api('git/ref/heads/v2.1.0')).object.sha !== commit.sha) throw new Error('BRANCH_VERIFY_FAILED');
writeFileSync('/tmp/pre-v210-m3/COMMIT.txt',`${commit.sha}\n`);
console.log(JSON.stringify({commit:commit.sha,testedTree:tested,changedPaths:entries.length,branch:'v2.1.0'}));
