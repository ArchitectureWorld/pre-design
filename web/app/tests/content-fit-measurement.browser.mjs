import assert from 'node:assert/strict';import {chromium} from 'playwright-core'
import {measureContentFitSlots} from '../src/layout-library/content-fit-measurement.js'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true});try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),results=[]
 for(const [size,scale]of [[1000,1],[1000,.5],[500,1]]){
  await page.setContent(`<article id="page" style="position:relative;container-type:inline-size;width:${size}px;height:${size}px;transform:scale(${scale});transform-origin:0 0"><div data-layout-slot-id="label" style="position:absolute;box-sizing:border-box;left:10%;top:10%;width:10%;height:4%;font-size:2cqw;line-height:1.2;padding:.5cqw;border:.1cqw solid;letter-spacing:.2cqw;overflow:hidden">完整标签内容测试</div><div data-layout-slot-id="body" style="position:absolute;box-sizing:border-box;left:10%;top:30%;width:20%;height:4%;font-size:2cqw;line-height:1.2;padding:.5cqw;border:.1cqw solid;overflow:hidden">完整正文用于检验多行内容高度与边框内边距，不得删改原文。</div></article>`)
  await page.evaluate(()=>document.fonts.ready)
  const value=await page.evaluate(({fn})=>{const measure=(0,eval)('('+fn+')');return measure(document.querySelector('#page'),{canvas:{width:1000,height:1000},policies:[{slotId:'label',direction:'left'},{slotId:'body',direction:'down'}]})},{fn:measureContentFitSlots.toString()})
  assert.equal(await page.locator('[data-layout-slot-id]').count(),2);assert(value.slots[0].requiredWidth>160);assert(value.slots[1].requiredHeight>40);results.push(value)
 }
 for(const r of results.slice(1))for(let i=0;i<2;i++)for(const k of ['requiredWidth','requiredHeight'])assert(Math.abs(r.slots[i][k]-results[0].slots[i][k])<=3,JSON.stringify(results))
 const stable = await page.evaluate(({fn})=>{const m=(0,eval)('('+fn+')'),el=document.querySelector('#page'),body=el.querySelector('[data-layout-slot-id=body]');body.textContent='短文';body.style.height='20%';return m(el,{canvas:{width:1000,height:1000},policies:[{slotId:'body',direction:'down'}]}).slots[0]}, {fn:measureContentFitSlots.toString()});assert.equal(stable.requiredHeight,200);
 const negatives = await page.evaluate(({fn})=>{
 const measure=(0,eval)('('+fn+')'),el=document.querySelector('#page'),policy=[{slotId:'body',direction:'down'}],result=[];
 for(const setup of [()=>({canvas:{width:0,height:1000},policies:policy}),()=>({canvas:{width:1000,height:1000},policies:[...policy,...policy]}),()=>({canvas:{width:1000,height:1000},policies:[{slotId:'missing',direction:'down'}]})]){try{measure(el,setup());result.push(false)}catch{result.push(true)}}
 const body=el.querySelector('[data-layout-slot-id=body]');body.style.transform='rotate(5deg)';try{measure(el,{canvas:{width:1000,height:1000},policies:policy});result.push(false)}catch{result.push(true)}body.style.transform='';
 body.innerHTML='<span style="display:inline-block;transform:scaleX(3);transform-origin:left">abcdefghij</span>';
 try{measure(el,{canvas:{width:1000,height:1000},policies:[{slotId:'body',direction:'left'}]});result.push(false)}catch{result.push(true)}
 return result;
 },{fn:measureContentFitSlots.toString()});assert.deepEqual(negatives,[true,true,true,true,true]);
 console.log(JSON.stringify({passed:true,scales:3,units:'canvas-pixels',results}))
}finally{await browser.close()}
