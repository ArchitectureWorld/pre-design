import {fail} from './contract.mjs'
const keyPattern=/^[a-f0-9]{64}$/
export async function createReferenceCheckpointStore(db){
 await db.query(`CREATE TABLE IF NOT EXISTS layout_reference_checkpoints(owner_id text NOT NULL,cache_key text NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,cache_key));`)
 return actor=>{
  if(!actor?.id)throw fail('检查点需要登录拥有者。',403)
  const check=key=>{if(!keyPattern.test(key??''))throw fail('检查点编号不合法。',409)}
  const get=async key=>{check(key);const {rows}=await db.query('SELECT record FROM layout_reference_checkpoints WHERE owner_id=$1 AND cache_key=$2',[actor.id,key]);const value=rows[0]?.record;return typeof value==='string'?JSON.parse(value):value}
  return {get,put:async(key,record)=>{
   check(key);if(record?.key!==key||Buffer.byteLength(JSON.stringify(record))>16*1024*1024)throw fail('检查点记录不合法或超过上限。',409)
   await db.query('INSERT INTO layout_reference_checkpoints(owner_id,cache_key,record) VALUES($1,$2,$3) ON CONFLICT(owner_id,cache_key) DO NOTHING',[actor.id,key,record])
   if((await get(key))?.recordHash!==record.recordHash)throw fail('检查点已有不同的完成结果，未覆盖。',409,'REFERENCE_CHECKPOINT_CONFLICT')
  }}
 }
}
