import { describe, expect, it } from 'vitest'
import {
  classifyFormalAsset,
  classifySourceMaterial,
  planMaterialImport,
  type ExistingMaterialEntry,
} from '../src/presentation/material-plan.ts'

const shaA = 'a'.repeat(64)
const shaB = 'b'.repeat(64)

describe('contract-neutral source material and asset planning', () => {
  it('classifies common source material types deterministically', () => {
    expect(classifySourceMaterial('任务书.pdf', 'application/pdf')).toBe('documents')
    expect(classifySourceMaterial('总平.dwg', 'image/vnd.dwg')).toBe('drawings')
    expect(classifySourceMaterial('现状.JPG', 'image/jpeg')).toBe('images')
    expect(classifySourceMaterial('航拍.mp4', 'video/mp4')).toBe('videos')
    expect(classifySourceMaterial('指标.csv', 'text/csv')).toBe('data')
    expect(classifySourceMaterial('模型.ifc', 'application/x-step')).toBe('models')
    expect(classifySourceMaterial('补充材料.bin', 'application/octet-stream')).toBe('other')
  })

  it('classifies formal assets by semantic role before generic media type', () => {
    expect(classifyFormalAsset('客流.svg', 'image/svg+xml', 'chart')).toBe('charts')
    expect(classifyFormalAsset('空间关系.svg', 'image/svg+xml', 'diagram')).toBe('diagrams')
    expect(classifyFormalAsset('主视觉.webp', 'image/webp')).toBe('images')
    expect(classifyFormalAsset('场景.mp4', 'video/mp4')).toBe('videos')
    expect(classifyFormalAsset('讲解.wav', 'audio/wav')).toBe('audio')
    expect(classifyFormalAsset('附件.dat', 'application/octet-stream')).toBe('other')
  })

  it('rejects a known extension and MIME mismatch instead of silently reclassifying', () => {
    expect(() => classifySourceMaterial('任务书.pdf', 'image/png'))
      .toThrow('PRESENTATION_MATERIAL_MIME_EXTENSION_MISMATCH')
    expect(() => classifyFormalAsset('讲解.mp3', 'video/mp4'))
      .toThrow('PRESENTATION_MATERIAL_MIME_EXTENSION_MISMATCH')
  })

  it('plans a new portable source-material path without leaking source host paths', () => {
    const plan = planMaterialImport({
      domain: 'source-materials',
      category: 'documents',
      originalFileName: ' 项目任务书.pdf ',
      sha256: shaA,
      existingEntries: [],
    })

    expect(plan).toEqual({
      action: 'copy',
      domain: 'source-materials',
      category: 'documents',
      originalFileName: '项目任务书.pdf',
      relativePath: 'source-materials/documents/项目任务书.pdf',
      sha256: shaA,
    })
    expect(Object.keys(plan)).not.toContain('sourcePath')
  })

  it('deduplicates identical content regardless of the incoming file name', () => {
    const existing: ExistingMaterialEntry[] = [{
      objectId: 'source-material-1',
      originalFileName: '原任务书.pdf',
      relativePath: 'source-materials/documents/原任务书.pdf',
      sha256: shaA,
    }]

    expect(planMaterialImport({
      domain: 'source-materials',
      category: 'documents',
      originalFileName: '改名后的任务书.pdf',
      sha256: shaA,
      existingEntries: existing,
    })).toEqual({
      action: 'deduplicate',
      domain: 'source-materials',
      category: 'documents',
      originalFileName: '改名后的任务书.pdf',
      relativePath: 'source-materials/documents/原任务书.pdf',
      sha256: shaA,
      existingObjectId: 'source-material-1',
    })
  })

  it('uses a stable hash suffix for same-name different-content collisions', () => {
    const existing: ExistingMaterialEntry[] = [{
      objectId: 'source-material-1',
      originalFileName: '项目任务书.pdf',
      relativePath: 'source-materials/documents/项目任务书.pdf',
      sha256: shaA,
    }]

    expect(planMaterialImport({
      domain: 'source-materials',
      category: 'documents',
      originalFileName: '项目任务书.pdf',
      sha256: shaB,
      existingEntries: existing,
    }).relativePath).toBe(
      'source-materials/documents/项目任务书~bbbbbbbbbbbb.pdf',
    )
  })

  it('normalizes Unicode file names and rejects path-bearing or unsafe names', () => {
    expect(planMaterialImport({
      domain: 'assets',
      category: 'images',
      originalFileName: 'Cafe\u0301.png',
      sha256: shaA,
      existingEntries: [],
    }).originalFileName).toBe('Café.png')

    for (const unsafe of [
      '../secret.pdf',
      'folder/file.pdf',
      'folder\\file.pdf',
      '.',
      '..',
      'bad\u0000name.pdf',
    ]) {
      expect(() => planMaterialImport({
        domain: 'source-materials',
        category: 'documents',
        originalFileName: unsafe,
        sha256: shaA,
        existingEntries: [],
      }), unsafe).toThrow('PRESENTATION_MATERIAL_FILENAME_INVALID')
    }
  })

  it('rejects duplicate or inconsistent existing index entries', () => {
    expect(() => planMaterialImport({
      domain: 'assets',
      category: 'images',
      originalFileName: 'new.png',
      sha256: shaB,
      existingEntries: [
        {
          objectId: 'asset-1',
          originalFileName: 'a.png',
          relativePath: 'assets/images/a.png',
          sha256: shaA,
        },
        {
          objectId: 'asset-2',
          originalFileName: 'b.png',
          relativePath: 'assets/images/b.png',
          sha256: shaA,
        },
      ],
    })).toThrow('PRESENTATION_MATERIAL_EXISTING_HASH_DUPLICATE')

    expect(() => planMaterialImport({
      domain: 'assets',
      category: 'images',
      originalFileName: 'new.png',
      sha256: shaB,
      existingEntries: [{
        objectId: 'asset-1',
        originalFileName: 'wrong.png',
        relativePath: 'source-materials/images/wrong.png',
        sha256: shaA,
      }],
    })).toThrow('PRESENTATION_MATERIAL_EXISTING_PATH_INVALID')
  })
})
