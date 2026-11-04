// The accepted V0.9 file is the visual source of truth. Do not rewrite its layout/CSS.
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
const root = resolve(import.meta.dirname)
const outputRoot = resolve(process.env.PRE_WEB_BUILD_DIR || resolve(root,'dist'))
const prototype = await readFile(resolve(root, '../index.html'), 'utf8')
const overrides = await readFile(resolve(root, 'src/prototype-api.js'), 'utf8')
const source = prototype.match(/<script>\s*([\s\S]*?)<\/script>/)[1]
const parse = text => ts.createSourceFile('ui.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const preserved = new Set(['goOverview', 'openNewProject'])
const replaced = new Set(parse(overrides).statements.filter(ts.isFunctionDeclaration).map(node => node.name.text))
const original = parse(source)
let script = source
const demoVariables = new Set(['seedTime', 'seededProjects'])
const removes = original.statements.filter(node => ts.isFunctionDeclaration(node) && replaced.has(node.name.text) && !preserved.has(node.name.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.every(declaration => demoVariables.has(declaration.name.getText(original)))
  || node.getText(original).startsWith('(function loadAdministrativeData')).map(node => [node.getStart(original), node.end])
for (const [start, end] of removes.reverse()) script = script.slice(0, start) + script.slice(end)
script=script.replace('function goOverview(', 'function prototypeGoOverview(').replace('function openNewProject(', 'function prototypeOpenNewProject(')
// Only truthful dynamic counts change; graph positioning and rendering remain the prototype's.
script = script.replace('2 节 · 2 份脚本', '${chap.sections.length} 节 · ${chap.sections.length} 份脚本')
script = script.replace('4 章 · 8 节 · 8 份脚本 · ${st.pages} 页成果', '${graphData.length} 章 · ${st.total} 节 · ${st.total} 份脚本 · ${st.pages} 页成果')
script = script.replace('已进入成果工作台 · 本次为交互模拟', '已进入成果工作台')
script = script.replace('未检测到项目资料。请添加真实文件，或点击下方「载入示例并继续」。', '未检测到项目资料，请添加当前项目的真实文件。')
  .replace('缺少项目资料：可选择文件，或载入示例继续体验', '请先选择当前项目的真实资料。')
const css = prototype.match(/<style>([\s\S]*?)<\/style>/)[1]
let html = prototype.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/prototype.css">')
  .replace(/<script>[\s\S]*?<\/script>/, '<script type="module" src="/prototype.js"></script>')
  .replace(/<title>.*?<\/title>/, '<title>Pre-design · Web 工作平台</title>')
  .replace(' 交互演示</div>', ' 本地工作空间</div>')
  .replace('PDF、PPT、Word、Excel、CAD、图片等均可添加', 'CAD请先导出PDF或图像；支持文件夹及其他资料，单文件512 MB')
  .replace('演示账号：策划人员A · 服务器路径自动分配', '项目与资料保存在服务器 · 路径自动分配')
  .replace('项目文件统一保存至服务器 · UI 演示不会真实上传', '原件保存在项目空间 · 先梳理章节，再由你确认')
  .replace('模拟工作流：无网络请求，不会写入服务器磁盘', '资料原样上传并校验 · 基于资料形成章节草案')
  .replace('>模拟执行<', '>建立项目空间<')
  .replace('正在初始化演示工作区', '正在初始化项目空间')
  .replace('项目会话 · 预设 Agent 模型', '项目问询 · 研究与修订')
  .replace('首轮问询</div>','章节梳理与确认</div>')
  .replace('先明确策划方向','一起编排本轮章节')
  .replace('已完成资料分类与研究项对照。只询问现有资料无法确定的关键信息。','拖动调整章节，加入需要的模块。提交后核对资料，再补充或明确跳过缺项。')
// Add a folder picker beside the existing file button, retaining the prototype's styles.
html=html.replace('拖入文件，或点击选择','拖入文件或文件夹，或点击选择').replace(/(<input[^>]+id="(?:createFileInput|chatFileInput)"[^>]*?) accept="[^"]*"/g,'$1')
  .replace(/(<button[^>]+id="chooseFilesBtn"[^>]*>[^<]*<\/button>)/,'$1<button type="button" id="chooseFolderBtn" class="link-like">选择文件夹</button>')
html=html.replace('</body>','<input type="file" id="outlineFileInput" class="hidden" multiple><input type="file" id="createFolderInput" class="hidden" webkitdirectory directory multiple></body>')
html=html.replace(/(<button id="chatAttachBtn"[^>]*>)[\s\S]*?(<\/button>)/,'$1<svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.7" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" stroke-linecap="round" stroke-linejoin="round"/></svg>$2')
html = html.replace('</head>', '<link rel="stylesheet" href="/platform-ui.css"><link rel="stylesheet" href="/admin-ui.css"><link rel="stylesheet" href="/outline-flow.css"><link rel="stylesheet" href="/outline-agent.css"><link rel="stylesheet" href="/workflow-ui.css"><link rel="stylesheet" href="/workflow-graph.css"></head>')
await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
await writeFile(resolve(outputRoot, 'index.html'), html)
await writeFile(resolve(outputRoot, 'prototype.css'), css)
const bootstrap = `
import { mountPlatform } from './platform-ui.js';
import { mountAdminControls } from './admin-ui.js';
globalThis.prePlatform = mountPlatform({
  request: async (path, options = {}) => {
    const response = await fetch('/api' + path, {method:options.method ?? 'GET',headers:{Authorization:'Bearer '+server.token,...(options.body === undefined ? {} : {'Content-Type':'application/json'})},...(options.body === undefined ? {} : {body:JSON.stringify(options.body)})});
    if(!response.ok){const data=await response.json();throw Object.assign(new Error(data.error || '请求失败'),{status:response.status});}
    if(options.download){const disposition=response.headers.get('Content-Disposition') || '';const encoded=disposition.split("filename*=UTF-8''")[1];return {blob:await response.blob(),filename:encoded?decodeURIComponent(encoded):'研究成果'};}
    return response.json();
  },
  mutate, getProject:()=>server.current?.id===state.currentProjectId?server.current:null, getIdentity:()=>api('/me'), notify:toast, mountAdmin:mountAdminControls, openOutline:startConsult,
});
`
await writeFile(resolve(outputRoot, 'prototype.js'), `${overrides}\n${script}\n${bootstrap}`)
for (const name of ['platform-ui.js', 'platform-ui.css', 'admin-ui.js', 'admin-ui.css', 'service-defaults.mjs','outline-view.js','outline-flow.js','outline-drag.js','outline-flow.css','outline-agent.js','outline-agent.css','material-policy.mjs','workflow-ui.js','workflow-ui.css','workflow-content.mjs','workflow-visual-view.mjs','workflow-graph.js','workflow-graph.css','workflow-node-drag.js']) await writeFile(resolve(outputRoot, name), await readFile(resolve(root, 'src', name)))
console.log('Built from web/index.html: original CSS and page structure preserved; API adapter replaces simulated operations.')
