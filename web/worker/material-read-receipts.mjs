// Extract trusted tool results, never model-authored text or arguments alone.
export function materialReadReceipts(events){
 const calls=new Map(),reads=[]
 for(const event of events??[]){
  if(event.type==='tool/call')calls.set(event.data?.callId,event.data?.name)
  if(event.type!=='tool/result')continue
  const message=event.data?.message
  if(message?.isError||calls.get(message?.toolCallId)!=='preplanning_read_material')continue
  for(const block of message.content??[]){
   if(block.type!=='text')continue
   let value;try{value=JSON.parse(block.text)}catch{continue}
   if(!['ok','needs_ocr'].includes(value.status)||typeof value.path!=='string'||!/^[a-f0-9]{64}$/.test(value.contentHash??''))continue
   const kind=value.image?'metadata':Array.isArray(value.pages)?'pdf':'text'
   reads.push({sourceRelativePath:value.path,contentHash:value.contentHash,status:value.status,kind,
    ...(kind==='pdf'?{pages:value.pages.filter(p=>!p.needsOcr&&p.text).map(p=>({page:p.page,text:p.text,truncated:!!p.truncated}))}:kind==='metadata'?{image:value.image,text:value.text}:{startLine:value.startLine,endLine:value.endLine,text:value.text,truncated:!!value.truncated})})
  }
 }
 return reads
}
