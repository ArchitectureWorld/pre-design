const invalid=()=>{throw Object.assign(Error('逐组件提取需新建会话，选择一个参考文档的1至6个有效页码；未调用模型。'),{statusCode:409,code:'REFERENCE_COMPONENT_SELECTION_INVALID'})}
export function prepareComponentSelection(files,pages){
 if(files.length!==1||!files[0].id||!['pdf','pptx','image'].includes(files[0].kind))invalid()
 const file=files[0],count=file.pageCount??(file.kind==='image'?1:0),wanted=pages??Array.from({length:Math.min(count,7)},(_,i)=>i+1)
 if(!Array.isArray(wanted)||wanted.length<1||wanted.length>6||new Set(wanted).size!==wanted.length||wanted.some(p=>!Number.isSafeInteger(p)||p<1||p>count))invalid()
 return {fileId:file.id,pages:[...wanted].sort((a,b)=>a-b)}
}
export function selectComponentReferences(files,images,selection){
 const checked=prepareComponentSelection(files,selection?.pages)
 if(selection?.fileId!==checked.fileId)invalid()
 const file=files[0],wanted=new Set(checked.pages),chosen=images.filter(i=>i.fileId===file.id&&wanted.has(i.page??1))
 if(chosen.length!==wanted.size||new Set(chosen.map(i=>i.page??1)).size!==wanted.size)invalid()
 const {structure,privateArtifacts,...rest}=file
 return {files:[{...rest,text:'',readPages:checked.pages,imageCount:chosen.length,hasImages:true,pages:(file.pages??[]).filter(p=>wanted.has(p.page??p.pageNumber)),limitations:[...(file.limitations??[]),'逐组件本轮只分析明确选中的页码；未选页不发送模型，不能视为全稿完成。']}],images:chosen}
}
