import {DESIGN_SPEC_SCHEMA,validateDesignSpec} from './design-spec.mjs'
/** Eligibility is intentionally conservative: never replace a native inheritance graph. */
export function canDeriveComponentDesignSpec(bundle){
 return Array.isArray(bundle?.sources)&&bundle.sources.length>0&&bundle.sources.every(s=>['pdf','image','docx'].includes(s.kind)&&s.native?.masterLayoutGraph==null)
}
/** Platform organization only, NOT an extracted source master/layout hierarchy.
 * Role declarations come from the validated Profile; no new design/style facts. */
export function deriveComponentDesignSpec({profile,scope,fidelity,context={}}){
 const masterLayoutGraph=[],components=[]
 for(const [i,a]of profile.archetypes.entries()){
  const n=i+1,evidenceIds=structuredClone(a.evidenceIds)
  masterLayoutGraph.push({id:'master-'+n,kind:'master',parentId:null,evidenceIds},
   {id:'layout-'+n,kind:'layout',parentId:'master-'+n,archetypeId:a.id,evidenceIds:structuredClone(evidenceIds)},
   {id:'slide-'+n,kind:'slide',parentId:'layout-'+n,evidenceIds:structuredClone(evidenceIds)})
  for(const role of a.roles)components.push({id:'component-'+(components.length+1),kind:'content-slot',role,evidenceIds:structuredClone(evidenceIds)})
 }
 return validateDesignSpec({schemaVersion:DESIGN_SPEC_SCHEMA,scope,fidelity,profile:structuredClone(profile),masterLayoutGraph,components},context)
}
