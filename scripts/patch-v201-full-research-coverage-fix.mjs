import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = resolve(import.meta.dirname, 'apply-v201-full-research-coverage.mjs')
const before = `    required: sourceId === 'project-state-store' && Number(contract.chapter_id) >= 3\n      ? true\n      : sourceId === 'workspace-project-files' && Number(contract.chapter_id) === 2 && allDataPoints.some(point => exactSiteData(fieldByDataPointId.get(point.dataPointId) ?? '', point.dataKind)),`
const after = `    required: sourceId === 'project-state-store' && Number(contract.chapter_id) >= 3\n      ? true\n      : sourceId === 'workspace-project-files' && Number(contract.chapter_id) === 2,`
const text = await readFile(path, 'utf8')
if (!text.includes(before)) throw new Error('V2.0.1 full research generator patch target not found')
await writeFile(path, text.replace(before, after))
console.log('PRE_V2_0_1_FULL_RESEARCH_PATCH_PASS')
