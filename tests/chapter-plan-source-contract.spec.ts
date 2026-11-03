import { expect, it } from 'vitest'
import Ajv from 'ajv'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { chapterPagePlanSourceSchema, createNativeChapterBrief } from '../src/report/chapter-production-contract.ts'

const source={id:'R-7.01-valid',objectId:'research:7.01',fieldPath:'record',text:'运营角色分工',basis:'原生研究',evidenceIds:[]}
const catalog={researchFingerprint:'research',sources:[source],evidence:[],runs:[]}
const request:any={origin:'user-message',scope:'chapter',chapterId:'operation',message:'完成后续章节',requestedAt:'2026-10-22T00:00:00Z',feedback:''}
const plan:any={chapterId:'operation',title:'运营模式',summary:'运营与测算',pages:[{id:'operation-model',title:'角色分工',question:'谁运营',visualIntent:'课程场景',sourceRefs:[source.id],notes:[]}]}
const template:any={type:'object',properties:{pages:{type:'array',items:{type:'object',properties:{sourceRefs:{type:'array',items:{type:'string'}}}}}}}
it('constrains native page references to the current catalog without mutating a shared schema',()=>{
 const before=structuredClone(template),schema=chapterPagePlanSourceSchema(template,catalog.sources)
 expect(()=>assertObjectJsonSchema(schema)).not.toThrow()
 const validate=new Ajv().compile(schema)
 expect(validate(plan)).toBe(true)
 expect(validate({...plan,pages:[{...plan.pages[0],sourceRefs:['R-upstream-only']}]})).toBe(false)
 expect(template).toEqual(before)
 expect(chapterPagePlanSourceSchema(template,[{...source,id:'different'}])).not.toEqual(schema)
})
it('reports the exact page, invalid references and allowed IDs for a corrective native submission',()=>{
 const bad={...plan,pages:[{...plan.pages[0],sourceRefs:['R-upstream-only']}]}
 expect(()=>createNativeChapterBrief(bad,catalog,request)).toThrow('operation-model')
 expect(()=>createNativeChapterBrief(bad,catalog,request)).toThrow('R-upstream-only')
 expect(()=>createNativeChapterBrief(bad,catalog,request)).toThrow('R-7.01-valid')
 expect(createNativeChapterBrief(plan,catalog,request).plan.pages[0]!.id).toBe('operation-model')
})
