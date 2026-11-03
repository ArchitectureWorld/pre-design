import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_REPORT_DELIVERY_CONTRACT } from './delivery-contract.ts'
export interface ReportDeliveryState {
  readonly projectId:string;readonly revision:number;readonly contractVersion:string
  readonly status:'generating'|'pending'|'failed'|'passed';readonly message:string;readonly updatedAt:string
}
export function readReportDeliveryState(root:string,projectId:string):ReportDeliveryState|undefined{
  try{const r=JSON.parse(readFileSync(join(root,'.pre-design/report-delivery-state.json'),'utf8')) as ReportDeliveryState
    return r.projectId===projectId&&r.contractVersion===DEFAULT_REPORT_DELIVERY_CONTRACT.version&&Number.isSafeInteger(r.revision)&&['generating','pending','failed','passed'].includes(r.status)&&typeof r.message==='string'?r:undefined
  }catch{return undefined}
}
export async function writeReportDeliveryState(root:string,projectId:string,revision:number,status:ReportDeliveryState['status'],message:string){
  const directory=join(root,'.pre-design');await mkdir(directory,{recursive:true})
  const path=join(directory,'report-delivery-state.json'),temporary=path+'.tmp-'+randomUUID()
  const record:ReportDeliveryState={projectId,revision,contractVersion:DEFAULT_REPORT_DELIVERY_CONTRACT.version,status,message,updatedAt:new Date().toISOString()}
  await writeFile(temporary,JSON.stringify(record,null,2));await rename(temporary,path);return record
}
