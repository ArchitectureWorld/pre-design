import type {MaterialCorpusDocument} from '../materials/research-evidence.ts'

export interface SourceCalendarDateMapping {
 readonly kind:'source-calendar-date.v1'
 readonly calendarDateQuote:string
}
const fail=():never=>{throw new Error('MODULE_SOURCE_DATE_MAPPING: explicit complete original calendar date and matching policy date target required; no missing precision or automatic date repair')}

/** An author-declared representation of a complete original calendar date.
 * The ordinary source verifier still checks the original path, hash and page. */
export function verifySourceCalendarDateMapping(source:{rawValue:unknown;quote:string;dateMapping:SourceCalendarDateMapping},document:MaterialCorpusDocument):string {
 const m=source.dateMapping
 if(document.image||m.kind!=='source-calendar-date.v1'||typeof m.calendarDateQuote!=='string')return fail()
 const parts=/^(\d{4})年[ \t]*(\d{1,2})月[ \t]*(\d{1,2})日$/u.exec(m.calendarDateQuote)
 if(!parts||parts[1]==='0000')return fail()
 const position=source.quote.indexOf(m.calendarDateQuote)
 if(position<0||/\d/u.test(source.quote.slice(Math.max(0,position-1),position)))return fail()
 const date=parts[1]+'-'+parts[2].padStart(2,'0')+'-'+parts[3].padStart(2,'0')
 const parsed=new Date(date+'T00:00:00Z')
 if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==date||source.rawValue!==date)return fail()
 return date
}

export function assertSourceCalendarDateMappingTarget(itemId:string,target:{port?:unknown;field?:unknown;at?:unknown}|undefined) {
 if(itemId!=='1.03'||target?.port!=='planning_conditions'||!['publishedDate','effectiveDate','revokedDate'].includes(String(target.field))||target.at!=='')return fail()
}
export function assertSourceCalendarDateMappingClaimTarget(itemId:string,selector:string) {
 if(itemId!=='preplan.research.01.03'||!/^\/outputs\/planning_conditions\/records\/\d+\/(?:publishedDate|effectiveDate|revokedDate)\/value$/u.test(selector))return fail()
}

export const sourceCalendarDateProtocol='1.03的publishedDate、effectiveDate、revokedDate若原文完整日期为中文年月日而字段要求YYYY-MM-DD，必须由原生作者显式提交source.dateMapping={kind:"source-calendar-date.v1",calendarDateQuote:同一quote内完整连续原始年月日}及自己核对的ISO字段值。中央只核对作者声明的完整有效年月日与字段值严格一致，完整原件path/hash/page及quote仍严格核验；不会补值、自动添映射、修改原稿或提供替代日期。仅有年份、年月、无效日期或未核时点保持missing/null；其他字段、照片EXIF、时间戳、相对日期和日期范围不能使用此映射。发布、修订、施行、废止日期不得互换，研究基准日与政策适用性仍须完整专业判断及新独立审查。'
