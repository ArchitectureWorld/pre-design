// Both states use the same fixed surface. Only its bounds move; text is never scaled.
export function mountAnnotationComposer({save,notify}) {
  const surface=document.createElement('div')
  surface.className='annotation-composer'
  surface.hidden=true
  surface.innerHTML=`<div class="annotation-skin" aria-hidden="true"></div><div class="annotation-content"><button type="button" class="annotation-trigger" aria-expanded="false">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14a3 3 0 0 1-3 3H9l-5 4V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/><path d="M8 8h8m-8 4h5"/></svg>
    <span>添加批注</span></button>
    <form class="annotation-form" inert>
      <span class="annotation-target"></span>
      <textarea rows="3" maxlength="5000" aria-label="批注意见" placeholder="输入批注意见…" required></textarea>
      <div class="annotation-actions"><span role="alert"></span><button type="button" data-cancel>取消</button><button type="submit">提交批注</button></div>
    </form></div>`
  const trigger=surface.querySelector('.annotation-trigger'),form=surface.querySelector('form')
  const input=form.querySelector('textarea'),submit=form.querySelector('[type=submit]'),cancel=form.querySelector('[data-cancel]')
  const message=form.querySelector('[role=alert]'),targetLabel=form.querySelector('.annotation-target')
  document.body.append(surface)
  let session=null,closingTimer
  const clamp=(value,min,max)=>Math.min(Math.max(min,max),Math.max(min,value))

  function position() {
    const viewport=window.visualViewport
    const left=(viewport?.offsetLeft??0)+8,top=(viewport?.offsetTop??0)+8
    const right=left+(viewport?.width??window.innerWidth)-16,bottom=top+(viewport?.height??window.innerHeight)-16
    const width=Math.min(336,right-left),height=Math.min(188,bottom-top)
    const chipWidth=Math.min(108,width),chipHeight=Math.min(36,height)
    const {x,y}=session.point
    const opensLeft=x+width>right&&x-left>right-x,opensUp=y+height>bottom&&y-top>bottom-y
    const chipX=clamp(opensLeft?x-chipWidth:x,left,right-chipWidth)
    const chipY=clamp(opensUp?y-(session.point.lineHeight??0)-chipHeight:y,top,bottom-chipHeight)
    const endX=clamp(opensLeft?chipX+chipWidth-width:chipX,left,right-width)
    const endY=clamp(opensUp?chipY+chipHeight-height:chipY,top,bottom-height)
    const dx=chipX-endX,dy=chipY-endY
    surface.style.setProperty('--chip-offset',`translate3d(${dx}px,${dy}px,0)`)
    surface.style.setProperty('--chip-scale',`scale(${chipWidth/width},${chipHeight/height})`)
    surface.style.setProperty('--chip-clip',`inset(${dy}px ${width-dx-chipWidth}px ${height-dy-chipHeight}px ${dx}px round 11px)`)
    surface.style.setProperty('--chip-radius',`${11*width/chipWidth}px / ${11*height/chipHeight}px`)
    Object.assign(surface.style,{left:endX+'px',top:endY+'px',width:width+'px',height:height+'px'})
  }
  function reset({restore=false}={}) {
    clearTimeout(closingTimer)
    const previous=session
    session=null;surface.hidden=true;surface.removeAttribute('role');surface.removeAttribute('aria-label')
    surface.dataset.phase='offer';form.inert=true;trigger.tabIndex=0;trigger.setAttribute('aria-expanded','false')
    if(restore&&previous?.origin?.isConnected)previous.origin.focus?.({preventScroll:true})
  }
  function close(restore) {
    if(!session||session.saving)return
    if(surface.dataset.phase!=='editing'){reset({restore});return}
    surface.dataset.phase='closing';form.inert=true
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches
    closingTimer=setTimeout(()=>reset({restore}),reduced?0:225)
  }
  function updateControls() {
    submit.disabled=session?.saving||!input.value.trim()
    cancel.disabled=!!session?.saving;input.readOnly=!!session?.saving
    submit.textContent=session?.saving?'正在提交…':session?.target.noteId?'保存修改':'提交批注'
  }
  function expand() {
    if(!session||surface.dataset.phase!=='offer')return
    // Commit the small geometry even when a keyboard/toolbar shortcut opens in one task.
    surface.getBoundingClientRect()
    surface.dataset.phase='editing';form.inert=false
    surface.setAttribute('role','dialog');surface.setAttribute('aria-label',trigger.textContent.trim())
    trigger.setAttribute('aria-expanded','true');trigger.tabIndex=-1
    input.focus({preventScroll:true})
  }
  function offer(target,point,origin,{edit=false,focus=true}={}) {
    if(session&&(session.saving||surface.dataset.phase==='editing'&&input.value.trim())){
      input.focus({preventScroll:true});notify('请先提交或取消正在填写的批注。');return
    }
    reset()
    session={target,point,origin,saving:false}
    const host=origin?.closest?.('dialog[open]')??document.body
    if(surface.parentElement!==host)host.append(surface)
    trigger.querySelector('span').textContent=target.noteId?'编辑批注':'添加批注'
    const ref=target.reference
    targetLabel.textContent=ref.kind==='quote'&&ref.excerpt?'“'+ref.excerpt+'”':ref.title
    targetLabel.title=ref.kind==='quote'&&ref.excerpt?ref.title+' · '+ref.excerpt:ref.title
    input.value=target.text??'';message.textContent='';updateControls()
    position();surface.hidden=false
    if(edit)expand();else if(focus)trigger.focus({preventScroll:true})
  }
  trigger.addEventListener('click',expand)
  surface.addEventListener('contextmenu',event=>{if(event.target!==input)event.preventDefault()})
  input.addEventListener('input',()=>{message.textContent='';updateControls()})
  cancel.addEventListener('click',()=>close(true))
  form.addEventListener('submit',async event=>{
    event.preventDefault()
    const current=session,text=input.value.trim()
    if(!current||surface.dataset.phase!=='editing'||current.saving||!text)return
    current.saving=true;updateControls();message.textContent=''
    try{
      await save(current.target,text)
      if(session!==current)return
      current.saving=false;close(true);notify(current.target.noteId?'批注已更新':'已存入批注库')
    }catch(error){
      if(session!==current)return
      current.saving=false;updateControls();message.textContent=error.message||'提交失败，请重试。';input.focus({preventScroll:true})
    }
  })
  document.addEventListener('keydown',event=>{
    if(!session||surface.dataset.phase==='closing'||event.isComposing)return
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true)}
    else if(surface.contains(event.target)){
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&event.target===input){event.preventDefault();form.requestSubmit()}
      // Workspace preview also binds the arrow keys.
      event.stopPropagation()
    }
  },true)
  document.addEventListener('pointerdown',event=>{
    if(!session||surface.contains(event.target)||surface.dataset.phase==='closing'||session.saving)return
    if(surface.dataset.phase==='offer'||!input.value.trim())reset()
  },true)
  document.addEventListener('focusin',event=>{
    if(!surface.contains(event.target))dismissOffer()
  })
  const reposition=()=>{if(session)position()}
  window.addEventListener('resize',reposition)
  window.visualViewport?.addEventListener('resize',reposition)
  window.visualViewport?.addEventListener('scroll',reposition)
  // A selection changing underneath an open editor must never replace a draft.
  function dismissOffer(){if(session&&surface.dataset.phase==='offer')reset()}
  return {offer,reset,dismissOffer}
}
