import type { ArtifactRecord } from '../governance/types.ts'

export const REPORT_FORMATS: readonly ArtifactRecord['format'][] = ['html', 'pptx', 'pdf']

export interface ReportPackageLinks {
  readonly id: string
  readonly pptx?: string
  readonly pdf?: string
  readonly html?: string
  readonly deliveryMode?: 'formal' | 'conditional'
  readonly sourceRevision?: number
}

export function reportLinkFormats(links: ReportPackageLinks): readonly ArtifactRecord['format'][] {
  if (REPORT_FORMATS.some(format => links[format] !== undefined && typeof links[format] !== 'string')) throw new Error('invalid report link')
  return REPORT_FORMATS.filter(format => typeof links[format] === 'string' && links[format] !== '')
}

export function reportLinks(
  packageId: string,
  metadata: Pick<ReportPackageLinks, 'deliveryMode' | 'sourceRevision'> = {},
  formats: readonly ArtifactRecord['format'][] = [],
): ReportPackageLinks {
  if (!/^[A-Za-z0-9._-]+$/u.test(packageId) || packageId === '.' || packageId === '..') {
    throw new Error('unsafe report package id')
  }
  if (!Array.isArray(formats) || formats.some(format => !REPORT_FORMATS.includes(format))) throw new Error('invalid report formats')
  const root = `/preplan-export/${packageId}`
  return { id: packageId, ...metadata,
    ...(formats.includes('html') ? { html: `${root}/html/index.html` } : {}),
    ...(formats.includes('pptx') ? { pptx: `${root}/report.pptx` } : {}),
    ...(formats.includes('pdf') ? { pdf: `${root}/report.pdf` } : {}),
  }
}
