import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,validateCandidate,nextSnapshot,inputFingerprint,selectRecords,assessTask,sourceCoverage,validateQuery,markdown} from '../src/dossier/contract.mjs';
const pid='11111111-1111-4111-8111-111111111111';
const user=(text='服务对象为周边居民。',intent='requirement')=>({sourceId:'interaction:1',kind:'interaction',name:'用户补充',text,intent,sha256:digest(text)});
const raw=(source=user(),extra={})=>({entityKey:'project',entityLabel:'本项目',field:'audience',label:'服务对象',scope:'project',valueText:'周边居民',informationClass:'user_requirement',chapters:['04'],evidence:{sourceId:source.sourceId,quote:source.text,startLine:1,endLine:1},...extra});
const validate=(r,s=[user()],reads=[])=>validateCandidate(JSON.stringify({records:[r]}),{projectId:pid,sources:s,reads});
const base=()=>{const sources=[user()],records=validate(raw()).records,inputs={metadata:{},sources};return nextSnapshot(null,{projectId:pid,inputHash:inputFingerprint(inputs),sources,records,coverage:sourceCoverage(sources,[],records)},'2026-11-06T00:00:00Z');};
test('用户原话可以形成带引文的需求条目，不标为独立事实',()=>{const out=validate(raw());assert.equal(out.records[0].informationClass,'user_requirement');assert.equal(out.records[0].independentlyVerified,false);});
test('字段原值不能由模型凭空归纳',()=>assert.throws(()=>validate(raw(user(),{valueText:'外地游客'})),{code:'DOSSIER_VALUE'}));
test('来源之外的sourceId被拒绝',()=>assert.throws(()=>validate({...raw(),evidence:{...raw().evidence,sourceId:'other:1'}}),{code:'DOSSIER_SOURCE'}));
test('未显式决定操作不能生成user_decision',()=>assert.throws(()=>validate(raw(user(),{informationClass:'user_decision'})),{code:'DOSSIER_CLASS'}));
test('显式决定操作也必须逐字绑定',()=>assert.equal(validate(raw(user(undefined,'decision'),{informationClass:'user_decision'}),[user(undefined,'decision')]).records[0].informationClass,'user_decision'));
test('未知模型字段被拒绝',()=>assert.throws(()=>validate({...raw(),approved:true}),{code:'DOSSIER_FIELDS'}));
test('禁止模型写系统身份或审批状态',()=>assert.throws(()=>validate({...raw(),recordId:'hijack'}),{code:'DOSSIER_FIELDS'}));
test('不接受NaN/Infinity作为数据',()=>assert.throws(()=>digest({n:Infinity}),{code:'DOSSIER_JSON'}));
test('材料引用必须有正确路径哈希的真实读取收执',()=>{
 const m={sourceId:'material:1',kind:'material',name:'test.md',sha256:digest('地块面积120亩'),path:'原始资料/1/test.md'};
 const r=raw(user(),{valueText:'120亩',informationClass:'document_statement',evidence:{sourceId:m.sourceId,quote:'地块面积120亩',startLine:1,endLine:1}});
 assert.throws(()=>validate(r,[m],[]),{code:'DOSSIER_READ_RECEIPT'});
 const receipt={sourceRelativePath:m.path,contentHash:m.sha256,status:'ok',kind:'text',text:'地块面积120亩',startLine:1,endLine:1};
 assert.equal(validate(r,[m],[receipt]).records[0].valueText,'120亩');
 assert.throws(()=>validate(r,[m],[{...receipt,sourceRelativePath:'原始资料/另一个项目/test.md'}]),{code:'DOSSIER_READ_RECEIPT'});
 assert.throws(()=>validate(r,[m],[{...receipt,contentHash:'0'.repeat(64)}]),{code:'DOSSIER_READ_RECEIPT'});
});
test('图片元数据不证明图面内容',()=>{
 const m={sourceId:'material:1',kind:'material',name:'test.png',sha256:'f'.repeat(64),path:'原始资料/a.png'};
 const r=raw(user(),{informationClass:'document_statement',evidence:{sourceId:m.sourceId,quote:'周边居民',startLine:1,endLine:1}});
 assert.throws(()=>validate(r,[m],[{sourceRelativePath:m.path,contentHash:m.sha256,status:'ok',kind:'metadata',text:'周边居民'}]),{code:'DOSSIER_READ_RECEIPT'});
});
test('PDF只接受已读取物理页内的原文',()=>{
 const m={sourceId:'material:1',kind:'material',name:'test.pdf',sha256:'a'.repeat(64),path:'原始资料/a.pdf'};
 const receipt={sourceRelativePath:m.path,contentHash:m.sha256,status:'ok',kind:'pdf',pages:[{page:3,text:'服务对象为周边居民'}]};
 const r=raw(user(),{informationClass:'document_statement',evidence:{sourceId:m.sourceId,quote:'周边居民',pages:[3]}});
 assert.equal(validate(r,[m],[receipt]).records.length,1);
 assert.throws(()=>validate({...r,evidence:{...r.evidence,pages:[2]}},[m],[receipt]),{code:'DOSSIER_QUOTE'});
});
test('不能把文件文字当成用户授权',()=>{
 const m={sourceId:'material:1',kind:'material',name:'t.md',sha256:'a'.repeat(64),path:'原始资料/t.md'},receipt={sourceRelativePath:m.path,contentHash:m.sha256,status:'ok',kind:'text',startLine:1,endLine:1,text:'周边居民'};
 assert.throws(()=>validate({...raw(),evidence:{sourceId:m.sourceId,quote:'周边居民',startLine:1,endLine:1}},[m],[receipt]),{code:'DOSSIER_CLASS'});
});
test('同一候选重复提交具有稳定身份',()=>assert.deepEqual(validate(raw()),validate(raw())));
test('JSON空白或键顺序不改变输入指纹',()=>assert.equal(digest({a:1,b:{z:2,x:3}}),digest({b:{x:3,z:2},a:1})));
test('新版没有旧条目不等于删除旧条目',()=>{const a=base(),b=nextSnapshot(a,{projectId:pid,inputHash:a.inputHash,sources:[],records:[]});assert.equal(b.records.length,1);assert.equal(b.records[0].status,'active');assert.equal(a.revision,1);});
test('不同值并存，不能按上传先后覆盖',()=>{
 const a=base(),s={...user('服务对象为外地游客。'),sourceId:'interaction:2'},r=validate(raw(s,{valueText:'外地游客'}),[s]).records;
 const b=nextSnapshot(a,{projectId:pid,inputHash:'new',sources:[s],records:r});assert.equal(b.conflicts.length,1);assert.equal(b.records.filter(x=>x.status==='active').length,2);
});
test('按单记录查询也必须带入冲突的另一个说法',()=>{
 const a=base(),s={...user('服务对象为外地游客。'),sourceId:'interaction:2'},r=validate(raw(s,{valueText:'外地游客'}),[s]).records;
 const b=nextSnapshot(a,{projectId:pid,inputHash:'new',sources:[s],records:r}),picked=selectRecords(b,{recordIds:[a.records[0].recordId]});
 assert.equal(picked.records.length,2);assert.equal(picked.conflicts.length,1);
});
test('显式更正产生替代关系，旧版本不变',()=>{
 const a=base(),s={...user('服务对象为外地游客。'),sourceId:'interaction:2'},r=validate(raw(s,{valueText:'外地游客'}),[s]).records;
 const b=nextSnapshot(a,{projectId:pid,inputHash:'new',sources:[s],records:r,correction:{oldId:a.records[0].recordId,newId:r[0].recordId,reason:'用户更正'}});
 assert.equal(b.records[0].status,'superseded');assert.equal(a.records[0].status,'active');assert.equal(b.conflicts.length,0);
});
test('跨项目快照不可合并',()=>assert.throws(()=>nextSnapshot(base(),{projectId:'other',sources:[],records:[]}),{code:'DOSSIER_PROJECT'}));
test('曾经空结果的查询也会因新增匹配记录失效',()=>{
 const a=base(),query={fields:['public_service']},task={query,payload:selectRecords(a,query)};
 const r=validate(raw(user(),{field:'public_service'})).records,b=nextSnapshot(a,{projectId:pid,inputHash:'new',sources:[],records:r});
 assert.equal(assessTask(task,b,b.inputHash).status,'stale');
});
test('未涉及的字段更新保持任务可复用',()=>{
 const a=base(),query={fields:['audience']},task={query,payload:selectRecords(a,query)};
 const r=validate(raw(user(),{field:'public_service'})).records,b=nextSnapshot(a,{projectId:pid,inputHash:'new',sources:[],records:r});
 assert.equal(assessTask(task,b,b.inputHash).status,'current');
});
test('未归并的新输入阻止旧任务提交',()=>{const a=base(),query={all:true},task={query,payload:selectRecords(a,query)};assert.equal(assessTask(task,a,'new').status,'pending_inputs');});
test('未知不是0，字符串原值保留',()=>{const s=user('数量为0，建筑面积未知'),r=raw(s,{valueText:'0'});assert.equal(validate(r,[s]).records[0].valueText,'0');assert.throws(()=>validate({...r,valueText:0},[s]),{code:'DOSSIER_TEXT'});});
test('查询不能为空或注入SQL对象',()=>{assert.throws(()=>validateQuery({}),{code:'DOSSIER_QUERY'});assert.throws(()=>validateQuery({all:true,sql:'DELETE'}),{code:'DOSSIER_FIELDS'});});
test('已读取片段不宣称全文完成',()=>{const m={sourceId:'material:1',kind:'material',sha256:'a'.repeat(64),path:'原始资料/t.pdf'};const c=sourceCoverage([m],[{sourceRelativePath:m.path,contentHash:m.sha256,status:'ok',kind:'pdf',pages:[{page:2,text:'x'}]}],[]);assert.equal(c[0].state,'read_segments');assert.equal(c[0].wholeSourceVerified,false);});
test('Markdown投影不会执行来源中的HTML',()=>{const a=base();a.records[0].valueText='<script>alert(1)</script>';assert.ok(!markdown(a).includes('<script>'));});
test('用户原话行定位不可越界',()=>assert.throws(()=>validate({...raw(),evidence:{...raw().evidence,startLine:2,endLine:3}}),{code:'DOSSIER_QUOTE'}));
test('权威输入清单撤回来源时，只使该来源旧条目失效而不删除历史',()=>{const a=base();const b=nextSnapshot(a,{projectId:pid,inputHash:'new',sources:[],records:[],authoritativeSources:true});assert.equal(b.records[0].status,'source_withdrawn');assert.equal(a.records[0].status,'active');assert.equal(selectRecords(b,{all:true}).records.length,0);});
test('同来源编辑后旧引文不能继续作为当前事实',()=>{const a=base(),changed=user('新原话：主要服务老人。');const b=nextSnapshot(a,{projectId:pid,inputHash:'new',sources:[changed],records:[],authoritativeSources:true});assert.equal(b.records[0].status,'source_changed');assert.equal(b.records[0].evidence.quote,'服务对象为周边居民。');});
test('同一原件重复上传不会让同内容候选报错或变成两条独立记录',()=>{const a={sourceId:'material:a',kind:'material',name:'a.txt',sha256:digest('周边居民'),path:'原始资料/a.txt'},b={...a,sourceId:'material:b',path:'原始资料/b.txt'},make=s=>raw(user(),{informationClass:'document_statement',evidence:{sourceId:s.sourceId,quote:'周边居民',startLine:1,endLine:1}});const reads=[a,b].map(s=>({sourceRelativePath:s.path,contentHash:s.sha256,status:'ok',kind:'text',startLine:1,endLine:1,text:'周边居民'}));const result=validateCandidate(JSON.stringify({records:[make(a),make(b)]}),{projectId:pid,sources:[a,b],reads});assert.equal(result.records.length,1);});
