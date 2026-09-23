/** Standalone review only. All API data is simulated; no DSH endpoint is contacted. */
import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentClassPanel } from '../src/client/AgentClassPanel.tsx'
import { LiquidGlassShell } from '../src/client/LiquidGlassShell.tsx'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'
import { imageToolForRoute } from '../src/agent-classes/image-tools.ts'
import type { AgentClassView, ClassSettings, ModelRoute } from '../src/agent-classes/types.ts'

const llm = {provider:'preview',model:'gemini-3.8-flash-high'}
const direct = {provider:'preview',model:'gemini-3.1-flash-image'}
const klein = {provider:'Comfyui-PIC',model:'Klein'}
function fixture(mode:string):AgentClassView {
  const image:ModelRoute = mode === 'direct' || mode === 'fallback' ? direct : mode === 'missing' ? klein : {...klein,llm}
  return {
    projectId:'preview-project',settings:{revision:7,routes:{image,web:llm,review:llm,text:llm},...(mode==='fallback'?{fallbacks:{image:[{...klein,llm}]}}:{})},
    catalog:[{provider:'preview',name:'示例 DSH 目录（非实时）',available:true,models:[
      {id:llm.model,name:'Gemini 3.8 Flash'},{id:direct.model,name:'Gemini 3.1 Flash Image'},
      {id:'tool-llm-b',name:'备用 LLM · 示例 B'}
    ]},{provider:klein.provider,name:'ComfyUI',available:true,models:[{id:klein.model,name:'Klein',imageTool:'comfyui_pic'}]}],
    executions:mode==='history' ? [{id:'preview-execution',projectId:'preview-project',parentId:'preview-session',classId:'image',task:'节点鸟瞰图',configurationRevision:7,selected:{...klein,llm},actual:{...klein,llm},routeChain:[{...klein,llm},direct],status:'running',activity:'idle',startedAt:'2026-09-23T00:00:00Z',updatedAt:'2026-09-23T00:01:00Z'}] : [],
  }
}
let snapshot=fixture('tool')
let saves=0
Object.assign(window,{preReview:{get snapshot(){return snapshot},get saves(){return saves}}})
async function request(payload:any,signal:AbortSignal):Promise<AgentClassView> {
  await new Promise(resolve=>setTimeout(resolve,60))
  if(signal.aborted) throw new DOMException('Aborted','AbortError')
  if(payload.action==='save') {
    if(payload.revision!==snapshot.settings.revision) throw new Error('预览：配置版本冲突，请重新载入。')
    const settings:ClassSettings={revision:snapshot.settings.revision+1,routes:payload.routes,fallbacks:payload.fallbacks}
    for(const route of [...Object.values(settings.routes),...Object.values(settings.fallbacks??{}).flat()]) {
      if(route && imageToolForRoute(route) && (!route.llm || imageToolForRoute(route.llm))) throw new Error('预览：Klein 必须选择配套 LLM。')
    }
    snapshot={...snapshot,settings};saves++
  }
  return structuredClone(snapshot)
}
function Preview() {
  const [mode,setMode]=useState('tool')
  const [message,setMessage]=useState('')
  const folder=useCallback(async()=>{setMessage('预览不会打开真实项目文件夹。')},[])
  return <><LiquidGlassShell>
    <PreplanningProjectForm embedded workspaceTitle="shaotanhe" workspacePath="D:\shaotanhe" existingProjectId="preview-project" start={async()=>{throw new Error('预览不启动真实任务')}} openProjectFolder={folder}/>
    <AgentClassPanel key={mode} sessionId="preview-session" request={request}/>
  </LiquidGlassShell><aside className="preview-label"><span>交互预览 · 模拟 DSH 数据</span><details><summary>演示场景</summary><div>
    {[['tool','Klein ＋ LLM'],['direct','普通生图'],['fallback','Klein 备用'],['missing','缺少配套'],['history','执行记录']].map(([id,label])=><button type="button" key={id} aria-pressed={mode===id} onClick={()=>{snapshot=fixture(id);setMode(id);setMessage('')}}>{label}</button>)}
    <p>场景切换会重置演示模型配置，不改变外观；不会请求真实模型、写入项目或修改 DSH。</p>
  </div></details>{message && <span role="status">{message}</span>}</aside></>
}
createRoot(document.getElementById('root')!).render(<Preview/> )
