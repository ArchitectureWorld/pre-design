export function coverageLabel(value){
 if(!value||['totalPages','extractedPages','observedPages','synthesizedPages'].some(key=>!Number.isSafeInteger(value[key])||value[key]<0))return ''
 if(['extractedPages','observedPages','synthesizedPages'].some(key=>value[key]>value.totalPages))return ''
 return `共 ${value.totalPages} 页 · 已提取 ${value.extractedPages} 页 · 已观察 ${value.observedPages} 页 · 已综合 ${value.synthesizedPages} 页`
}
