import type { PlanningManuscriptPage, PlanningManuscriptSource } from './manuscript/types.ts'
import type { ReportAcceptanceFinding } from './delivery-contract.ts'

/** Recompute declared scenarios and reject unsupported numeric claims, without evaluating code. */
export function inspectReportQuantities(pages: readonly PlanningManuscriptPage[], sources: readonly PlanningManuscriptSource[]): ReportAcceptanceFinding[] {
  const findings: ReportAcceptanceFinding[] = []
  const numberPattern = String.raw`-?(?:\d{1,3}(?:[,，]\d{3})+|\d+)(?:\.\d+)?`
  const numeric = (value: string) => Number(value.replace(/[,，]/gu, ''))
  const tokens = (value: string) => [...value.matchAll(new RegExp(numberPattern, 'gu'))].map(m => numeric(m[0]))
  // Exact quotes belong to the already verified, page-cited lineage. Do not
  // admit numbers from file names, hash metadata or unrelated source records.
  const sourceValues = (source: PlanningManuscriptSource) => [source.text, ...source.moduleLineage?.sources.map(row => row.source.quote) ?? []].flatMap(tokens)
  const checkedPages:{page:PlanningManuscriptPage;allowed:Set<number>;valid:Map<string,number>;claims:{path:string;value:number;bound:boolean}[]}[]=[]
  for (const page of pages) {
    const add = (code: string, message: string) => findings.push({ code, pageId: page.id, message })
    const referenced = sources.filter(s => page.sourceRefs.includes(s.id))
    const sourceNumbers = referenced.flatMap(sourceValues), quantities = page.quantities ?? []
    const ids = new Set(quantities.map(q => q.id)), valid = new Map<string, number>(), visiting = new Set<string>()
    const evaluate = (id: string): number => {
      if (valid.has(id)) return valid.get(id)!
      const q = quantities.find(q => q.id === id)
      if (!q || visiting.has(id) || !Number.isFinite(q.value) || !q.label?.trim() || !q.unit?.trim() || !q.rationale?.trim()
        || !Array.isArray(q.sourceRefs) || (q.kind !== 'calculation' && !q.sourceRefs.length)
        || q.sourceRefs.some(ref => !referenced.some(s => s.id === ref))) throw new Error('数量缺少依据或存在循环')
      visiting.add(id)
      if (q.kind === 'source') {
        if (!referenced.filter(s => q.sourceRefs.includes(s.id)).some(s => sourceValues(s).includes(q.value))) throw new Error('来源没有该数值')
      } else if (q.kind === 'calculation') {
        // Every path must terminate at a source-bound factual or assumption
        // input. A derived result needs no independent external observation.
        const values = q.inputIds?.map(evaluate) ?? []
        if (!values.length) throw new Error('计算输入缺失')
        let value: number
        switch (q.operation) {
          case 'sum': value = values.reduce((a, b) => a + b, 0); break
          case 'product': value = values.reduce((a, b) => a * b, 1); break
          case 'difference': if (values.length !== 2) throw new Error('差值需要两个输入'); value = values[0]! - values[1]!; break
          case 'ratio': if (values.length !== 2 || values[1] === 0) throw new Error('比值输入无效'); value = values[0]! / values[1]!; break
          case 'min': value = Math.min(...values); break
          case 'max': value = Math.max(...values); break
          default: throw new Error('计算方法无效')
        }
        if (!Number.isFinite(value) || Math.abs(value - q.value) > 1e-8 * Math.max(1, Math.abs(value))) throw new Error('复算结果不符；单位换算须明示为输入')
      } else if (q.kind !== 'assumption') throw new Error('数值性质无效')
      visiting.delete(id); valid.set(id, q.value); return q.value
    }
    if (ids.size !== quantities.length || quantities.some(q => !q.id?.trim())) add('CALCULATION_INVALID', '数量id缺失或重复。')
    for (const q of quantities) try { evaluate(q.id) } catch (error) { add('CALCULATION_INVALID', `${q.label}：${(error as Error).message}`) }
    const allowed = new Set([...sourceNumbers, ...valid.values()])
    // A displayed formula and its adjacent result are already an authored
    // declaration. Recompute simple same-unit subtotals without changing the
    // manuscript or inventing assumptions. Never evaluate arbitrary text/code.
    const unsigned=numberPattern.replace(/^-\?/u,''),expression=new RegExp(`^${unsigned}(?:[+−-]${unsigned})+$`,'u')
    const scalar=new RegExp(`^(${numberPattern})(?:\\s*(?:CNY|元))?$`,'u')
    const units=new Map<number,Set<string>>()
    for(const q of quantities)if(valid.has(q.id)){
      const set=units.get(q.value)??new Set<string>();set.add(q.unit.trim());units.set(q.value,set)
    }
    const checked=new Set<string>(),rows=page.table?.rows??[]
    for(let round=0;round<rows.length;round++){
      let changed=false
      rows.forEach((row,r)=>row.forEach((cell,c)=>{
        const at=`${r}:${c}`,text=cell.replace(/\s/gu,''),target=scalar.exec(row[c+1]?.trim()??'')
        if(checked.has(at)||!expression.test(text)||!target)return
        const terms=[...text.matchAll(new RegExp(`([+−-]?)(${unsigned})`,'gu'))]
        let common:Set<string>|undefined,total=0
        for(const term of terms){
          const value=numeric(term[2]!),set=units.get(value)
          if(!set)return
          common=common===undefined?new Set(set):new Set([...common].filter(unit=>set.has(unit)))
          total+=(term[1]==='-'||term[1]==='−'?-1:1)*value
        }
        if(!common?.size||!Number.isFinite(total))return
        checked.add(at);const result=numeric(target[1]!)
        if(Math.abs(total-result)>1e-8*Math.max(1,Math.abs(total))){add('CALCULATION_INVALID',`table.rows[${r}][${c+1}]：表内算式复算结果应为${total}，实际为${result}。`);return}
        if(!units.has(result)){units.set(result,common);changed=true}
        allowed.add(result)
      }))
      if(!changed)break
    }
    // A native scenario may declare its annual aggregate and describe the
    // per-batch breakdown in its rationale. Verify the matching table formula
    // instead of inventing or requiring a second copy of that same assumption.
    const productExpression=new RegExp(`^${unsigned}(?:[×*]${unsigned})+$`,'u')
    rows.forEach((row,r)=>row.forEach((cell,c)=>{
      const expression=cell.replace(/\s/gu,''),target=scalar.exec(row[c+1]?.trim()??'')
      if(!productExpression.test(expression)||!target)return
      const factors=tokens(expression),result=numeric(target[1]!),q=quantities.find(q=>q.kind==='assumption'&&valid.has(q.id)&&q.label.trim()===row[0]?.trim()&&q.value===result)
      if(!q||factors.filter(value=>!allowed.has(value)).length!==1)return
      const declared=tokens(q.rationale).slice(0,factors.length)
      if(!q.rationale.includes('×')||declared.length!==factors.length||declared.some((v,i)=>v!==factors[i]))return
      const recomputed=factors.reduce((a,b)=>a*b,1)
      if(!Number.isFinite(recomputed)||Math.abs(recomputed-result)>1e-8*Math.max(1,Math.abs(result))){add('CALCULATION_INVALID',`table.rows[${r}][${c}]：情景拆分与已声明总额不符。`);return}
      factors.forEach(value=>allowed.add(value))
    }))
    const prose = [['title',page.title],['claim',page.claim],...page.body.map((text,i)=>[`body[${i}]`,text]),...Object.entries(page.product ?? {}).map(([key,text])=>[`product.${key}`,text])] as const
    const pattern = new RegExp(`(${numberPattern})\\s*(亿元|万元|元|万人|人次|人|亩|公顷|平方米|平方公里|公里|千米|米|小时|分钟|天|年|%|％|㎡|km|m²)`, 'giu')
    const terrainDisplay=(text:string,match:RegExpMatchArray)=>{
      const prefix=text.slice(0,match.index).split(/[。；;\n]/u).at(-1)??'',digits=match[1]!.split('.')[1]?.length??0
      if(!['%','％'].includes(match[2]!)||digits>12||!/水域比例\s*约\s*$/u.test(prefix))return false
      const cell=[...prefix.matchAll(/\b([A-Z]\d+)\b/gu)].at(-1)?.[1]
      return !!cell&&referenced.some(source=>{
        if(source.objectId!=='terrain'||source.fieldPath!=='terrain.cells.'+cell)return false
        try{const data=JSON.parse(source.text);return data.id===cell&&typeof data.waterFraction==='number'&&data.waterFraction>=0&&data.waterFraction<=1&&Number((100*data.waterFraction).toFixed(digits))===numeric(match[1]!)}catch{return false}
      })
    }
    const claims = prose.flatMap(([path,text])=>[...text!.matchAll(pattern)].map(m=>({path,value:numeric(m[1]!),bound:terrainDisplay(text!,m)})))
    const table = page.table?.rows.flatMap((row,r) => row.flatMap((cell,c) => tokens(cell).map(value=>({path:`table.rows[${r}][${c}]`,value,bound:false})))) ?? []
    checkedPages.push({page,allowed,valid,claims:[...claims,...table]})
  }
  for(const current of checkedPages){
    const {page,allowed}=current
    // Multi-product financial summaries explicitly link the detailed scenarios.
    // Reuse only derived quantities whose complete local input graph passed.
    if(page.kind==='financial'&&!page.quantities?.length&&(page.productRefs?.length??0)>1){
      for(const origin of checkedPages){
        if(origin.page.id===page.id||origin.page.kind!=='financial'||!origin.page.productRefs?.length
          ||!origin.page.productRefs.every(ref=>page.productRefs!.includes(ref))
          ||findings.some(f=>f.pageId===origin.page.id&&f.code==='CALCULATION_INVALID'))continue
        for(const q of origin.page.quantities??[])if(q.kind==='calculation'&&origin.valid.has(q.id))allowed.add(q.value)
      }
    }
    const unbound=current.claims.filter(n=>!n.bound&&!allowed.has(n.value))
    if(unbound.length)findings.push({code:'NUMBER_UNBOUND',pageId:page.id,message:'数值未绑定本页来源原文、明确假设或可复算公式：'+unbound.map(n=>`${n.path} = ${n.value}`).join('；')+'。请补全对应依据，勿以删数值替代方案。'})
  }
  return findings
}
