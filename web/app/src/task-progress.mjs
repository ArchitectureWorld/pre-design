// Public progress is a closed vocabulary. Never copy model text, reasoning,
// tool names/arguments/results, paths, or provider diagnostics into it.
const labels=Object.freeze({
  queued:'等待执行',preparing:'正在准备任务',agent_running:'Agent 已开始处理',
  generating:'正在生成回复',reading_material:'正在读取资料',reading_context:'正在读取项目信息',
  tool_running:'正在执行工具',tool_result:'已收到工具结果',response_received:'已收到模型回复',
  research_running:'正在执行研究',report_running:'正在生成报告',finalizing:'正在保存结果',
  cancelling:'正在取消任务',completed:'任务已完成',partial:'任务部分完成',
  unreviewed:'任务已结束，结果待审阅',failed:'任务执行失败',cancelled:'任务已取消',
  interrupted:'执行中断，结果待检查',recovered:'已恢复实际成果',
})
const activityStages=new Set(['preparing','agent_running','generating','reading_material','reading_context',
  'tool_running','tool_result','response_received','research_running','report_running','finalizing'])

export function taskProgress(stage,now=Date.now()){
  if(typeof stage!=='string'||!Object.hasOwn(labels,stage))return null
  return{stage,label:labels[stage],updatedAt:new Date(now).toISOString()}
}

/** DSH 0.2.1-rc.5: HarnessNotification.params.event is the session event. */
export function agentActivity(notification){
  if(notification?.method!=='session.event')return null
  const event=notification.params?.event
  let stage
  switch(event?.type){
    case'turn/start':stage='agent_running';break
    case'step/start':stage='generating';break
    case'tool/call':
      if(typeof event.data?.name!=='string')return null
      stage=event.data.name==='preplanning_read_material'?'reading_material':
        event.data.name==='preplanning_get_context'?'reading_context':'tool_running'
      break
    case'tool/result':stage='tool_result';break
    case'assistant/message':stage='response_received';break
    default:return null
  }
  return{stage,label:labels[stage]}
}

function publicActivity(value,now){
  let stage=value?.stage
  if(value?.type==='research-progress'||value?.type==='report-progress'){
    stage=value.status==='preparing'?'preparing':value.status==='running'?
      (value.type==='research-progress'?'research_running':'report_running'):null
  }
  // Activity callbacks cannot claim a lifecycle transition or terminal result.
  return activityStages.has(stage)?taskProgress(stage,now):null
}

/** Leading/trailing throttle; repeated activity in one window is coalesced.
 * close() drains accepted writes and discards pending callbacks before the API
 * atomically records a terminal status. Late notifications then do nothing.
 */
export function createTaskProgressReporter({write,intervalMs=1000,now=Date.now,onError=()=>{}}){
  let closed=false,pending,timer,lastStage,lastSentAt=-Infinity,chain=Promise.resolve()
  const clear=()=>{if(timer){clearTimeout(timer);timer=undefined}}
  const dispatch=value=>{
    clear();pending=undefined;lastStage=value.stage;lastSentAt=now()
    chain=chain.then(()=>write(value)).catch(error=>{onError(error)})
  }
  return{
    report(value){
      if(closed)return
      const current=now(),safe=publicActivity(value,current)
      if(!safe)return
      const wait=intervalMs-(current-lastSentAt)
      if(wait<=0){dispatch(safe);return}
      if(safe.stage===lastStage){pending=undefined;clear();return}
      pending=safe
      if(!timer){timer=setTimeout(()=>{timer=undefined;if(!closed&&pending)dispatch(pending)},wait);timer.unref?.()}
    },
    async close(){closed=true;pending=undefined;clear();await chain},
  }
}
