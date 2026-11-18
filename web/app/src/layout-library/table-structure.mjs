/** Header groups are explicit, and may cover only strictly empty cells. */
export function tableHeaderMap(table){
 const invalid=()=>{throw Object.assign(new Error('表头合并越界、重叠或覆盖非空标题。'),{code:'LAYOUT_TABLE_INVALID',statusCode:409})}
 const columns=table?.columns,merges=table?.headerMerges??[],occupied=new Map()
 if(!Array.isArray(columns)||columns.length<2||columns.length>8||columns.some(c=>typeof c!=='string')||!Array.isArray(merges)||merges.length>4)invalid()
 for(const m of merges){
  if(!m||Object.keys(m).some(k=>!['column','colSpan'].includes(k))||!Number.isSafeInteger(m.column)||!Number.isSafeInteger(m.colSpan)||m.column<0||m.colSpan<2||m.column+m.colSpan>columns.length||!columns[m.column].trim())invalid()
  for(let c=m.column;c<m.column+m.colSpan;c++){if(occupied.has(c)||c!==m.column&&columns[c]!=='')invalid();occupied.set(c,c===m.column?m:null)}
 }
 for(let c=0;c<columns.length;c++)if(!columns[c].trim()&&!(occupied.has(c)&&occupied.get(c)===null))invalid()
 return occupied
}
export function expandedTableColumns(table){tableHeaderMap(table);const cols=[...table.columns];for(const m of table.headerMerges??[])for(let c=m.column;c<m.column+m.colSpan;c++)cols[c]=table.columns[m.column];return cols}
/** Declarative body-cell merges. Covered cells must be empty: never hide content. */
export function tableMergeMap(table){
 const invalid=()=>{throw Object.assign(new Error('合并单元格越界、重叠或覆盖了非空内容。'),{code:'LAYOUT_TABLE_INVALID',statusCode:409})}
 if(!Array.isArray(table?.rows)||!Array.isArray(table?.columns)||table.rows.length>40||table.columns.length>8||table.rows.some(r=>!Array.isArray(r)||r.length!==table.columns.length))invalid()
 tableHeaderMap(table)
 const merges=table.merges??[],occupied=new Map()
 if(!Array.isArray(merges)||merges.length>160)invalid()
 for(const m of merges){
  if(!m||Object.keys(m).some(k=>!['row','column','rowSpan','colSpan'].includes(k))||!['row','column','rowSpan','colSpan'].every(k=>Number.isSafeInteger(m[k]))||m.row<0||m.column<0||m.rowSpan<1||m.colSpan<1||m.rowSpan*m.colSpan<2||m.row+m.rowSpan>table.rows.length||m.column+m.colSpan>table.columns.length)invalid()
  for(let row=m.row;row<m.row+m.rowSpan;row++)for(let column=m.column;column<m.column+m.colSpan;column++){
   const key=row+':'+column,anchor=row===m.row&&column===m.column
   if(occupied.has(key)||!anchor&&table.rows[row][column]!=='')invalid()
   occupied.set(key,anchor?m:null)
  }
 }
 return occupied
}
export function renderStructuredTable(table,{className='',columnWidths}={}){
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
 const merged=tableMergeMap(table),headers=tableHeaderMap(table)
 if(columnWidths&&(!Array.isArray(columnWidths)||columnWidths.length!==table.columns.length||columnWidths.some(n=>!Number.isFinite(n)||n<=0||n>1000)))throw Object.assign(new Error('表格列宽必须与真实列数一致。'),{code:'LAYOUT_TABLE_INVALID',statusCode:409})
 const colgroup=columnWidths?'<colgroup>'+columnWidths.map(n=>`<col style="width:${n/columnWidths.reduce((a,b)=>a+b,0)*100}%">`).join('')+'</colgroup>':''

 return `<table${className?' class="'+esc(className)+'"':''}>${colgroup}<thead><tr>${table.columns.map((c,i)=>{if(headers.has(i)&&headers.get(i)===null)return '';const m=headers.get(i);return `<th scope="${m?'colgroup':'col'}"${m?' colspan="'+m.colSpan+'"':''}>${esc(c)}</th>`}).join('')}</tr></thead><tbody>${table.rows.map((row,r)=>`<tr>${row.map((c,col)=>{const key=r+':'+col;if(merged.has(key)&&merged.get(key)===null)return '';const m=merged.get(key);return `<td${m?' rowspan="'+m.rowSpan+'" colspan="'+m.colSpan+'"':''}>${esc(c)}</td>`}).join('')}</tr>`).join('')}</tbody></table>`
}
/** Flat formats repeat the merged anchor value, preserving group membership without mutating source. */
export function expandedTableRows(table){
 tableMergeMap(table)
 const rows=table.rows.map(row=>[...row])
 for(const m of table.merges??[])for(let r=m.row;r<m.row+m.rowSpan;r++)for(let c=m.column;c<m.column+m.colSpan;c++)rows[r][c]=table.rows[m.row][m.column]
 return rows
}
