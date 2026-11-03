import { createHash } from 'node:crypto'
import type { MaterialIntakeInput,MaterialIntakeExtraction } from './material-research-intake.ts'
import type { MaterialEvidenceBinding } from '../materials/research-evidence.ts'
export interface IntakeFragment extends Omit<MaterialEvidenceBinding,'dataPointId'>{fragmentId:string}
export function intakeFragments(input:MaterialIntakeInput,maxChars=22000){
  const fragments:IntakeFragment[]=[]
  const statementFragments: { fragmentId: string; seq: number; quote: string }[] = []
  for (const statement of input.statements) for (const sentence of statement.text.matchAll(/[^。！？]*[。！？]|[^。！？]+$/gu)) {
    for (let offset = 0; offset < sentence[0].length; offset += 1200) {
      const quote = sentence[0].slice(offset, offset + 1200).trim()
      if (quote) statementFragments.push({ seq: statement.seq, quote,
        fragmentId: 'statement-' + createHash('sha256').update(JSON.stringify([statement.sessionId, statement.seq, quote])).digest('hex').slice(0, 20) })
    }
  }
  for(const doc of input.corpus.documents)for(const span of doc.pages??[{page:undefined,text:doc.text??''}]){
    for(const sentence of span.text.matchAll(/[^。！？]*[。！？]|[^。！？]+$/gu)){
      let remaining=sentence[0]
      while(remaining.trim()){
        let count=Math.min(1200,remaining.length)
        if(count<remaining.length){const newline=remaining.lastIndexOf('\n',count);if(newline>count/2)count=newline+1}
        const quote=remaining.slice(0,count).trim();remaining=remaining.slice(count);if(!quote)continue
        const row={path:doc.path,contentHash:doc.contentHash,...(span.page===undefined?{}:{page:span.page}),quote}
        fragments.push({...row,fragmentId:'fragment-'+createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0,20)})
      }
    }
  }
  const query=JSON.stringify(input.workflow).normalize('NFKC').toLowerCase(),terms=new Set<string>()
  for(const phrase of query.match(/[\p{Script=Han}]+|[a-z][a-z-]{2,}/gu)??[]){if(/^[a-z]/u.test(phrase))terms.add(phrase);else for(let i=0;i<phrase.length-1;i++)terms.add(phrase.slice(i,i+2))}
  const ranked=fragments.map((f,i)=>({f,i,score:[...terms].reduce((sum,t)=>sum+Number(f.quote.toLowerCase().includes(t)),0)})).sort((a,b)=>b.score-a.score||a.i-b.i)
  const selected:typeof ranked=[];let used=0
  for(const row of ranked){const bytes=JSON.stringify(row.f).length;if(used+bytes>maxChars)continue;selected.push(row);used+=bytes}
  selected.sort((a,b)=>a.i-b.i)
  return{fragments:selected.map(r=>r.f),statementFragments,selection:{method:'exact-source-fragments.v1',total:fragments.length,selected:selected.length,limitations:selected.length<fragments.length?['本次摘录按工作项筛选完整原文片段；未入选内容不构成不存在的证据。']:[]}}
}
export function resolveIntakeFragments(value:unknown,packet:ReturnType<typeof intakeFragments>):MaterialIntakeExtraction{
  const result=value as MaterialIntakeExtraction,byId=new Map(packet.fragments.map(f=>[f.fragmentId,f]))
  if(!result||!Array.isArray(result.materials)||!Array.isArray(result.statements)||!Array.isArray(result.limitations))throw new Error('MATERIAL_INTAKE_SHAPE')
  const materials=result.materials.map(binding=>{
    const fragmentId=(binding as unknown as {fragmentId?:string}).fragmentId
    if(fragmentId===undefined||fragmentId==='')return binding // Historical raw submissions remain subject to exact quote verification.
    const fragment=byId.get(fragmentId);if(!fragment)throw new Error('MATERIAL_FRAGMENT_UNKNOWN: '+fragmentId)
    if(binding.quote&&binding.quote!==fragment.quote)throw new Error('MATERIAL_FRAGMENT_CONFLICT')
    const{fragmentId:_,...source}=fragment;return{...source,dataPointId:binding.dataPointId}
  })
  const statements = result.statements.map(binding => {
    const fragmentId = (binding as unknown as { fragmentId?: string }).fragmentId
    if (!fragmentId) return binding
    const fragment = packet.statementFragments.find(row => row.fragmentId === fragmentId)
    if (!fragment) throw new Error('MATERIAL_STATEMENT_FRAGMENT_UNKNOWN')
    if (binding.seq !== undefined && binding.seq !== fragment.seq || binding.quote !== undefined && binding.quote !== fragment.quote) throw new Error('MATERIAL_STATEMENT_FRAGMENT_CONFLICT')
    return { dataPointId: binding.dataPointId, seq: fragment.seq, quote: fragment.quote }
  })
  return{...result,materials,statements,limitations:[...result.limitations,...packet.selection.limitations]}
}
