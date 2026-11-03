import assert from 'node:assert/strict'
import {buildPlanningChapterPrompt} from '../../src/report/manuscript/prompts.ts'
const common=Array.from({length:160},(_,i)=>`条件${i}：${'保留完整出处、场地条件与假设边界，不将方案写成现状。'.repeat(12)}`)
const sources=Array.from({length:100},(_,i)=>{
 const basisParts=['proposal',...common,`对象${i}的独有依据`]
 return {id:`source-${i}`,objectId:'PG04',fieldPath:`data.products[${i}]`,text:`拟议产品${i}`,
  basis:basisParts.join('；'),basisParts,evidenceIds:[],
  moduleLineage:{itemId:'5.01',claimClass:'proposal',limitations:common}}
})
const prompt=buildPlanningChapterPrompt({projectId:'memory-check',projectName:'完整依据检查',revision:1} as never,'products',sources as never)
assert(prompt.length<120000)
assert(prompt.includes('source-99'))
console.log(JSON.stringify({sources:sources.length,promptChars:prompt.length,peakRssKb:process.resourceUsage().maxRSS}))
