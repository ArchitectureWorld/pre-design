export type ReferenceTextParts = readonly (string | number)[]
export type ReferenceListEntry = string | number | ReferenceTextParts | {readonly from:number;readonly at:number;readonly count:number}
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),'utf8')
const boundary=(text:string,at:number)=>at===0||at===text.length
  || !(text.charCodeAt(at)>=0xdc00&&text.charCodeAt(at)<=0xdfff&&text.charCodeAt(at-1)>=0xd800&&text.charCodeAt(at-1)<=0xdbff)

/** Literal phrases, never a summary or offsets into prose. Every dictionary
 * entry still spells its complete original string by joining readable pieces. */
export function shareReferenceDictionary(original:readonly string[],requestEnvelope=false){
  const seedLength=requestEnvelope?8:16,minLength=requestEnvelope?8:24,locations=new Map<string,[number,number][]>(),phrases=new Set<string>()
  for(let index=0;index<original.length;index++){
    const text=original[index]
    for(let at=0;at<=text.length-seedLength;){
      if(!boundary(text,at)){at++;continue}
      let length=0
      for(const [otherIndex,otherAt]of locations.get(text.slice(at,at+seedLength))??[]){
        const other=original[otherIndex];let size=seedLength
        while(at+size<text.length&&otherAt+size<other.length&&text[at+size]===other[otherAt+size])size++
        while(size>0&&(!boundary(text,at+size)||!boundary(other,otherAt+size)))size--
        length=Math.max(length,size)
      }
      if(length>=minLength){
        phrases.add(text.slice(at,at+length))
        if(requestEnvelope){let end=at+minLength;while(!boundary(text,end))end++;phrases.add(text.slice(at,end))}
        at+=length
      }else at++
    }
    for(let at=0;at<=text.length-seedLength;at++)if(boundary(text,at)){
      const seed=text.slice(at,at+seedLength),prior=locations.get(seed)??[]
      // Bounded cross-entry search avoids quadratic work on repeated prose.
      if(prior.length<4&&!prior.some(([previous])=>previous===index)){prior.push([index,at]);locations.set(seed,prior)}
    }
  }
  const fragments=[...phrases].sort((a,b)=>b.length-a.length||(a<b?-1:a>b?1:0)),candidates=new Map<string,number[]>()
  fragments.forEach((text,index)=>{const seed=text.slice(0,seedLength),list=candidates.get(seed)??[];list.push(index);candidates.set(seed,list)})
  if(requestEnvelope){
    // Longer matches with varying record IDs can occur only twice and hide a
    // much more reusable embedded phrase. Prefer actual byte savings per
    // character, amortizing the readable literal over its observed uses.
    const gains=fragments.map(text=>{const count=original.reduce((sum,entry)=>sum+(entry.includes(text)?1:0),0)
      return (bytes(text)-14-bytes(text)/Math.max(1,count))/text.length})
    for(const list of candidates.values())list.sort((a,b)=>gains[b]-gains[a]||fragments[b].length-fragments[a].length||a-b)
  }
  const used=new Map<number,number>()
  const encoded:(string|ReferenceTextParts)[]=original.map(text=>{
    const parts:(string|number)[]=[];let start=0
    for(let at=0;at<=text.length-seedLength;){
      const hit=(candidates.get(text.slice(at,at+seedLength))??[]).find(index=>text.startsWith(fragments[index],at))
      if(hit===undefined){at++;continue}
      if(start<at)parts.push(text.slice(start,at))
      parts.push(hit);used.set(hit,(used.get(hit)??0)+1);at+=fragments[hit].length;start=at
    }
    if(start<text.length)parts.push(text.slice(start))
    return parts.some(part=>typeof part==='number')?parts:text
  })
  const retained=fragments.map((text,index)=>({text,index,count:used.get(index)??0}))
    .filter(row=>row.count>=2&&bytes(row.text)*(row.count-1)>row.count*14+24)
  const mapping=new Map(retained.map((row,index)=>[row.index,index]))
  const strings=encoded.map((entry,index)=>{
    if(typeof entry==='string')return entry
    const parts:(string|number)[]=[]
    for(const part of entry){
      const value=typeof part==='number'&&!mapping.has(part)?fragments[part]:typeof part==='number'?mapping.get(part)!:part
      if(typeof value==='string'&&typeof parts.at(-1)==='string')parts[parts.length-1]=String(parts.at(-1))+value
      else parts.push(value)
    }
    return bytes(parts)<bytes(original[index])?parts:original[index]
  })
  return {strings,fragments:retained.map(row=>row.text)}
}

/** Request-only sharing also includes unique instruction/diagnostic literals.
 * They often embed source phrases without repeating the entire string, so a
 * whole-string dictionary alone misses them. Source views are never changed. */
export function shareReferenceRequestLiterals(original:readonly string[],data:unknown,stringKey:string){
  const extras=new Map<string,number>()
  function scan(node:unknown):void{
    if(typeof node==='string'){if(Buffer.byteLength(node,'utf8')>=24)extras.set(node,(extras.get(node)??0)+1)}
    else if(Array.isArray(node))node.forEach(scan)
    else if(node&&typeof node==='object')Object.values(node).forEach(scan)
  }
  scan(data)
  const originalSet=new Set(original),literals=[...extras.keys()].filter(text=>!originalSet.has(text))
  const pool=[...original,...literals],shared=shareReferenceDictionary(pool,true)
  const strings=shared.strings.slice(0,original.length),indices=new Map<string,number>()
  for(let i=0;i<literals.length;i++){
    const text=literals[i],entry=shared.strings[original.length+i],count=extras.get(text)!,index=strings.length
    if(Array.isArray(entry)&&count*bytes(text)>bytes(entry)+count*bytes({[stringKey]:index})+32){indices.set(text,index);strings.push(entry)}
  }
  function encode(node:unknown):unknown{
    if(typeof node==='string'){const index=indices.get(node);return index===undefined?node:{[stringKey]:index}}
    if(Array.isArray(node))return node.map(encode)
    if(node&&typeof node==='object')return Object.fromEntries(Object.entries(node).map(([key,child])=>[key,encode(child)]))
    return node
  }
  const used=new Set<number>()
  for(const entry of strings)if(Array.isArray(entry))for(const part of entry)if(typeof part==='number')used.add(part)
  const fragments=shared.fragments.map((text,index)=>({text,index})).filter(row=>used.has(row.index)),remap=new Map(fragments.map((row,index)=>[row.index,index]))
  return {data:encode(data),strings:strings.map(entry=>typeof entry==='string'?entry:entry.map(part=>typeof part==='number'?remap.get(part)!:part)),fragments:fragments.map(row=>row.text)}
}

/** Store inherited string sequences once. A range refers only to an earlier
 * complete list, not characters; order and every occurrence remain explicit. */
export function shareReferenceLists(data:unknown,stringKey:string,textKey:string,rowKey:string,listKey:string){
  function entry(node:unknown):string|number|ReferenceTextParts|undefined{
    if(typeof node==='string')return node
    if(node&&typeof node==='object'&&!Array.isArray(node)&&Object.keys(node).length===1){
      const record=node as Record<string,unknown>
      if(typeof record[stringKey]==='number')return record[stringKey] as number
      if(Array.isArray(record[textKey])){
        const parts=(record[textKey] as unknown[]).map(entry)
        if(parts.every(part=>typeof part==='string'||typeof part==='number'))return parts as ReferenceTextParts
      }
    }
    return undefined
  }
  const candidates=new Map<string,readonly (string|number|ReferenceTextParts)[]>()
  function scan(node:unknown):void{
    if(Array.isArray(node)){
      if(node.length>=8){const parts=node.map(entry);if(parts.every(part=>part!==undefined))candidates.set(JSON.stringify(node),parts as (string|number|ReferenceTextParts)[])}
      node.forEach(scan)
    }else if(node&&typeof node==='object'){
      const record=node as Record<string,unknown>
      if(Object.hasOwn(record,textKey)||Object.hasOwn(record,stringKey))return
      if(Object.hasOwn(record,rowKey)){const row=record[rowKey] as [number,unknown[]];row[1].forEach(scan);return}
      Object.values(node).forEach(scan)
    }
  }
  scan(data)
  const ordered=[...candidates].sort((a,b)=>b[1].length-a[1].length||(a[0]<b[0]?-1:a[0]>b[0]?1:0))
  const indices=new Map<string,number>(),lists:ReferenceListEntry[][]=[],locations=new Map<string,[number,number][]>()
  const originalKeys:string[][]=[]
  const seed=(keys:readonly string[],at:number)=>JSON.stringify(keys.slice(at,at+4))
  for(const [original,parts]of ordered){
    const index=lists.length,keys=parts.map(part=>JSON.stringify(part)),packed:ReferenceListEntry[]=[]
    for(let at=0;at<parts.length;){
      let found:[number,number,number]|undefined
      if(at+4<=parts.length)for(const [previous,start]of locations.get(seed(keys,at))??[]){
        const prior=originalKeys[previous];let count=4
        while(at+count<keys.length&&start+count<prior.length&&keys[at+count]===prior[start+count])count++
        if(!found||count>found[2])found=[previous,start,count]
      }
      if(found&&bytes(parts.slice(at,at+found[2]))>48){packed.push({from:found[0],at:found[1],count:found[2]});at+=found[2]}
      else packed.push(parts[at++])
    }
    indices.set(original,index);lists.push(packed);originalKeys.push(keys)
    for(let at=0;at+4<=keys.length;at++){
      const key=seed(keys,at),prior=locations.get(key)??[]
      if(prior.length<4&&!prior.some(([previous])=>previous===index)){prior.push([index,at]);locations.set(key,prior)}
    }
  }
  function encode(node:unknown):unknown{
    if(Array.isArray(node)){
      const index=indices.get(JSON.stringify(node))
      return index===undefined?node.map(encode):{[listKey]:index}
    }
    if(node&&typeof node==='object'){
      const record=node as Record<string,unknown>
      if(Object.hasOwn(record,textKey)||Object.hasOwn(record,stringKey))return node
      if(Object.hasOwn(record,rowKey)){const row=record[rowKey] as [number,unknown[]];return {[rowKey]:[row[0],row[1].map(encode)]}}
      return Object.fromEntries(Object.entries(node).map(([key,child])=>[key,encode(child)]))
    }
    return node
  }
  return {data:encode(data),lists}
}
