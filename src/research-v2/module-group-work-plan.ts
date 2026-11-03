import { getModuleAuthorFieldGroups, type ModuleAuthorFieldGroup } from './module-author-groups.ts'

// Prompt responsibilities only. Historical wire plans, evidence, schemas and
// replay remain unchanged; no business value or completion status is supplied.
const stepFields: Readonly<Record<string, readonly (readonly string[])[]>> = {
  '3.05': [
    ['peerId','positioningQuote','productId','formatId','coreProduct','supportingFormats','status','scale','denominator','price','priceKind','pricingUnit','applicableDate','applicableAudience','entitlements','refundTerms'],
    ['productId','formatId','classificationBasis','scale','denominator','price','priceKind','pricingUnit','applicableDate','applicableAudience','entitlements','refundTerms'],
    ['coreProduct','supportingFormats','classificationBasis','scale','denominator','price','priceKind','pricingUnit','applicableDate','applicableAudience','entitlements','refundTerms','advantagesAndGaps'],
    ['peerId','positioningQuote','productId','formatId','coreProduct','supportingFormats','classificationBasis','status','scale','denominator','price','priceKind','pricingUnit','applicableDate','applicableAudience','entitlements','refundTerms','advantagesAndGaps'],
  ],
  '2.04': [
    ['peerId','sampleVersion','relationship'],
    ['scaleBoundary','scale','entranceIds','status'],
    ['outboundOdId','returnOdId','straightMeters','roadMeters','durationSeconds','mode','comparisonBasis'],
    ['peerId','sampleVersion','relationship','comparisonBasis','spatialRelationship'],
  ],
  '3.04': [
    ['projectType','servedNeeds','relationship','selection','selectionReason','coverage'],
    ['peerId','formalName','aliases','operator','address','projectType','servedNeeds','status','statusDate','scale','scaleBasis','discoveryQueries','coverage','blindSpots'],
    ['peerId','formalName','aliases','operator','address','relationship','status','statusDate','scale','scaleBasis','selection','selectionReason','blindSpots'],
    ['peerId','formalName','aliases','operator','address','projectType','servedNeeds','relationship','status','statusDate','scale','scaleBasis','selection','selectionReason','discoveryQueries','coverage','blindSpots'],
  ],
  '2.02': [
    ['nodeId', 'regionId', 'nodeType', 'selectionReason'],
    ['nodeId', 'regionId', 'nodeType', 'geometry', 'representativePointBasis', 'entranceIds', 'scale', 'status'],
    ['relationshipHypothesis', 'relationshipState'],
    ['nodeId', 'regionId', 'nodeType', 'selectionReason', 'relationshipHypothesis', 'geometry', 'representativePointBasis', 'entranceIds', 'scale', 'status', 'relationshipState'],
  ],
  '2.03': [
    ['odId', 'originId', 'destinationId', 'originCoordinate', 'destinationCoordinate'],
    ['mode', 'routeGeometry', 'segmentIds', 'methodVersion', 'collectedAt', 'snapMeters', 'trafficScenario'],
    ['mode', 'distanceType', 'straightMeters', 'roadMeters', 'durationSeconds', 'timeBasis'],
    ['odId', 'originId', 'destinationId', 'originCoordinate', 'destinationCoordinate', 'mode', 'distanceType', 'routeGeometry', 'segmentIds', 'straightMeters', 'roadMeters', 'durationSeconds', 'timeBasis', 'collectedAt', 'trafficScenario', 'snapMeters', 'methodVersion'],
  ],
}

export function moduleGroupWorkPlan(itemId: string, group: ModuleAuthorFieldGroup,plan:readonly ModuleAuthorFieldGroup[]=getModuleAuthorFieldGroups(itemId)) {
  return {
    version: 'module-group-work-plan.v1', groupId: group.groupId, port: group.port,
    assignedFields: [...group.fields],
    ...(group.recordIds?{assignedRecordIds:[...group.recordIds]}:{}),
    otherGroups: plan.filter(row => row.groupId !== group.groupId).map(row => ({
      groupId: row.groupId, port: row.port, fields: [...row.fields],
      ...(row.recordIds?{recordIds:[...row.recordIds]}:{}),
    })),
    stepCoverage: [1, 2, 3, 4].map(step => {
      const fields = group.fields.filter(field => !stepFields[itemId] || stepFields[itemId][step - 1].includes(field))
      return { step, assignedFields: fields, responsibility: fields.length ? 'current-fields-only' : 'dependencies-and-limitations-only' }
    }),
    unresolvedDependencies: 'preserve-limitations-no-substitution',
    completionAuthority: 'merged-candidate-and-independent-review',
  } as const
}

export const moduleGroupWorkPlanProtocol = '按task.workPlan的本组工作分工处理完整task.steps与qa。每步只研究分配给本组的字段；其他组字段只核对已提供的原生值、稳定引用地址和限制，不重新生成。未分配专业字段的步骤仍须提交stepResults，具体说明已核对的依赖和未完成部分，保守记limited；不得用工作分工自动判通过。不能通过反复推演、扩大字段范围或删去限制补足缺失资料。缺失依赖登记具体对象、资料及影响；能完成的本组字段仍按完整Schema提交。引用用最短完整连续原文，保留时点、单位和适用限定词；不重复整份资料。四步汇合、图表、软件计算和全模块验收由完整候选与独立审查核验，未实际执行就明确未执行。'
