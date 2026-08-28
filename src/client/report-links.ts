export interface ReportPackageLinks {
  readonly id: string
  readonly pptx: string
  readonly pdf: string
  readonly html: string
}

export function reportLinks(packageId: string): ReportPackageLinks {
  if (!/^[A-Za-z0-9._-]+$/u.test(packageId) || packageId === '.' || packageId === '..') {
    throw new Error('unsafe report package id')
  }
  const root = `/preplan-export/${packageId}`
  return { id: packageId, pptx: `${root}/report.pptx`, pdf: `${root}/report.pdf`, html: `${root}/html/index.html` }
}
