import { expect,it } from 'vitest'
import { intakeFragments,resolveIntakeFragments } from '../src/runtime/material-intake-fragments.ts'
it('selects the exact original user statement without paraphrasing its authorization', () => {
  const packet = intakeFragments({ workflow: { title: '委托范围' }, corpus: { documents: [] }, statements: [{ sessionId: 's', seq: 7, time: '2026-09-27', text: '目前只需要生成html版本。' }] } as never)
  const selected = packet.statementFragments[0]
  expect(resolveIntakeFragments({ materials: [], statements: [{ dataPointId: 'scope', fragmentId: selected.fragmentId }], limitations: [] }, packet).statements)
    .toEqual([{ dataPointId: 'scope', seq: 7, quote: '目前只需要生成html版本。' }])
  expect(() => resolveIntakeFragments({ materials: [], statements: [{ dataPointId: 'scope', fragmentId: selected.fragmentId, quote: '正式建设批准' }], limitations: [] }, packet)).toThrow('MATERIAL_STATEMENT_FRAGMENT_CONFLICT')
})
it('uses a source selector to retain the original mixed place-name spelling exactly',()=>{
  const input:any={workflow:{title:'项目背景',requiredDataPoints:[{title:'项目问题'}]},statements:[],corpus:{documents:[{path:'原始资料/source.pdf',contentHash:'a'.repeat(64),pages:[{page:27,text:'少谭河水库是少潭河生态旅游区的重要组成部分。项目问题是交通配套不足。'}]}]}}
  const packet=intakeFragments(input)
  const f=packet.fragments.find(f=>f.quote.includes('少谭河'))!
  const output=resolveIntakeFragments({materials:[{dataPointId:'context',fragmentId:f.fragmentId}],statements:[],limitations:[]},packet)
  expect(output.materials[0]).toMatchObject({path:'原始资料/source.pdf',page:27,quote:'少谭河水库是少潭河生态旅游区的重要组成部分。'})
  expect(()=>resolveIntakeFragments({materials:[{dataPointId:'context',fragmentId:'invented'}],statements:[],limitations:[]},packet)).toThrow('MATERIAL_FRAGMENT_UNKNOWN')
})
