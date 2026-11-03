import {expect,it} from 'vitest'
import {chapterLayoutTasks} from '../src/report/chapter-layout-input.ts'
it('uses current paragraph and table counts, never historical approvedPage samples',()=>{
 const draft:any={chapter:{pages:[{id:'p',title:'当前标题',body:['一','二','三'],visual:{subject:'当前场景',purpose:'当前判断'}}]}}
 const brief:any={plan:{pages:[{id:'p',title:'旧表标题',content:{question:'如何投入',approvedPage:{body:['旧文'],table:{rows:[['过期金额']]}}}}]}}
 const tasks=chapterLayoutTasks(draft,brief)
 expect(tasks[0]).toMatchObject({authority:'current-native-manuscript',title:'当前标题',bodyIndices:[0,1,2],table:null,visualIntent:{subject:'当前场景'}})
 expect(JSON.stringify(tasks)).not.toMatch(/approvedPage|过期金额|旧文|旧表标题/)
 draft.chapter.pages[0].table={columns:['项','值'],rows:[['本期','100']]}
 expect(chapterLayoutTasks(draft,brief)[0]?.table).toEqual(draft.chapter.pages[0].table)
})
