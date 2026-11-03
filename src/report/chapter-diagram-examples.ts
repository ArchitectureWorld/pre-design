import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { renderPlanningDiagram } from '../presentation/manuscript-diagrams.ts'
import type { PlanningManuscriptDiagram } from './manuscript/types.ts'

export function diagramStyleSamples(){
  const nodes=['a','b','c','d','e','f'].map((id,i)=>({id,label:['内容起点','学习体验','自然观察','在地消费','预约服务','运营支援'][i]!,column:i%3,row:Math.floor(i/3)}))
  const edge=(from:string,to:string,label?:string)=>({from,to,...label?{label}:{}})
  const group=(label:string,nodeIds:string[])=>({label,nodeIds})
  return [
    {title:'顺序 · 横向贯通',graph:{nodes:nodes.slice(0,4),edges:[edge('a','b','进入'),edge('b','c'),edge('c','d','延展')],presentation:{kind:'editorial',topology:'flow',groups:[group('发起',['a']),group('参与',['b','c']),group('转化',['d'])],primaryNodeIds:['a','b','c','d']}}},
    {title:'分流 · 按内容成组',graph:{nodes:nodes.slice(0,4),edges:[edge('a','b'),edge('a','c'),edge('a','d')],presentation:{kind:'editorial',topology:'branch',groups:[group('共同入口',['a']),group('体验选择',['b','c','d'])],primaryNodeIds:['a','b']}}},
    {title:'汇聚 · 多种支持共同交付',graph:{nodes:nodes.slice(0,4),edges:[edge('a','d'),edge('b','d'),edge('c','d')],presentation:{kind:'editorial',topology:'convergence',groups:[group('内容来源',['a','b','c']),group('交付结果',['d'])],primaryNodeIds:['a','d']}}},
    {title:'闭环 · 仅用于真实循环关系',graph:{nodes:nodes.slice(0,4),edges:[edge('a','b'),edge('b','c'),edge('c','d'),edge('d','a')],presentation:{kind:'editorial',topology:'cycle',groups:[group('持续运营',['a','b','c','d'])],primaryNodeIds:['a','b','c','d']}}},
    {title:'矩阵 · 同类对象成行',graph:{nodes,edges:[edge('a','b'),edge('b','c'),edge('d','e'),edge('e','f')],presentation:{kind:'editorial',topology:'matrix',groups:[group('体验组织',['a','b','c']),group('服务支撑',['d','e','f'])],primaryNodeIds:['a','b','c']}}},
  ].map((sample,i)=>({title:sample.title,...renderPlanningDiagram(sample.graph as PlanningManuscriptDiagram,'style-'+i,sample.title)}))
}
/** Development style examples, explicitly unrelated to any project evidence. */
export async function diagramStyleReference(){
  const graph:PlanningManuscriptDiagram={nodes:[{id:'a',label:'起点 A',column:0,row:0,tone:'accent'},
    {id:'b',label:'体验 B',column:1,row:0},{id:'c',label:'体验 C',column:2,row:0},{id:'d',label:'终点 D',column:3,row:0},
    {id:'s',label:'支援 S',column:1,row:1,tone:'muted'}],
    edges:[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'},{from:'a',to:'s',label:'接入'},{from:'s',to:'c',label:'服务'}]}
  const before=renderPlanningDiagram({...graph,edges:graph.edges.map((e,i)=>i<3?{...e,label:'前进'}:e)},'sample-before','图件审美反例')
  const after=renderPlanningDiagram({...graph,presentation:{kind:'primary-secondary',primaryNodeIds:['a','b','c','d'],secondaryNodeIds:['a','s','c'],primaryLabel:'体验主线',secondaryLabel:'支援辅线'}},'sample-after','图件审美正例')
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1120"><rect width="1440" height="1120" fill="#f7f6f1"/><g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" fill="#243f37"><text x="40" y="42" font-size="26">图件审美参照 · 仅为样式示例，不是项目内容</text><text x="40" y="90" font-size="22">反例：等大框体、连线绕行、重复标签、主辅权重接近</text><text x="40" y="640" font-size="22">正例：开放节点、主线贯通、辅线轻量、文字成组、疏密有序</text></g>${before.svg.replace('<svg ', '<svg x="40" y="115" ').replace(/width="[\d.]+" height="[\d.]+"/,'width="1360" height="460"')}${after.svg.replace('<svg ','<svg x="40" y="680" ').replace(/width="[\d.]+" height="[\d.]+"/,'width="1360" height="425"')}</svg>`
  const samples=diagramStyleSamples(),tiles:sharp.OverlayOptions[]=[]
  for(const [i,sample] of samples.entries()){
    const title=Buffer.from(`<svg width="780" height="50"><text x="20" y="32" font-family="Microsoft YaHei" font-size="25" fill="#245b50">${sample.title}</text></svg>`)
    const diagram=await sharp(Buffer.from(sample.svg)).resize(740,480,{fit:'contain',background:'#f7f6f1'}).png().toBuffer()
    tiles.push({input:title,left:(i%2)*800,top:70+Math.floor(i/2)*550},{input:diagram,left:(i%2)*800+20,top:120+Math.floor(i/2)*550})
  }
  // Include a compact historical comparison without making its one topology the only positive sample.
  tiles.push({input:await sharp(Buffer.from(svg)).resize(740,500,{fit:'contain',background:'#f7f6f1'}).png().toBuffer(),left:820,top:1200})
  tiles.push({input:Buffer.from('<svg width="1600" height="60"><text x="24" y="38" font-family="Microsoft YaHei" font-size="28" fill="#245b50">图件结构参照 · 非项目内容 · 按语义选择，不照套同一图</text></svg>'),left:0,top:0})
  const bytes=await sharp({create:{width:1600,height:1740,channels:3,background:'#f7f6f1'}}).composite(tiles).jpeg({quality:94}).toBuffer()
  return {bytes,name:'图件审美正反样例-非项目事实.jpg',sha256:createHash('sha256').update(bytes).digest('hex')}
}
