import {it,expect} from 'vitest'
import {existsSync} from 'node:fs'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
const flags={industryPlanning:true,existingBuildings:true,externalPartners:true,marketing:true}
const snapshot={corpus:{documents:[{path:'原始资料/brief.txt',text:'trusted',contentHash:hash('trusted'),byteLength:7}],limitations:[],fingerprint:'legacy'},sourceValues:[],flags,taskBrief:'冻结任务'}
const doc=(key:string)=>({path:'research/runs/RUN-new/source.json',text:'new source',contentHash:hash('new source'),byteLength:10,provenance:{queryKeys:[key],sourceUri:'https://example.gov.cn/source',rawHash:hash('new source'),retrievedAt:'2026-10-08',claimClass:'source_conclusion'}})
async function api(){expect(existsSync(new URL('../src/research-v2/module-input-dependencies.ts',import.meta.url)),'必须有可回放输入证明').toBe(true);return import('../src/research-v2/module-input-dependencies.ts')}
it('3.04新增来源保持1.01完整实际输入指纹',async()=>{const {moduleInputFingerprint:f}=await api();expect(f('1.01',snapshot,[])).toBe(f('1.01',{...snapshot,corpus:{...snapshot.corpus,documents:[...snapshot.corpus.documents,doc('3.04:2')],fingerprint:'new'}},[]))})
it('自身来源新增及边界变更必须失效',async()=>{const {moduleInputFingerprint:f}=await api();expect(f('1.01',snapshot,[])).not.toBe(f('1.01',{...snapshot,corpus:{...snapshot.corpus,documents:[...snapshot.corpus.documents,doc('1.01:0')]}},[]));expect(f('1.01',snapshot,[])).not.toBe(f('1.01',{...snapshot,taskBrief:'新的研究边界'},[]))})
it('未知查询归属不能证明无影响',async()=>{const {moduleInputFingerprint:f}=await api();expect(()=>f('1.01',{...snapshot,corpus:{...snapshot.corpus,documents:[...snapshot.corpus.documents,doc('')] }},[])).toThrow('MODULE_INPUT_COVERAGE_UNKNOWN')})
it('上游端口改变必须使下游失效',async()=>{const {moduleInputFingerprint:f}=await api();expect(f('3.04',snapshot,[{resultHash:'old'}] as never)).not.toBe(f('3.04',snapshot,[{resultHash:'new'}] as never))})
