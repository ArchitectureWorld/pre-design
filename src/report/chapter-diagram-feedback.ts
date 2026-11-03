import {validatePlanningDiagram} from './manuscript/validation.ts'
export const CHAPTER_DIAGRAM_CONTRACT='chapter-diagram-feedback-20261023.1'
/** Diagnose every diagram before asking the native author to repair its metadata. */
export function chapterDiagramFeedback(value:unknown):string{
 const chapter=value as any,issues:string[]=[]
 for(const page of chapter?.pages??[]){
  const visual=page?.visual
  if(!visual?.diagram)continue
  if(visual.kind!=='diagram')issues.push(`${page.id}: visual.diagram存在，visual.kind必须为diagram，不能同时为concept或source。后续布局仍另配场景图；这不取消每页场景图要求。`)
  try{validatePlanningDiagram(visual.diagram,`${page.id}.visual.diagram`)}catch(error){issues.push(String(error))}
 }
 return ['本轮只针对图件元数据的程序契约错误续作，保留已修订正文、表格、数量、备注与所有节点/边的业务关系，不退回早期稿。',
  ...issues,
  'presentation是排版样式元数据，不是业务节点。primary-secondary只支持两条共享首尾端点的路径，不能当作任意主次分类标签；若原关系不满足，可省略presentation，由后续布局原生决定样式。不要删掉nodes/edges来绕过校验，不改变业务关系凑模板。',
  '必须返回完整章节并通过structured_output提交；修正后仍进行独立内容审查。'].join('\n')
}
