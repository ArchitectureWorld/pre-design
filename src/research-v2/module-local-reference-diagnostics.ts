const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const fieldKey = (port: unknown, recordId: unknown, field: unknown) => JSON.stringify([port, recordId, field])
const addressKey = (value: Record<string, unknown>) => JSON.stringify([value.port, value.recordId, value.field, value.at])
const address = (value: unknown) => object(value) && ['port','recordId','field','at'].every(key=>typeof value[key]==='string')
  ? {port:value.port as string,recordId:value.recordId as string,field:value.field as string,at:value.at as string} : undefined

/** Bind diagnostic addresses to the rejected author draft, not merged indices.
 * Available addresses are an inventory, never replacement evidence or proof
 * that a dependency supports the owning inference. No field values are copied. */
export function moduleLocalReferenceConflicts(raw: unknown, preceding: readonly unknown[] = []) {
  if (!object(raw) || !Array.isArray(raw.evidence)) return []
  const fields=new Map<string,string>(),claims=new Set<string>(),targets=new Map<string,NonNullable<ReturnType<typeof address>>[]>()
  for(const projection of [...preceding,raw]){
    if(!object(projection))continue
    let outputs=projection.outputs
    if(!object(outputs)&&typeof projection.outputsJson==='string'){try{outputs=JSON.parse(projection.outputsJson)}catch{continue}}
    if(object(outputs))for(const [portName,port] of Object.entries(outputs)){
      if(!object(port)||!Array.isArray(port.records))continue
      for(const record of port.records){
        if(!object(record)||typeof record.recordId!=='string')continue
        for(const [field,value] of Object.entries(record))if(object(value)&&typeof value.claimClass==='string')fields.set(fieldKey(portName,record.recordId,field),value.claimClass)
      }
    }
    if(Array.isArray(projection.evidence))for(const entry of projection.evidence){
      const target=object(entry)?address(entry.target):undefined
      if(!target)continue
      claims.add(addressKey(target));const key=fieldKey(target.port,target.recordId,target.field),registered=targets.get(key)??[]
      if(!registered.some(t=>addressKey(t)===addressKey(target)))registered.push(target)
      targets.set(key,registered)
    }
  }
  const conflicts=[]
  for(const [evidenceIndex,entry] of raw.evidence.entries()){
    if(!object(entry))continue
    const target=address(entry.target);if(!target)continue
    const calculation=object(entry.calculation)?entry.calculation:undefined
    for(const [path,refs] of [['inputRefs',entry.inputRefs],['calculation/operands',calculation?.operands],['calculation/weights',calculation?.weights]] as const){
      if(!Array.isArray(refs))continue
      for(const [refIndex,ref] of refs.entries()){
        const referencedTarget=object(ref)?address(ref.local):undefined;if(!referencedTarget)continue
        const key=fieldKey(referencedTarget.port,referencedTarget.recordId,referencedTarget.field),claimClass=fields.get(key)
        // Unknown later-group declarations remain subject to final compilation.
        if(claimClass===undefined||claimClass!=='missing'&&claims.has(addressKey(referencedTarget)))continue
        conflicts.push({evidenceIndex,target,refPath:path+'/'+refIndex,referencedTarget,referencedFieldClaimClass:claimClass,
          reason:claimClass==='missing'?'field-missing':'exact-address-unavailable',registeredEvidenceTargets:claimClass==='missing'?[]:targets.get(key)??[],
          ...(claimClass==='missing'?{missingPremiseRecovery:{diagnosticOnly:true,
            ownerField:{port:target.port,recordId:target.recordId,field:target.field},
            ownerClaimClass:fields.get(fieldKey(target.port,target.recordId,target.field)),
            missingReferenceIsEvidence:false,emptyInferenceBasisAccepted:false,
            fallbackCondition:'owner-has-no-genuine-supported-basis',fallback:'native-owner-missing-null-and-limitations',
            rule:'引用者是ownerField，不是referencedTarget。被引用字段的missing只是资料未核实标记，不是可支撑本结论的事实claim。先重审引用所属字段的value、claimClass及依据：有其他真实且适用的依据才能保留受支持结论；若没有，按原生Schema由作者将该字段value提交JSON null、claimClass提交missing，说明具体limitations，资料缺口说明也可保留在limitations。不能仅删除inputRefs后保留非空agent_inference，空依据仍被拒绝；也不能把未知字段改标为事实或proposal/assumption，或改引不支持结论的地址过检。missing字段不附evidence，四步fieldRefs不引用无证据字段，未完成步骤如实limited并说明。宿主不改原稿，完整严格校验及独立审查继续。'}}:{})})
        if(conflicts.length===12)return conflicts
      }
    }
  }
  return conflicts
}

/** Diagnostics use only supplied field declarations and evidence addresses.
 * Unknown future fields remain for final compilation; known missing fields
 * never acquire a claim merely because another field tries to cite them. */
export function moduleLocalReferenceDiagnostics(projections: readonly { outputs: unknown; evidence: unknown; groupId?: string }[], groupId?: string): string[] {
  const fields = new Map<string, unknown>(), claims = new Set<string>()
  for (const projection of projections) {
    if (object(projection.outputs)) for (const [portName, port] of Object.entries(projection.outputs)) {
      if (!object(port) || !Array.isArray(port.records)) continue
      for (const record of port.records) {
        if (!object(record) || typeof record.recordId !== 'string') continue
        for (const [field, value] of Object.entries(record)) {
          if (object(value) && typeof value.claimClass === 'string') fields.set(fieldKey(portName, record.recordId, field), value.claimClass)
        }
      }
    }
    if (Array.isArray(projection.evidence)) for (const entry of projection.evidence) {
      if (object(entry) && object(entry.target)) claims.add(addressKey(entry.target))
    }
  }
  const errors: string[] = []
  for (const projection of projections) {
    if (groupId !== undefined && projection.groupId !== groupId || !Array.isArray(projection.evidence)) continue
    for (const [index, entry] of projection.evidence.entries()) {
      if (!object(entry)) continue
      const calculation = object(entry.calculation) ? entry.calculation : undefined
      for (const [path, refs] of [['inputRefs', entry.inputRefs], ['calculation/operands', calculation?.operands], ['calculation/weights', calculation?.weights]] as const) {
        if (!Array.isArray(refs)) continue
        for (const [refIndex, ref] of refs.entries()) {
          if (!object(ref) || !object(ref.local)) continue
          const local = ref.local, key = fieldKey(local.port, local.recordId, local.field)
          if (!fields.has(key) || claims.has(addressKey(local))) continue
          const kind = fields.get(key) === 'missing' ? 'referenced field is missing and has no claim; preserve its missing value and limitations' : 'no evidence claim at this exact address'
          errors.push(`MODULE_PROJECTION_REFERENCE: ${projection.groupId ? `group=${projection.groupId}; ` : ''}/evidence/${index}/${path}/${refIndex}/local target=${JSON.stringify(local)}: ${kind}; do not invent or reclassify evidence to satisfy this reference`)
          if (errors.length >= 12) return [...errors, 'Additional local references may remain invalid; omitted references are not accepted.']
        }
      }
    }
  }
  return errors
}
