// Real disposable PostgreSQL + owned on-disk image; synthetic authored draft only.
import assert from 'node:assert/strict'
import {compileNativeDesignPackageV3} from '../../src/layout-library/native-design-compiler.mjs'
import {randomUUID} from 'node:crypto'
import sharp from 'sharp'
import {fullLayoutFixture} from '../layout-library/full-fixture.mjs'
import {nativePackageFixture,nativeDesignInput} from './native-design-v3-fixture.mjs'
import {createPackage} from '../../src/layout-library/contract.mjs'
import {confirmedOutlineFixture} from './outline.mjs'
export async function projectContentComparisonFixture(){
 const f=await fullLayoutFixture(),image=await sharp({create:{width:360,height:180,channels:3,background:'#be3151'}}).png().toBuffer()
 try{
  const owned=await f.post('/materials',{filename:'owned-project-fixture.png',content:image.toString('base64')})
  const foreign=await f.request('POST','/projects',{requestId:randomUUID(),name:'另一个用户的合成项目'})
  const other=await f.request('POST','/projects/'+foreign.id+'/materials',{requestId:randomUUID(),baseRevision:0,filename:'private-other.png',content:image.toString('base64')})
  await f.db.query('UPDATE projects SET owner_id=$2 WHERE id=$1',[foreign.id,'different-owner'])
  await confirmedOutlineFixture(f.db,f.project.id)
  const row=(await f.db.query('SELECT * FROM workflow_drafts WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[f.project.id])).rows[0],doc=structuredClone(row.document)
  const item=doc.blocks[0].items[0];Object.assign(item,{title:'当前项目唯一标题',paragraphs:['当前项目完整段落，不是版式示例。'],points:['实际要点甲：不得替换为示例。','实际要点乙：比较时保持原文。'],figure:{materialId:owned.id,caption:'本项目有权使用的合成红色图片'}})
  const bad=doc.blocks[1].items[0];Object.assign(bad,{title:'不可访问图片页',paragraphs:['权限反例'],points:['不得借用另一项目图片'],figure:{materialId:other.id,caption:'另一用户图片不可访问'}})
  const hash=(await f.db.query('SELECT input_hash FROM outline_versions WHERE project_id=$1 AND version=1',[f.project.id])).rows[0].input_hash
  await f.db.query('UPDATE workflow_drafts SET document=$2,input_hash=$3 WHERE id=$1',[row.id,doc,hash])
  const pkg=await nativePackageFixture();pkg.name='同一项目内容比较测试'
  const first=pkg.layouts[0];first.id='image-left';first.label='左图右文'
  const second=structuredClone(first);second.id='image-right';second.label='右图左文';second.slots.find(s=>s.role==='image').rect.x=.55;second.slots.find(s=>s.role==='image').rect.w=.4;second.slots.find(s=>s.role==='body').rect.x=.05;second.slots.find(s=>s.role==='body').rect.w=.45
  const capacity=structuredClone(first);capacity.id='capacity-fail';capacity.label='标题容量不足';capacity.contentFitRules.maxTitleCharacters=1
  const mapping=structuredClone(first);mapping.id='mapping-fail';mapping.label='需要文字映射';mapping.slots=mapping.slots.filter(s=>s.role!=='body');mapping.slots.push({id:'mapped-text',role:'text',binding:'custom-body',purpose:'body',rect:{x:.55,y:.35,w:.4,h:.5}});mapping.contentFitRules.maxTextBlocks=1;mapping.contentFitRules.maxTextCharacters=100;mapping.contentFitRules.maxBodyPoints=0;mapping.contentFitRules.maxBodyCharacters=0
  mapping.archetypeId='archetype-mapping'
  const mappedArchetype=structuredClone(pkg.designProfile.archetypes[0]);mappedArchetype.id=mapping.archetypeId;mappedArchetype.roles=mappedArchetype.roles.map(r=>r==='body'?'text':r);mappedArchetype.capacity.bodyPoints=0;mappedArchetype.capacity.textBlocks=1
  pkg.designProfile.archetypes.push(mappedArchetype);pkg.designSpec.profile=structuredClone(pkg.designProfile);pkg.designSpec.masterLayoutGraph.push({id:'layout-2',kind:'layout',parentId:'master-1',archetypeId:mapping.archetypeId,evidenceIds:['evidence-1']})
  const geometry=structuredClone(first);geometry.id='geometry-fail';geometry.label='字数合法但几何不足';geometry.slots.find(s=>s.role==='body').rect={x:.55,y:.35,w:.03,h:.05}
  pkg.layouts=[first,second,capacity,mapping,geometry]
  const resource=await f.request('POST','/layout-library',{requestId:randomUUID(),package:pkg})
  const selectable=await f.request('POST','/layout-library',{requestId:randomUUID(),package:createPackage('manual选用合成资源')})
  const context={projectId:f.project.id,draftId:row.id,pageId:'visual-page-'+item.id},badContext={...context,pageId:'visual-page-'+bad.id}
  const snapshot=async()=>{
   const result={};for(const table of ['layout_library_resources','layout_library_versions','layout_project_bindings','layout_binding_versions','workflow_drafts','workflow_visuals','materials','jobs'])result[table]=(await f.db.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value FROM ${table} t`)).rows[0].value
   return result
  }
  return {...f,resource,selectable,context,badContext,foreignId:foreign.id,item,snapshot,async setParagraph(text){
   const current=(await f.db.query('SELECT document FROM workflow_drafts WHERE id=$1',[row.id])).rows[0].document
   current.blocks[0].items[0].paragraphs=[text];await f.db.query('UPDATE workflow_drafts SET document=$2 WHERE id=$1',[row.id,current])
  },async prepareMapping(){
   const input=nativeDesignInput(),profile=input.designSpec.profile
   // Authored synthetic specification, not a claimed extraction or forged review.
   profile.evidence=[{id:'evidence-1',provenance:'user'}];profile.archetypes[0].roles=profile.archetypes[0].roles.map(r=>r==='claim'?'text':r);profile.archetypes[0].capacity.textBlocks=1;profile.archetypes[0].capacity.bodyPoints=2
   const layout=input.prototypes[0];layout.id='mapped-paragraph';layout.label='段落组件'
   const text=layout.slots.find(s=>s.role==='claim');Object.assign(text,{id:'mapped-paragraph',role:'text',binding:'mapped-paragraph',purpose:'body'})
   Object.assign(layout.contentFitRules,{maxClaimCharacters:0,maxTextBlocks:1,maxTextCharacters:200,maxBodyPoints:2,maxBodyCharacters:100})
   const small=structuredClone(layout);small.id='mapped-capacity';small.label='文字容量不足';small.contentFitRules.maxTextCharacters=1
   input.prototypes.push(small);input.name='合法合成映射验收'
   const created=await f.request('POST','/layout-library',{requestId:randomUUID(),package:compileNativeDesignPackageV3(input)}),base='/layout-library/'+created.id+'/'+created.version,mapped=await f.request('GET',base)
   const validation=await f.request('POST',base+'/validate',{});assert.equal(validation.status,'passed',JSON.stringify(validation))
   const comparisonIds=[];for(const candidate of mapped.package.layouts){const compared=await f.request('POST',base+'/compare',{layoutId:candidate.id});assert.equal(compared.source,null);comparisonIds.push(compared.receipt.id)}
   // Test actor explicitly reviews its own synthetic authored fixture through the real API.
   await f.request('POST',base+'/reference-review',{requestId:randomUUID(),packageHash:mapped.hash,comparisonIds,reviewed:true})
   for(const scope of ['local','manual']){const c=await f.request('GET',f.base+'/layout-bindings');await f.post('/layout-bindings',{draftId:context.draftId,expectedRevision:c.revision,scope,pageIds:[context.pageId],...(scope==='manual'?{remove:true,resource:null,overrides:{}}:{resource:{resourceId:selectable.id,version:selectable.version},overrides:{layoutId:'image-left'}})})}
   return mapped
  },async prepareApply(){
   // Separate explicit-apply phase: replace the foreign-image negative test with this project's owned fixture.
   const next=structuredClone(doc);next.blocks[1].items[0].figure={materialId:owned.id,caption:'本项目合成图片'}
   await f.db.query('UPDATE workflow_drafts SET document=$2 WHERE id=$1',[row.id,next])
  }}
 }catch(e){await f.close();throw e}
}
