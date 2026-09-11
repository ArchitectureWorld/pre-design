import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${path}: patch target not found`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: patch target is not unique`)
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length))
  console.log(`patched ${path}`)
}

await replaceOnce(
  'tests/full-flow-golden.spec.ts',
`    expect(deck.slideTexts[27]).toContain('多时段内容组合提升设施与空间使用效率')
    expect(deck.slideTexts[27]).toContain('项目证据 9 支撑对应的客户判断。')`,
`    expect(deck.slideTexts[27]).toContain('多时段内容组合提升设施与空间使用效率')
    expect(deck.slideTexts[27]).toContain('家庭、青年与社区居民对全天候共享场景具有重叠需求。')
    expect(deck.slideTexts[27]).toContain('示例人群观察（待项目实测校核）')`,
)

console.log('final deployability golden fix completed')
