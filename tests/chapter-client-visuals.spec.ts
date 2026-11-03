import { describe, expect, it } from 'vitest'
import { auditClientVisuals, assertClientVisuals } from '../src/report/chapter-client-visuals.ts'
import type { ChapterPageLayout } from '../src/report/chapter-render.ts'

const asset={id:'scene',width:1600,height:900,visualKind:'scene' as const}
const page=(id:string,x=56):ChapterPageLayout=>({pageId:id,name:'composed',elements:[
  {type:'figure',assetId:'scene',caption:'相关场景',rect:{x,y:210,width:760,height:428}},
  {type:'body',index:0,rect:{x:x<400?870:56,y:240,width:650,height:220}},
]})
describe('client visual requirements',()=>{
  it('rejects a readable diagram-only page and a map masquerading as the required scene',()=>{
    expect(()=>assertClientVisuals(auditClientVisuals([{...page('p'),elements:[]}],[asset]))).toThrow('CHAPTER_SCENE_REQUIRED')
    expect(()=>assertClientVisuals(auditClientVisuals([page('p')],[{...asset,visualKind:'map'}]))).toThrow('CHAPTER_SCENE_REQUIRED')
  })
  it('rejects a thumbnail used to satisfy the image requirement',()=>{
    const p=page('p');(p.elements[0] as any).rect={x:56,y:210,width:100,height:80}
    expect(()=>assertClientVisuals(auditClientVisuals([p],[asset]))).toThrow('CHAPTER_SCENE_TOO_SMALL')
  })
  it('counts actual geometry despite renamed templates and small coordinate changes',()=>{
    const pages=[page('a'),{...page('b',60),name:'renamed'},page('c',64)]
    expect(()=>assertClientVisuals(auditClientVisuals(pages,[asset]))).toThrow('CHAPTER_LAYOUT_THREE_CONSECUTIVE')
  })
  it('accepts two comparable pages followed by a materially different composition',()=>{
    expect(auditClientVisuals([page('a'),page('b'),page('c',784)],[asset]).pass).toBe(true)
  })
  it('rejects three left-image right-text pages despite substantially different image heights',()=>{
    const pages=[page('a'),page('b'),page('c')]
    ;(pages[0]!.elements[0] as any).rect={x:56,y:240,width:760,height:340}
    ;(pages[1]!.elements[0] as any).rect={x:56,y:180,width:650,height:540}
    ;(pages[2]!.elements[0] as any).rect={x:56,y:240,width:720,height:400}
    expect(()=>assertClientVisuals(auditClientVisuals(pages,[asset]))).toThrow('CHAPTER_LAYOUT_THREE_CONSECUTIVE')
  })
  it('checks cross-chapter adjacency while retaining only current findings',()=>{
    expect(()=>assertClientVisuals(auditClientVisuals([page('c')],[asset],[page('a'),page('b')]))).toThrow('CHAPTER_LAYOUT_THREE_CONSECUTIVE')
  })
  it('rejects repeated image-left copy-right with a bottom process despite different photo dimensions',()=>{
    const pages=[page('a'),page('b'),page('c')]
    for(const [i,p] of pages.entries()){
      ;(p.elements[0] as any).rect={x:56,y:210,width:760-i*130,height:428-i*40}
      ;(p.elements as any[]).push({type:'sequence',rect:{x:56,y:700,width:1488,height:160},label:'体验',nodes:[{title:'到达',detail:'说明'},{title:'学习',detail:'参与'}]})
    }
    expect(()=>assertClientVisuals(auditClientVisuals(pages,[asset]))).toThrow('CHAPTER_LAYOUT_THREE_CONSECUTIVE')
  })
  it('distinguishes mirrored image and copy while retaining a bottom process',()=>{
    const pages=[page('a'),page('b'),page('c')]
    for(const p of pages)(p.elements as any[]).push({type:'sequence',rect:{x:56,y:700,width:1488,height:160},label:'体验',nodes:[{title:'到达',detail:'说明'},{title:'学习',detail:'参与'}]})
    ;(pages[2]!.elements[0] as any).rect={x:784,y:210,width:760,height:428}
    ;(pages[2]!.elements[1] as any).rect={x:56,y:240,width:650,height:220}
    expect(auditClientVisuals(pages,[asset]).pass).toBe(true)
  })
  it('does not treat a footer process or a final paragraph below the image as a new primary composition',()=>{
    const pages=[page('a'),page('b'),page('c')]
    for(const p of pages)(p.elements as any[]).push({type:'body',index:1,rect:{x:870,y:490,width:650,height:100}})
    ;(pages[0]!.elements as any[]).push({type:'sequence',rect:{x:56,y:710,width:1488,height:160},label:'组织',nodes:[]})
    ;(pages[1]!.elements as any[]).push({type:'body',index:2,rect:{x:56,y:700,width:1488,height:100}})
    expect(()=>assertClientVisuals(auditClientVisuals(pages,[asset]))).toThrow('CHAPTER_LAYOUT_THREE_CONSECUTIVE')
  })
})
