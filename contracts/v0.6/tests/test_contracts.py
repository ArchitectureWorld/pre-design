from pathlib import Path
import collections, json, sys
from jsonschema import Draft202012Validator, FormatChecker
ROOT=Path(__file__).resolve().parents[1]
R=[]
def load(p): return json.loads((ROOT/p).read_text('utf-8'))
def check(name,ok,detail=''):
 R.append({'name':name,'passed':bool(ok),'detail':detail})
 if not ok: print('FAIL',name,detail)
S=load('state/state-schemas.bundle.json')['schemas']; T=load('tools/tools.bundle.json')['tools']; W=load('workflows/workflows.bundle.json')['workflows']; G=load('gates/gates.bundle.json')['gates']; P=load('governance/role-permission-matrix.json'); D=load('governance/dependency-graph.json'); RP=load('governance/revision-policy.json'); GC=load('tests/golden-cases.json')['cases']; A=load('tests/acceptance-scenarios.json')['tests']; MT=load('model-tools/model-tools.bundle.json')['model_facing_tools']; PM=load('plugin.manifest.json')
# Schemas and fixtures
for oid,s in S.items():
 try: Draft202012Validator.check_schema(s); check('schema-meta:'+oid,True)
 except Exception as e: check('schema-meta:'+oid,False,str(e)); continue
 v=Draft202012Validator(s,format_checker=FormatChecker()); good=load('tests/fixtures/valid/'+oid+'.json'); bad=load('tests/fixtures/invalid/'+oid+'_missing_required.json')
 e=list(v.iter_errors(good)); check('schema-positive:'+oid,not e,e[0].message if e else '')
 e=list(v.iter_errors(bad)); check('schema-negative:'+oid,bool(e),'invalid fixture passed' if not e else '')
# Atomic tools
for tid,c in T.items():
 req={'contract_version','tool_id','execution','permissions','input_schema','output_schema','error_contract','observability','state_effect'}
 check('tool-structure:'+tid,req.issubset(c),str(req-set(c)))
 for side in ['input','output']:
  s=c[side+'_schema']; Draft202012Validator.check_schema(s); e=list(Draft202012Validator(s,format_checker=FormatChecker()).iter_errors(c['examples'][side])); check('tool-'+side+':'+tid,not e,e[0].message if e else '')
 check('tool-no-direct-write:'+tid,c['state_effect']['direct_project_state_write'] is False)
 check('tool-no-gate-approval:'+tid,'approve_gate' in c['permissions']['forbidden'])
# Model-facing tools
check('model-tool-count',set(MT)=={'preplanning_get_context','preplanning_apply_commands'},str(sorted(MT)))
check('model-tool-atomic-internal',set(PM['internal_atomic_tools'])==set(T) and not (set(PM['model_tool_surface']) & set(T)))
for name,c in MT.items():
 for side in ['input','output']:
  s=c[side+'_schema']; Draft202012Validator.check_schema(s); e=list(Draft202012Validator(s,format_checker=FormatChecker()).iter_errors(c['examples'][side])); check('model-tool-'+side+':'+name,not e,e[0].message if e else '')
 check('model-tool-no-direct-write:'+name,c['permissions'].get('direct_state_write') is False)
# Workflows
O=set(S); TT=set(T)
for wid,w in W.items():
 check('wf-id:'+wid,wid==w['workflow_id']); check('wf-write:'+wid,w['writes'] in O,w['writes']); check('wf-tools:'+wid,set(w['atomic_tools']).issubset(TT)); check('wf-no-direct-write:'+wid,w['proposal_contract']['direct_state_write'] is False)
 check('wf-agent-no-approve:'+wid,all('agent' not in t['roles'] for t in w['transitions'] if t['command']=='approve'))
 graph=collections.defaultdict(set)
 for t in w['transitions']:
  srcs=t['from'] if isinstance(t['from'],list) else [t['from']]
  for src in srcs: graph[src].add(t['to'])
 seen={w['initial_state']}; stack=[w['initial_state']]
 while stack:
  x=stack.pop()
  for y in graph[x]:
   if y not in seen: seen.add(y); stack.append(y)
 check('wf-all-states-reachable:'+wid,set(w['states']).issubset(seen),str(sorted(set(w['states'])-seen)))
 check('wf-provisional-guarded:'+wid,any(t['to']=='COMMITTED_PROVISIONAL' and 'automation_allows_provisional_commit' in t['guards'] for t in w['transitions']))
 if w['review_policy']['human_review_mandatory']:
  check('wf-review-required:'+wid,w['review_policy']['provisional_auto_commit_allowed'] is False)
# Gate + permission
check('permission-agent-no-gate',not P['matrix']['agent']['approve_gate']); check('permission-service-no-gate',not P['matrix']['system_service']['approve_gate']); check('permission-only-authority-waives',P['matrix']['constraint_authority']['waive_hard_constraint'] and not P['matrix']['project_owner']['waive_hard_constraint'])
for gid,g in G.items():
 check('gate-objects:'+gid,set(g['required_objects']).issubset(O)); check('gate-human:'+gid,g['approval']['role']=='decision_owner' and not g['approval']['agent_allowed'] and not g['approval']['system_service_allowed']); check('gate-conditional:'+gid,'only_non_blocking_gaps' in next(t for t in g['transitions'] if t['command']=='approve_gate_with_conditions')['guards'])
# DAG + revision
nodes={n['object_id'] for n in D['nodes']}; indeg={n:0 for n in nodes}; graph=collections.defaultdict(set)
for e in D['edges']:
 if e['to'] not in graph[e['from']]: graph[e['from']].add(e['to']); indeg[e['to']]+=1
q=collections.deque([n for n,v in indeg.items() if v==0]); count=0
while q:
 x=q.popleft(); count+=1
 for y in graph[x]:
  indeg[y]-=1
  if indeg[y]==0:q.append(y)
check('dependency-57',len(nodes)==57); check('dependency-acyclic',count==57); check('revision-history',RP['minimal_rollback']['preserve_all_history'] is True); check('revision-minimal',RP['minimal_rollback']['reopen_only_transitive_descendants'] is True)
# Semantic contract rules
check('sem-02-baseline',all(x in S for x in ['BL01','BL02','BL03','BL04','BL05','BL06','BL07','BL08']))
check('sem-DG05-conditions',S['DG05']['properties']['data']['properties']['required_conditions']['minItems']==1); check('sem-DG05-invalidations',S['DG05']['properties']['data']['properties']['invalidation_signals']['minItems']==1)
check('sem-OB05-hypothesis','confirmed' not in S['OB05']['properties']['data']['properties']['status']['enum']); check('sem-OP02-three',S['OP02']['properties']['data']['properties']['options']['minItems']==3); check('sem-OP06-veto','veto_results' in S['OP06']['properties']['data']['required'])
check('sem-PG03-reproducible',all(x in S['PG03']['properties']['data']['required'] for x in ['formulas','parameter_sources','ranges'])); check('sem-SP03-five',all(x in S['SP03']['properties']['data']['required'] for x in ['heritage_value','safety','use_fit','ownership','cost_range'])); check('sem-IM06-stress',S['IM06']['properties']['data']['properties']['stress_results']['minItems']==3)
# Executable golden bundles
RS=load('common/revision-request.schema.json')
for case in GC:
 ok=True; ds=[]
 for o in case['objects']:
  e=list(Draft202012Validator(S[o['object_id']],format_checker=FormatChecker()).iter_errors(o))
  if e: ok=False; ds.append(o['object_id']+': '+e[0].message)
 check('golden:'+case['case_id'],ok,'; '.join(ds))
 if 'revision_request' in case:
  e=list(Draft202012Validator(RS,format_checker=FormatChecker()).iter_errors(case['revision_request'])); check('golden-revision:'+case['case_id'],not e,e[0].message if e else '')
# Rule-level acceptance suite
ids=[x['id'] for x in A]; check('acceptance-count-20',len(A)==20); check('acceptance-id-unique',len(ids)==len(set(ids)))
coverage=collections.Counter()
for a in A:
 check('acceptance-structure:'+a['id'],all(a.get(k) for k in ['chapters','title','given','when','expect','forbid']))
 for ch in a['chapters']:
  if ch in [f'{i:02d}' for i in range(1,9)]: coverage[ch]+=1
for ch in [f'{i:02d}' for i in range(1,9)]: check('acceptance-coverage:'+ch,coverage[ch]>=2,str(coverage[ch]))
# Plugin identity / DSH-native boundary
check('plugin-id',PM.get('plugin_id')=='preplanning-agent'); check('plugin-repo',PM.get('repository_name')=='dsh-preplanning-agent'); check('plugin-package',PM.get('npm_package')=='@architectureworld/dsh-preplanning-agent'); check('plugin-model-surface',PM.get('model_tool_surface')==['preplanning_get_context','preplanning_apply_commands'])
summary={'generated_at':'2026-08-27T05:53:11+00:00','total':len(R),'passed':sum(x['passed'] for x in R),'failed':sum(not x['passed'] for x in R),'results':R}; (ROOT/'qa/contract-test-results.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8'); print(json.dumps({k:summary[k] for k in ['total','passed','failed']},ensure_ascii=False)); sys.exit(1 if summary['failed'] else 0)
