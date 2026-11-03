import {assertObjectJsonSchema,type JsonSchemaNode,type ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {materialCorpusFingerprint,type MaterialCorpus} from '../materials/research-evidence.ts'

/** Match the module's prompt source inventory, keeping local originals and
 * its own frozen acquisitions and explicitly supplied source bindings.
 * This is only a schema projection; the full
 * frozen corpus continues to own source verification and historical replay. */
export function moduleNativeSchemaCorpus(corpus:MaterialCorpus,moduleId:string,requiredPaths:readonly string[]=[]):MaterialCorpus {
 const required=new Set(requiredPaths)
 const documents=corpus.documents.filter(document=>!document.provenance
  ||document.provenance.queryKeys.some(key=>key.startsWith(moduleId+':'))||required.has(document.path))
 if(documents.length===corpus.documents.length)return corpus
 const scoped={...corpus,documents}
 return {...scoped,fingerprint:materialCorpusFingerprint(scoped)}
}

/** Native transport may select only exact frozen locations. This does not
 * choose a source, rewrite an author binding or validate its business support;
 * the unchanged central source verifier and independent review still apply. */
export function bindNativeFrozenSourcePaths(schema:ObjectJsonSchema,corpus:Pick<MaterialCorpus,'documents'|'limitations'>):ObjectJsonSchema {
 const bound=structuredClone(schema),evidence=bound.properties?.evidence?.items
 const paths=[...new Set(corpus.documents.map(document=>document.path))]
 if(!evidence||!paths.length)return bound
 const seen=new Set<JsonSchemaNode>()
 const visit=(node:JsonSchemaNode)=>{
  if(seen.has(node))return
  seen.add(node)
  if(node.properties?.path&&node.properties.quote){
   const path=node.properties.path
   // A frozen const already enforces exactly one permitted location. Repeating
   // the entire corpus enum in every exact query branch can exhaust context.
   // Unbound paths (including operands/weights) still need the complete enum;
   // a const outside the corpus retains the rejecting const/enum intersection.
   const exactFrozenPath=typeof path.const==='string'&&paths.includes(path.const)
   node.properties.path={...path,...(exactFrozenPath?{}:{enum:paths}),
    description:(path.description??'')+' 仅可原样选择此Schema允许的完整冻结路径；路径被允许不表示引文、字段值或对象适用性已通过。'}
   if(node.properties.page){
    // Paragraph addresses in the prompt are not physical pages. Bind the
    // optional page member to the same frozen location rules as the central
    // verifier; the native author still owns the path, quote and field value.
    // Group identical page inventories so every path is listed only once.
    const groups=new Map<string,{paths:string[];pages?:number[]}>()
    for(const document of corpus.documents.filter(document=>!exactFrozenPath||document.path===path.const)){
     const pages=document.pages===undefined?undefined:[...new Set(document.pages.map(page=>page.page))].sort((a,b)=>a-b)
     const key=JSON.stringify(pages??null),group=groups.get(key)??{paths:[],...(pages===undefined?{}:{pages})}
     group.paths.push(document.path);groups.set(key,group)
    }
    const branches=[...groups.values()].map(group=>{
     const branch=structuredClone(node),properties=branch.properties!
     properties.path={...properties.path,...(exactFrozenPath?{}:{enum:[...new Set(group.paths)]})}
     const required=(branch.required??[]).filter(key=>key!=='page')
     if(group.pages===undefined){
      delete properties.page;branch.required=required
      properties.path.description+=' 此冻结来源没有物理分页：必须省略source.page；段落号、章节号及网页位置不能作为页码。'
     }else{
      properties.page={...properties.page,enum:group.pages,
       description:'必须选择本路径实际冻结的物理页；段落序号不是物理页。'}
      branch.required=[...required,'page']
     }
     seen.add(branch)
     return branch
    })
    if(branches.length===1)Object.assign(node,branches[0])
    else{
     delete node.type;delete node.properties;delete node.required;delete node.additionalProperties
     node.oneOf=branches
    }
   }
  }
  Object.values(node.properties??{}).forEach(visit)
  if(node.items)visit(node.items)
  node.oneOf?.forEach(visit)
 }
 visit(evidence);assertObjectJsonSchema(bound)
 return bound
}
