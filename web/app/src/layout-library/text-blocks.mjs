const bad=()=>{throw Object.assign(new Error('局部文字键、内容或强调范围已变化。'),{code:'LAYOUT_TEXT_INVALID',statusCode:409})}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export function validateTextBlocks(blocks){
 if(!Array.isArray(blocks)||blocks.length>32)bad();const keys=new Set()
 for(const b of blocks){
  if(!b||Object.keys(b).some(k=>!['key','text','spans'].includes(k))||!/^[a-z][a-z0-9-]{0,47}$/.test(b.key??'')||keys.has(b.key)||typeof b.text!=='string'||!b.text.trim()||Array.from(b.text).length>2000)bad();keys.add(b.key)
  const chars=Array.from(b.text),spans=b.spans??[];if(!Array.isArray(spans)||spans.length>32)bad();let end=0
  for(const s of spans){if(!s||Object.keys(s).some(k=>!['start','end','quote','style'].includes(k))||!Number.isSafeInteger(s.start)||!Number.isSafeInteger(s.end)||s.start<end||s.end<=s.start||s.end>chars.length||!['strong','accent','accent-strong'].includes(s.style)||chars.slice(s.start,s.end).join('')!==s.quote)bad();end=s.end}
 }
 return blocks
}
export function renderTextBlock(block,color){
 validateTextBlocks([block]);const chars=Array.from(block.text);let result='',cursor=0
 for(const s of block.spans??[]){result+=esc(chars.slice(cursor,s.start).join(''));const value=esc(chars.slice(s.start,s.end).join(''));const accentTag=s.style==='accent-strong'?'strong':'span';result+=s.style==='strong'?'<strong>'+value+'</strong>':'<'+accentTag+' style="color:'+(/^#[0-9a-f]{6}$/i.test(color??'')?color:'#24364c')+'">'+value+'</'+accentTag+'>';cursor=s.end}
 return result+esc(chars.slice(cursor).join(''))
}
