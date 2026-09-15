import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanWorkspaceSourceInbox } from '../src/presentation/source-inbox.ts'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pre-source-inbox-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Workspace 原始资料 inbox', () => {
  it('缺失时自动创建用户输入目录，并返回空资料而不是要求人工审批', async () => {
    const root = await workspace()
    const result = await scanWorkspaceSourceInbox(root)

    expect(result.inboxRoot).toBe(join(root, '原始资料'))
    expect(result.sourceMaterials).toEqual([])
    expect(result.warnings).toEqual([])
    expect(await readFile(join(root, '原始资料', '.keep')).catch(() => undefined)).toBeUndefined()
  })

  it('递归读取普通文件，生成稳定 sourceKey 与正确 MIME，不修改原件', async () => {
    const root = await workspace()
    await mkdir(join(root, '原始资料', '规划条件'), { recursive: true })
    const pdf = Buffer.from('%PDF-test-source')
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeFile(join(root, '原始资料', '规划条件', '红线.pdf'), pdf)
    await writeFile(join(root, '原始资料', '现场.png'), image)

    const first = await scanWorkspaceSourceInbox(root)
    const second = await scanWorkspaceSourceInbox(root)

    expect(first.sourceMaterials.map(row => ({
      sourceKey: row.sourceKey,
      originalFileName: row.originalFileName,
      mimeType: row.mimeType,
    }))).toEqual([
      {
        sourceKey: 'workspace-inbox:现场.png',
        originalFileName: '现场.png',
        mimeType: 'image/png',
      },
      {
        sourceKey: 'workspace-inbox:规划条件/红线.pdf',
        originalFileName: '红线.pdf',
        mimeType: 'application/pdf',
      },
    ])
    expect(second.sourceMaterials).toEqual(first.sourceMaterials)
    expect(await readFile(join(root, '原始资料', '规划条件', '红线.pdf'))).toEqual(pdf)
    expect(await readFile(join(root, '原始资料', '现场.png'))).toEqual(image)
  })

  it('跳过原始资料内的符号链接并明确记录安全提示', async () => {
    const root = await workspace()
    const outside = await workspace()
    await mkdir(join(root, '原始资料'), { recursive: true })
    await writeFile(join(outside, 'secret.pdf'), '%PDF-outside')
    await symlink(join(outside, 'secret.pdf'), join(root, '原始资料', '外部链接.pdf'))

    const result = await scanWorkspaceSourceInbox(root)

    expect(result.sourceMaterials).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('外部链接.pdf')
    expect(result.warnings[0]).toContain('符号链接')
  })

  it('未知扩展名仍作为 application/octet-stream 原始资料登记', async () => {
    const root = await workspace()
    await mkdir(join(root, '原始资料'), { recursive: true })
    await writeFile(join(root, '原始资料', '厂家资料.binpack'), 'raw')

    const result = await scanWorkspaceSourceInbox(root)

    expect(result.sourceMaterials).toHaveLength(1)
    expect(result.sourceMaterials[0]).toMatchObject({
      sourceKey: 'workspace-inbox:厂家资料.binpack',
      originalFileName: '厂家资料.binpack',
      mimeType: 'application/octet-stream',
    })
  })
})
