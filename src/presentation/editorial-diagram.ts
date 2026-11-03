import type { PlanningManuscriptDiagram } from '../report/manuscript/types.ts'
import type { EditorialDiagramPresentation } from '../report/diagram-design.ts'

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
const lines=(s:string,n=7)=>{const chars=[...s];return Array.from({length:Math.ceil(chars.length/n)},(_,i)=>chars.slice(i*n,(i+1)*n).join(''))}
const label=(s:string,x:number,y:number,size:number,color:string,weight=400)=>{const rows=lines(s);return `<text x="${x}" y="${y-(rows.length-1)*size*.57}" text-anchor="middle" dominant-baseline="central" fill="${color}" font-size="${size}" font-weight="${weight}">${rows.map((row,i)=>`<tspan x="${x}" dy="${i?size*1.14:0}">${esc(row)}</tspan>`).join('')}</text>`}

/** DSH owns groups, emphasis and relationships. Geometry never adds or removes edges. */
export function renderEditorialDiagram(graph:PlanningManuscriptDiagram,p:EditorialDiagramPresentation,id:string,subject:string){
  const green='#245b50',muted='#788a80',gold='#b08a43',cycle=p.topology==='cycle',matrix=p.topology==='matrix'
  const columns=matrix?Math.max(...p.groups.map(g=>g.nodeIds.length)):p.groups.length
  const rows=matrix?p.groups.length:Math.max(...p.groups.map(g=>g.nodeIds.length))
  const width=cycle?1040:Math.max(320,columns*276+40),height=cycle?560:Math.max(300,rows*118+140)
  const positions=new Map<string,{x:number;y:number}>(),groupLabels:string[]=[]
  if(cycle){
    const ordered=p.groups.flatMap(g=>g.nodeIds)
    ordered.forEach((node,i)=>{const angle=-Math.PI/2+2*Math.PI*i/ordered.length;positions.set(node,{x:width/2+360*Math.cos(angle),y:height/2+172*Math.sin(angle)})})
    p.groups.forEach((g,i)=>groupLabels.push(label(g.label,width/2,236+i*32,24,muted)))
  }else p.groups.forEach((group,g)=>{
    if(matrix){
      groupLabels.push(label(group.label,150,42+g*118,24,gold))
      group.nodeIds.forEach((node,n)=>positions.set(node,{x:150+n*276,y:100+g*118}))
    }else{
      const x=158+g*276
      groupLabels.push(label(group.label,x,40,26,gold))
      group.nodeIds.forEach((node,n)=>positions.set(node,{x,y:144+(height-204)/Math.max(1,group.nodeIds.length-1)*n+(group.nodeIds.length===1?(height-204)/2:0)}))
    }
  })
  const marker='editorial-'+id.replace(/[^a-zA-Z0-9_-]/g,'-'),primary=new Set(p.primaryNodeIds)
  const edgeLabels:string[]=[]
  const edges=graph.edges.map((e,i)=>{
    const a=positions.get(e.from)!,b=positions.get(e.to)!,main=primary.has(e.from)&&primary.has(e.to),color=main?green:muted
    let d:string,lx:number,ly:number
    if(cycle){
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len
      const inset=Math.min(120,len*.3),sx=a.x+ux*inset,sy=a.y+uy*inset,tx=b.x-ux*inset,ty=b.y-uy*inset
      const cx=(sx+tx)/2+(width/2-(sx+tx)/2)*.16,cy=(sy+ty)/2+(height/2-(sy+ty)/2)*.16
      d=`M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;lx=cx;ly=cy-18
    }else if(b.x>a.x+150){
      const sx=a.x+114,tx=b.x-122,mx=(sx+tx)/2
      d=`M ${sx} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${tx} ${b.y}`;lx=mx;ly=(a.y+b.y)/2-52
    }else if(Math.abs(b.x-a.x)<150){
      const down=b.y>a.y,s=a.y+(down?36:-36),t=b.y+(down?-38:38)
      d=`M ${a.x} ${s} L ${b.x} ${t}`;lx=a.x+74;ly=(s+t)/2
    }else{
      const lane=height-12-i%3*9,sx=a.x+100,tx=b.x-110
      d=`M ${sx} ${a.y+32} C ${sx} ${lane}, ${tx} ${lane}, ${tx} ${b.y+32}`;lx=(sx+tx)/2;ly=lane-18
    }
    if(e.label)edgeLabels.push(`<g data-edge-label="${i}">${label(e.label,lx,ly,24,muted)}</g>`)
    return `<path data-edge-index="${i}" data-edge-from="${esc(e.from)}" data-edge-to="${esc(e.to)}" d="${d}" fill="none" stroke="${color}" stroke-width="${main?2.8:1.6}" ${main?'':'stroke-dasharray="5 5"'} marker-end="url(#${marker})"/>`
  }).join('')
  const nodes=graph.nodes.map(n=>{const v=positions.get(n.id)!,main=primary.has(n.id);return `<g data-node-id="${esc(n.id)}"><circle cx="${v.x-106}" cy="${v.y}" r="${main?6:4}" fill="${main?green:muted}"/>${label(n.label,v.x+9,v.y,30,main?green:'#405e53',main?600:400)}</g>`}).join('')
  return {width,height,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${esc(subject)}</title><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto" markerUnits="userSpaceOnUse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${muted}" stroke-width="1.5"/></marker></defs><g font-family="Microsoft YaHei,Noto Sans CJK SC,sans-serif">${groupLabels.join('')}${edges}${nodes}${edgeLabels.join('')}</g></svg>`}
}
