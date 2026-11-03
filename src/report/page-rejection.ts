import type { ReportAcceptanceFinding } from './delivery-contract.ts'

/** A completed check found authored page problems. Infrastructure failures never use this type. */
export class ReportPageRejected extends Error {
  constructor(readonly findings:readonly ReportAcceptanceFinding[],code='REPORT_HTML_REJECTED'){
    super(code+': '+findings.map(f=>`${f.pageId??'HTML'}：${f.message}`).join('；'))
  }
}
