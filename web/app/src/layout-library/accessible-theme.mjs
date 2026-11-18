export function contrast(a,b){
 const luminance=h=>{const c=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]}
 const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}

// Derivation affects only candidate rendering colors, never source observations.
export function deriveReadableTheme(source){
 const theme={...source},changes=[]
 const rgb=h=>h.slice(1).match(/../g).map(v=>parseInt(v,16))
 const hex=values=>'#'+values.map(v=>v.toString(16).padStart(2,'0')).join('')
 for(const key of ['ink','muted','accent']){
  const minimum=key==='accent'?3:4.5,original=source[key]
  if(contrast(original,source.background)>=minimum)continue
  const start=rgb(original),candidates=[]
  for(const target of [0,255])for(let step=1;step<=255;step++){
   const values=start.map(v=>Math.round(v+(target-v)*step/255)),color=hex(values)
   if(contrast(color,source.background)>=minimum){candidates.push({color,distance:values.reduce((n,v,i)=>n+(v-start[i])**2,0)});break}
  }
  candidates.sort((a,b)=>a.distance-b.distance||a.color.localeCompare(b.color))
  if(!candidates.length)throw Error('READABLE_THEME_DERIVATION_FAILED')
  theme[key]=candidates[0].color
  changes.push({key,source:original,derived:theme[key],background:source.background,minimum,method:'rgb-endpoint-minimum-v1',reason:'text-contrast'})
 }
 return {theme,changes}
}
