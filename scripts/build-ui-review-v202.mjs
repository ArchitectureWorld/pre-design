import {build} from 'tsdown'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
process.chdir(root)
const out=path.join(root,'work/ui-review-r3-1/bundle')
await mkdir(out,{recursive:true})
await build({config:false,entry:{preview:'preview/ui-review-v202.tsx'},outDir:out,format:'iife',platform:'browser',target:'es2022',minify:true,dts:false,clean:false,fixedExtension:false,
  define:{'process.env.NODE_ENV':'"production"'},deps:{alwaysBundle:()=>true,onlyBundle:false}})
const js=await readFile(path.join(out,'preview.iife.js'),'utf8')
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Pre-Design · 2.0.2 R3.1 · 交互预览</title><style>
html,body,#root{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}body{background:#17213b}#root>.pre-glass{height:calc(100% - 38px)}
.preview-label{box-sizing:border-box;height:38px;padding:0 22px;display:flex;gap:18px;align-items:center;font-size:11px;background:#121a2b;color:#adb9d0}.preview-label details{position:relative;margin-left:auto}.preview-label summary{cursor:pointer}.preview-label details>div{position:absolute;right:0;bottom:30px;width:min(330px,calc(100vw - 44px));padding:16px;background:#202c45;box-shadow:0 12px 36px #0005;border:1px solid #829bc733;border-radius:16px;z-index:100}.preview-label button{font:inherit;margin:4px;padding:8px 11px;border:1px solid #7790bf55;border-radius:12px;background:#25314b;color:#e6eeff;cursor:pointer}.preview-label button[aria-pressed=true]{background:#4a5690}.preview-label p{font-size:11px;line-height:1.7}
</style></head><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`
const destination=path.resolve(process.argv[2]??'work/ui-review-r3-1/pre-V2.0.2-R3.1-preview.html')
await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,html);console.log(destination)
