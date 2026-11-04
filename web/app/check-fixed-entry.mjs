// User-approved production entry: HTTP 4320. Fail visibly instead of moving ports.
import {readFile} from 'node:fs/promises'
try {
 const config=JSON.parse(await readFile(process.env.PRE_WEB_CONFIG,'utf8'))
 if(config.port!==4320 || !['0.0.0.0','192.168.6.45'].includes(config.host)) {
  console.error('固定局域网入口配置不一致：Web 必须使用 HTTP 4320，host 必须为 0.0.0.0 或 192.168.6.45。请修复配置，不要改用其他端口。')
  process.exitCode=78
 }
} catch {
 console.error('无法读取 Web 启动配置，请检查 PRE_WEB_CONFIG 指向的私有 JSON 文件。')
 process.exitCode=78
}
