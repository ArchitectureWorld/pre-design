import JSZip from 'jszip'
import {createHash} from 'node:crypto'
import {createPackage,validatePackage,contrast,fail} from './contract.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex')
const val=(s,k)=>new RegExp(`\\b${k}=["']([^"']+)["']`).exec(s)?.[1]
export async function extractPptx(bytes,name){
 if(bytes.length>8*1024*1024)throw fail('本版参考PPTX上限8 MiB，请提供精简的参考页。',413)
 let zip;try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false})}catch{throw fail('参考文件不是有效PPTX。')}
 const entries=Object.values(zip.files)
 if(entries.length>1500||entries.some(f=>(f.unsafeOriginalName??f.name).split('/').includes('..')||/vbaProject|\.exe$/i.test(f.name)))throw fail('参考PPTX包含不允许的路径或可执行内容。')
 let budget=0
 for(const f of entries){const n=f._data?.uncompressedSize??0;budget+=n;if(n>32*1024*1024||budget>64*1024*1024)throw fail('参考PPTX解压后过大，未进行解析。',413)}
 async function xml(path){const f=zip.file(path);if(!f)return '';if((f._data?.uncompressedSize??0)>2*1024*1024)throw fail('参考XML超过解析上限。',413);const text=await new Promise((resolve,reject)=>{const stream=f.nodeStream(),chunks=[];let count=0;stream.on('data',chunk=>{count+=chunk.length;if(count>2*1024*1024){stream.destroy();reject(fail('参考XML超过解析上限。',413));return}chunks.push(chunk)});stream.on('error',reject);stream.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')))});if(/<!DOCTYPE|<!ENTITY/i.test(text))throw fail('不接受外部实体定义。');return text}
 const presentation=await xml('ppt/presentation.xml');if(!presentation)throw fail('缺少PPTX演示文稿结构。')
 const theme=await xml('ppt/theme/theme1.xml'),p=createPackage(name),limitations=['仅提炼可核实的主题和文本占位结构；不复制原稿文字、品牌Logo、照片、母版装饰或嵌入字体。','当前输出为1600×900原生HTML资源，不保证复原原PPT母版或原生PPTX可编辑性。']
 const palette={};for(const m of theme.matchAll(/<a:(dk1|lt1|accent1)\b[^>]*>([\s\S]*?)<\/a:\1>/g)){const body=m[2],c=/<a:srgbClr\b([^>]*)/.exec(body),sys=/<a:sysClr\b([^>]*)/.exec(body);const v=c?val(c[1],'val'):sys?val(sys[1],'lastClr'):null;if(/^[a-f0-9]{6}$/i.test(v??''))palette[m[1]]='#'+v}
 if(palette.lt1)p.theme.background=palette.lt1
 if(palette.dk1&&contrast(palette.dk1,p.theme.background)>=4.5)p.theme.ink=palette.dk1
 if(palette.accent1&&contrast(palette.accent1,p.theme.background)>=3)p.theme.accent=palette.accent1
 else if(palette.accent1)limitations.push('源强调色对比度不足，候选保留平台可读强调色，需人工确认。')
 if(contrast(p.theme.muted,p.theme.background)<4.5)p.theme.muted=p.theme.ink
 const sourceSize=/<p:sldSz\b([^>]*)/.exec(presentation),w=Number(sourceSize&&val(sourceSize[1],'cx')),h=Number(sourceSize&&val(sourceSize[1],'cy'))
 const slides=entries.filter(f=>/^ppt\/slides\/slide\d+\.xml$/.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).slice(0,8)
 const observations=[]
 for(const file of slides){
  const content=await xml(file.name);if((content.match(/<p:sp\b/g)??[]).length>256)throw fail('参考页面元素过多，请精简参考页。',413);const shapes=[]
  for(const m of content.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g)){
   const sp=m[1],ph=/<p:ph\b([^>]*)/.exec(sp),off=/<a:off\b([^>]*)/.exec(sp),ext=/<a:ext\b([^>]*)/.exec(sp)
   if(!ph||!off||!ext||!w||!h)continue
   const type=val(ph[1],'type')??'body',r={x:Number(val(off[1],'x'))/w,y:Number(val(off[1],'y'))/h,w:Number(val(ext[1],'cx'))/w,h:Number(val(ext[1],'cy'))/h}
   if(!Object.values(r).every(Number.isFinite)||r.w<=0||r.h<=0)continue
   shapes.push({type,rect:r})
  }
  const title=shapes.find(s=>['title','ctrTitle'].includes(s.type)),body=shapes.find(s=>['body','obj'].includes(s.type))
  if(title&&body){observations.push({page:file.name,placeholders:shapes.length});
   // Split a source body placeholder into claim and body while reserving citations.
   const gap=.025,claimHeight=Math.min(.1,body.rect.h*.2),bottom=Math.min(.86,body.rect.y+body.rect.h)
   const candidate={id:'reference-'+(observations.length),label:'参考文本结构 '+observations.length,kind:'points',slots:[{role:'title',rect:title.rect},{role:'claim',rect:{...body.rect,h:claimHeight}},{role:'body',rect:{...body.rect,y:body.rect.y+claimHeight+gap,h:bottom-body.rect.y-claimHeight-gap}},{role:'source',rect:{x:.05,y:.92,w:.9,h:.04}}]}
   try{validatePackage({...p,layouts:[candidate]});p.layouts.unshift(candidate)}catch{limitations.push(`第${file.name.match(/\d+/)?.[0]}页的占位结构不满足本平台边界/留白要求，未直接采用。`)}
  }
 }
 p.layouts=p.layouts.slice(0,12);p.source={kind:'pptx',name:name.slice(0,180),sha256:hash(bytes),limitations:limitations.slice(0,20)};p.rights={basis:'unknown',shareAllowed:false,note:'参考原件的使用权限需由上传者确认。'}
 return {package:validatePackage(p),observations:{slidesInspected:slides.length,sourceCanvas:{width:w,height:h},nativePlaceholders:observations},status:'candidate-not-published'}
}
export async function importReference(filename,content,name){
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(content)||content.length%4!==0)throw fail('上传内容不是标准base64。')
 const bytes=Buffer.from(content,'base64');if(bytes.length>8*1024*1024)throw fail('参考文件上限8 MiB。',413)
 if(/\.pptx$/i.test(filename))return extractPptx(bytes,name??filename.replace(/\.pptx$/i,''))
 if(/\.json$/i.test(filename)){let p;try{p=JSON.parse(bytes.toString('utf8'))}catch{throw fail('JSON格式不正确。')}return {package:validatePackage(p),status:'candidate-not-published'}}
 throw fail('本版文件提炼支持原生版式JSON与PPTX；文字设计要求请使用“参考文字提炼”。PDF/图片不能伪称已完成风格识别。',415)
}
