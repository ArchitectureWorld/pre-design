import{fail,SCHEMA}from'./contract.mjs'

// Accept a complete response or one explicit JSON fence. Never choose between
// multiple candidates, salvage truncated JSON, or turn an errored model run into success.
export function decodeLayoutResponse(response){
 const invalid=()=>fail('模型没有返回唯一合法的原生版式JSON，候选未入库。',409)
 if(typeof response!=='string'||response.length>2*1024*1024)throw invalid()
 const text=response.trim()
 try{return JSON.parse(text)}catch{}
 let inside=false,opened=false,closed=false;const body=[],suffix=[]
 for(const line of text.split(/\r?\n/)){
  if(inside){
   if(/^[ \t]*```[ \t]*$/.test(line)){inside=false;closed=true}else body.push(line)
  }else if(/^[ \t]*```(?:json)?[ \t]*$/i.test(line)){
   if(opened)throw invalid();opened=true;inside=true
  }else if(closed){if(/```/.test(line))throw invalid();suffix.push(line)}
  else if(/```|[{}\[\]]/.test(line))throw invalid()
 }
 if(!opened||!closed||inside)throw invalid()
 let value
 try{value=JSON.parse(body.join('\n'))}catch{throw invalid()}
 const tail=suffix.join('\n').trim()
 if(!/[{}\[\]]/.test(tail))return value
 // A native package and a reply-only object are disjoint protocol fields.
 // Multiple candidate packages or competing replies remain ambiguous.
 let reply
 try{reply=JSON.parse(tail)}catch{throw invalid()}
 if(value?.schemaVersion===SCHEMA&&reply&&typeof reply==='object'&&!Array.isArray(reply)&&Object.keys(reply).length===1&&typeof reply.reply==='string')return {package:value,reply:reply.reply}
 throw invalid()
}
