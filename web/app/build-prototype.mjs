// The accepted V0.9 file is the visual source of truth. Do not rewrite its layout/CSS.
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
const root = resolve(import.meta.dirname)
const prototype = await readFile(resolve(root, '../index.html'), 'utf8')
const overrides = await readFile(resolve(root, 'src/prototype-api.js'), 'utf8')
const source = prototype.match(/<script>\s*([\s\S]*?)<\/script>/)[1]
const parse = text => ts.createSourceFile('ui.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const preserved = new Set(['goOverview', 'openNewProject'])
const replaced = new Set(parse(overrides).statements.filter(ts.isFunctionDeclaration).map(node => node.name.text))
const original = parse(source)
let script = source
const removes = original.statements.filter(node => ts.isFunctionDeclaration(node) && replaced.has(node.name.text) && !preserved.has(node.name.text)
  || node.getText(original).startsWith('(function loadAdministrativeData')).map(node => [node.getStart(original), node.end])
for (const [start, end] of removes.reverse()) script = script.slice(0, start) + script.slice(end)
script=script.replace('function goOverview(', 'function prototypeGoOverview(').replace('function openNewProject(', 'function prototypeOpenNewProject(')
// Only truthful dynamic counts change; graph positioning and rendering remain the prototype's.
script = script.replace('2 节 · 2 份脚本', '${chap.sections.length} 节 · ${chap.sections.length} 份脚本')
script = script.replace('4 章 · 8 节 · 8 份脚本 · ${st.pages} 页成果', '${graphData.length} 章 · ${st.total} 节 · ${st.total} 份脚本 · ${st.pages} 页成果')
script = script.replace('已进入成果工作台 · 本次为交互模拟', '已进入成果工作台')
const css = prototype.match(/<style>([\s\S]*?)<\/style>/)[1]
let html = prototype.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/prototype.css">')
  .replace(/<script>[\s\S]*?<\/script>/, '<script type="module" src="/prototype.js"></script>')
  .replace(/<title>.*?<\/title>/, '<title>Pre-design · Web 工作平台</title>')
  .replace(' 交互演示</div>', ' 本地工作空间</div>')
  .replace('PDF、PPT、Word、Excel、CAD、图片等均可添加', '已接入 PDF、TXT、Markdown、CSV、JSON；其他格式待接入')
  .replace('演示账号：策划人员A · 服务器路径自动分配', '项目与资料保存在服务器 · 路径自动分配')
await rm(resolve(root, 'dist'), { recursive: true, force: true })
await mkdir(resolve(root, 'dist'), { recursive: true })
await writeFile(resolve(root, 'dist/index.html'), html)
await writeFile(resolve(root, 'dist/prototype.css'), css)
await writeFile(resolve(root, 'dist/prototype.js'), `${overrides}\n${script}`)
console.log('Built from web/index.html: original CSS and page structure preserved; API adapter replaces simulated operations.')
