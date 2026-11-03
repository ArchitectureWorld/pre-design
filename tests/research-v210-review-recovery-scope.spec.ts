import {it,expect} from 'vitest'
import * as feedback from '../src/research-v2/module-recovery-feedback.ts'
const plan=(checks:any[])=>{const fn=(feedback as any).planModuleReviewRecovery;expect(fn,'独审修订必须有明确范围').toBeTypeOf('function');return fn('3.04',{checks})}
it('单位链的同稿局部问题不补采所有查询',()=>{expect(plan([{status:'limited',criterion:'单位完整',rationale:'原文4.1平方公里已保存；对应claim缺少unit，需在本稿补齐单位'}])).toMatchObject({queryKeys:[],mode:'revision'})})
it('地图检索覆盖缺口只重新检索地图查询',()=>{expect(plan([{status:'limited',criterion:'地图覆盖',rationale:'地图检索范围、上限、翻页/停止依据未获得真实覆盖证明'}])).toMatchObject({queryKeys:['3.04:2'],mode:'sources'})})
it('正式客群缺口要求核对共用输入，不能盲目重搜全部查询',()=>{expect(plan([{status:'limited',criterion:'同一客群',rationale:'没有正式目标客群、需求基准、服务区'}])).toMatchObject({queryKeys:[],mode:'input-review'})})

it('跨来源版本仍向作者传递明确独审问题，不把旧作者作为可复用提交',async()=>{const {moduleRecoveryFeedback}=await import('../src/research-v2/module-recovery-feedback.ts');const text=moduleRecoveryFeedback({priorModuleReview:{bundleRunId:'RUN-origin',snapshotId:'snapshot-origin',resultHash:'old-hash',reviewReceipts:[{executionId:'old-review',childId:'old-review-child',actualModel:{provider:'test',model:'review'},stopReason:'completed',checks:[{criterion:'地图覆盖',status:'limited',rationale:'须记录翻页及停止依据'}],limitations:[]}]}});expect(text).toContain('须记录翻页及停止依据');expect(text).toContain('snapshot-origin');expect(text).toContain('RUN-origin')})

it('同一独审检查包含地图与主体缺口时分别补采，不能漏掉第二个原因',()=>{expect(plan([{status:'limited',criterion:'地图覆盖',rationale:'地图翻页与停止依据缺失；运营主体、基准日状态也未核'}])).toMatchObject({queryKeys:['3.04:0','3.04:2']})})
