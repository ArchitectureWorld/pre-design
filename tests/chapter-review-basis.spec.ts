import {expect,it} from 'vitest'
import {chapterReviewTaskBasis} from '../src/report/chapter-visual-review.ts'

it('binds page review to the current accepted native visual intent, not an obsolete checklist',()=>{
 const copy:any={id:'closeout',title:'方案收束',claim:'落实空间组织',visual:{subject:'空间组织关系',purpose:'解释三层实施关系'},notes:['测绘、权属、许可人工确认留备注']}
 const task=chapterReviewTaskBasis(copy)
 expect(task).toEqual({authority:'current-native-manuscript',title:'方案收束',judgment:'落实空间组织',visualIntent:{subject:'空间组织关系',purpose:'解释三层实施关系'},internalNotes:['测绘、权属、许可人工确认留备注']})
 expect(task.visualIntent).not.toHaveProperty('notes')
})
it('preserves the accepted visual obligation and never derives a new one from internal notes',()=>{
 const copy:any={title:'三码头',claim:'常态独立成立',visual:{subject:'三张现场照片与主支关系图',purpose:'说明可选水上接口'},notes:['核验许可与通行']}
 const before=JSON.stringify(copy),task=chapterReviewTaskBasis(copy)
 expect(task.visualIntent.subject).toContain('主支关系图')
 expect(task.visualIntent.purpose).not.toContain('许可')
 expect(JSON.stringify(copy)).toBe(before)
})
