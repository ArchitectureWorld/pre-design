// Deliberately small decorative SVG dialect. Browser-safe, no DOM parser or dependencies.
// Unsupported authoring features fail closed; this is not an arbitrary SVG importer.
const fail=reason=>{throw Object.assign(new Error('SVG_PROTOTYPE_INVALID: '+reason),{code:'SVG_PROTOTYPE_INVALID',statusCode:422})}
const NUM='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'
const numeric=new RegExp('^'+NUM+'$')
const tags=new Set(['svg','g','defs','path','rect','circle','ellipse','line','polygon','polyline','linearGradient','radialGradient','stop','clipPath'])
const geometry={svg:['width','height','viewBox','xmlns'],g:[],defs:[],path:['d'],rect:['x','y','width','height','rx','ry'],circle:['cx','cy','r'],ellipse:['cx','cy','rx','ry'],line:['x1','y1','x2','y2'],polygon:['points'],polyline:['points'],linearGradient:['x1','y1','x2','y2','gradientUnits','gradientTransform','spreadMethod'],radialGradient:['cx','cy','r','fx','fy','gradientUnits','gradientTransform','spreadMethod'],stop:['offset','stop-color','stop-opacity'],clipPath:['clipPathUnits']}
const common=new Set(['id','fill','stroke','stroke-width','opacity','fill-opacity','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','fill-rule','clip-rule','clip-path','transform'])
function number(value,min=-1e6,max=1e6){if(!numeric.test(value)||!Number.isFinite(+value)||+value<min||+value>max)fail('numeric attribute');return String(+value)}
function numbers(value){const parts=value.trim().split(/[\s,]+/);if(!parts.length||parts.some(x=>!x))fail('numeric list');return parts.map(x=>number(x))}
function path(value){
 const tokens=value.match(new RegExp('[a-zA-Z]|'+NUM,'g'))??[]
 if(tokens.join('')!==value.replace(/[\s,]/g,''))fail('path syntax')
 const arities={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0}
 let i=0
 if(!/^[mM]$/.test(tokens[0]??''))fail('path must start with move')
 while(i<tokens.length){
  const cmd=tokens[i++],arity=arities[cmd?.toUpperCase()]
  if(arity===undefined)fail('path command')
  let count=0
  while(i<tokens.length&&!/^[a-zA-Z]$/.test(tokens[i])){const v=number(tokens[i++]);if(cmd.toUpperCase()==='A'&&[3,4].includes(count%7)&&!['0','1'].includes(v))fail('arc flag');count++}
  if(arity===0?count!==0:count===0||count%arity!==0)fail('path arguments')
 }
 return tokens.join(' ')
}
function transform(value){
 let rest=value.trim(),out=[]
 while(rest){
  const m=/^(matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)\s*/.exec(rest)
  if(!m)fail('transform')
  const n=numbers(m[2]),counts={matrix:[6],translate:[1,2],scale:[1,2],rotate:[1,3],skewX:[1],skewY:[1]}
  if(!counts[m[1]].includes(n.length))fail('transform arguments')
  out.push(m[1]+'('+n.join(' ')+')');rest=rest.slice(m[0].length)
 }
 if(!out.length)fail('empty transform')
 return out.join(' ')
}
export function sanitizePrototypeSvg(svg,{canvas}={}){
 if(typeof svg!=='string'||svg.length>262144||/[^\x09\x0a\x0d\x20-\x7e]/.test(svg))fail('size or character set')
 const W=canvas?.width,H=canvas?.height
 if(!Number.isInteger(W)||!Number.isInteger(H)||W<240||H<240||W>7680||H>7680)fail('canvas')
 if(/[&]|<!|<\?/.test(svg))fail('entities, declarations and processing instructions forbidden')
 const stack=[],out=[],ids=new Map(),refs=[]
 let pos=0,nodes=0,root=false
 while(pos<svg.length){
  const ws=/^\s*/.exec(svg.slice(pos))[0];pos+=ws.length;if(pos===svg.length)break
  const m=/^<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>/.exec(svg.slice(pos))
  if(!m)fail('markup or text')
  pos+=m[0].length
  const [,closing,tag,tail]=m
  if(!tags.has(tag))fail('unsupported element '+tag)
  if(closing){if(tail.trim()||stack.pop()!==tag)fail('closing tag');out.push('</'+tag+'>');continue}
  if(++nodes>2000||stack.length>=32)fail('node or depth limit')
  if(!root){if(tag!=='svg')fail('root');root=true}else if(!stack.length||tag==='svg')fail('multiple or nested root')
  const parent=stack.at(-1)
  if(['path','rect','circle','ellipse','line','polygon','polyline','stop'].includes(parent))fail('leaf children')
  if(tag==='stop'&&!['linearGradient','radialGradient'].includes(parent))fail('stop parent')
  if(['linearGradient','radialGradient'].includes(parent)&&tag!=='stop')fail('gradient child')
  const self=/\/\s*$/.test(tail),attrs={},raw=self?tail.replace(/\/\s*$/,''):tail
  let rest=raw
  while(rest.trim()){
   const a=/^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest)
   if(!a)fail('attribute syntax')
   rest=rest.slice(a[0].length)
   const key=a[1];let value=a[2]??a[3]
   if(Object.hasOwn(attrs,key)||(!common.has(key)&&!geometry[tag].includes(key)))fail('unsupported or duplicate attribute '+key)
   if(key==='xmlns'){if(tag!=='svg'||value!=='http://www.w3.org/2000/svg')fail('namespace')}
   else if(key==='id'){if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)||ids.has(value))fail('id');ids.set(value,tag)}
   else if(['fill','stroke','stop-color'].includes(key)){
    const ref=/^url\(#([A-Za-z][A-Za-z0-9_-]{0,63})\)$/.exec(value)
    if(ref&&key!=='stop-color')refs.push([ref[1],'paint'])
    else if(!/^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|none|black|white|transparent)$/.test(value))fail('paint')
   }else if(key==='clip-path'){if(tag==='clipPath'||stack.includes('clipPath'))fail('recursive clipping unsupported');const ref=/^url\(#([A-Za-z][A-Za-z0-9_-]{0,63})\)$/.exec(value);if(!ref)fail('clip reference');refs.push([ref[1],'clip'])}
   else if(['transform','gradientTransform'].includes(key))value=transform(value)
   else if(key==='d')value=path(value)
   else if(key==='viewBox'){const n=numbers(value);if(n.join(' ')!==[0,0,W,H].join(' '))fail('viewBox does not match canvas');value=n.join(' ')}
   else if(key==='points'){const n=numbers(value);if(n.length<4||n.length%2)fail('points');value=n.join(' ')}
   else if(key==='stroke-dasharray'){if(value!=='none')value=numbers(value).map(x=>number(x,0)).join(' ')}
   else if(['gradientUnits','clipPathUnits'].includes(key)){if(!['userSpaceOnUse','objectBoundingBox'].includes(value))fail('units')}
   else if(key==='spreadMethod'){if(!['pad','reflect','repeat'].includes(value))fail('spread method')}
   else if(['fill-rule','clip-rule'].includes(key)){if(!['nonzero','evenodd'].includes(value))fail('fill rule')}
   else if(key==='stroke-linecap'){if(!['butt','round','square'].includes(value))fail('line cap')}
   else if(key==='stroke-linejoin'){if(!['miter','round','bevel'].includes(value))fail('line join')}
   else if(['opacity','fill-opacity','stroke-opacity','stop-opacity','offset'].includes(key))value=number(value,0,1)
   else value=number(value,['width','height','r','rx','ry','stroke-width','stroke-miterlimit'].includes(key)?0:-1e6)
   if(tag==='svg'&&key==='width'&&+value!==W||tag==='svg'&&key==='height'&&+value!==H)fail('canvas size mismatch')
   attrs[key]=value
  }
  if(tag==='svg')Object.assign(attrs,{xmlns:'http://www.w3.org/2000/svg',width:String(W),height:String(H),viewBox:`0 0 ${W} ${H}`})
  out.push('<'+tag+Object.keys(attrs).sort().map(k=>' '+k+'="'+attrs[k]+'"').join('')+(self?'/>':'>'))
  if(!self)stack.push(tag)
 }
 if(!root||stack.length)fail('incomplete document')
 for(const [id,kind]of refs){if(kind==='clip'?ids.get(id)!=='clipPath':!['linearGradient','radialGradient'].includes(ids.get(id)))fail('missing or wrong reference target')}
 return out.join('')
}
