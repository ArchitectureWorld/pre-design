import {randomUUID,createHash} from 'node:crypto'
import {validateVisualSemantics,visualSemanticsSchema} from '../../web/app/src/layout-library/reference-component-semantics.mjs'
import {validateComponentObservation} from '../../web/app/src/layout-library/reference-components.mjs'
import {stagePolicyWithOutputLimit} from '../../web/app/src/layout-library/reference-stage-policy.mjs'
import {decodeLayoutResponse} from '../../web/app/src/layout-library/response.mjs'
/** Single authorized image observation. No other stage, package creation or retry. */
export async function runVisualSemanticsTrial({observation,image,source,policy,runModel,signal,onEvent}){
 const route=policy.routes?.vision
 if(source?.pageNumber!==15||!image||image.page!==15||!['image/png','image/jpeg'].includes(image.mimeType)||!route?.primary||!Array.isArray(route.fallbacks)||route.fallbacks.length>1)throw Error('SEMANTICS_TRIAL_SCOPE_INVALID')
 const bytes=Buffer.from(image.data??'','base64')
 if(!bytes.length||bytes.length>8*1024*1024||createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('SEMANTICS_TRIAL_IMAGE_INVALID')
 const observed=validateComponentObservation(observation,[source]),bounded=stagePolicyWithOutputLimit(policy,'semantics-1',{'semantics-1':4096},'vision')
 signal?.throwIfAborted()
 const input={componentObservation:{source:observed.source,components:observed.components},visualSemanticsSchema:visualSemanticsSchema()}
 const prompt='仅观察给定第15页图像，输出符合visualSemanticsSchema的version=1 JSON。组件ID与来源必须匹配。body marker为disc|none|other|unknown；文字emphasis为present|absent|unknown及页归一化regions；image caption为present|absent|unknown。无法确认用unknown，不抄写文字、不生成quote、权限、字体或编辑性声明。强调区域须在对应组件内。\n'+JSON.stringify(input)
 const result=await runModel({jobId:randomUUID(),stage:'semantics-1',prompt,images:[image],modelRole:'vision',policy:bounded,signal,onEvent})
 signal?.throwIfAborted()
 const raw=typeof result.response==='string'?decodeLayoutResponse(result.response):result.response
 return {raw,analysis:validateVisualSemantics(raw,observation,[source]),execution:result.execution,scope:'single-image-semantic-observation-only',candidateCreated:false}
}
