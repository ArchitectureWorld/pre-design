import type {MaterialCorpus} from '../materials/research-evidence.ts'

/** Exact interior segments locate bounded original text for diagnosis only.
 * This search is never an evidence match and never changes submitted bindings. */
export function moduleSourceQuoteAnchorCandidates(corpus:MaterialCorpus,quote:string){
 const prefix=quote.slice(0,320),width=16
 if(prefix.length<width*2)return []
 const offsets=[...new Set([...Array.from({length:Math.floor(prefix.length/width)},(_,i)=>i*width),prefix.length-width])]
 const anchors=offsets.map(submittedOffset=>({submittedOffset,text:prefix.slice(submittedOffset,submittedOffset+width)}))
  .filter(a=>(a.text.match(/[\p{L}\p{N}]/gu)?.length??0)>=8)
 const candidates=[]
 for(const document of corpus.documents){
  for(const location of document.pages??[{page:undefined,text:document.text!}]){
   const alignments=new Map<number,{submittedOffset:number;sourceOffset:number;text:string}[]>()
   for(const anchor of anchors){
    const sourceOffset=location.text.indexOf(anchor.text)
    if(sourceOffset<0||location.text.lastIndexOf(anchor.text)!==sourceOffset)continue
    const alignment=sourceOffset-anchor.submittedOffset,segments=alignments.get(alignment)??[]
    segments.push({...anchor,sourceOffset});alignments.set(alignment,segments)
   }
   const segments=[...alignments.values()].find(rows=>rows.length>=2
    &&rows[0].submittedOffset<=prefix.length/4&&rows.at(-1)!.submittedOffset+width>=prefix.length*3/4)
   if(!segments)continue
   const sourceExcerptStart=Math.max(0,segments[0].sourceOffset-80)
   candidates.push({diagnosticOnly:true as const,wholeQuoteVerified:false as const,path:document.path,contentHash:document.contentHash,
    ...(location.page===undefined?{}:{page:location.page}),sourceExcerptStart,sourceExcerpt:location.text.slice(sourceExcerptStart,sourceExcerptStart+640),
    excerptTruncated:sourceExcerptStart>0||location.text.length>sourceExcerptStart+640,
    matchedSegments:[segments[0],segments.at(-1)!],submittedSearchPrefixTruncated:quote.length>prefix.length})
   if(candidates.length===4)return candidates
  }
 }
 return candidates
}
