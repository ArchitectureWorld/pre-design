/** Test-only adapters. SQLite is an offline persistence harness, NOT proof of PostgreSQL behavior.
 * Set PRE_DOSSIER_TEST_DATABASE to a JSON PostgreSQL config to run identical repository tests on PostgreSQL.
 */
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
const jsonKeys=new Set(['metadata','payload','query','response','image','reference','result','progress','state']);
export async function createTestDb(){
 if(process.env.PRE_DOSSIER_TEST_DATABASE){
  const {default:pg}=await import('pg'),config=JSON.parse(process.env.PRE_DOSSIER_TEST_DATABASE),admin=new pg.Pool(config),schema='dossier_test_'+randomBytes(8).toString('hex');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db=new pg.Pool({...config,max:4,options:`${config.options??''} -c search_path=${schema}`.trim()});
  return {db,engine:'postgresql',close:async()=>{await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
 }
 const {DatabaseSync}=await import('node:sqlite');
 const dir=await mkdtemp(join(tmpdir(),'pre-dossier-test-')),filename=join(dir,'test.sqlite');let native=new DatabaseSync(filename),tail=Promise.resolve();
 native.function('now',()=>new Date().toISOString());
 function query(sql,params=[]){
  if(/pg_advisory_xact_lock/.test(sql))return {rows:[]};
  let indices=[];sql=sql.replace(/\$(\d+)/g,(_s,n)=>{indices.push(Number(n)-1);return '?';}).replace(/ FOR (?:UPDATE|SHARE)/gi,'').replace(/DEFAULT now\(\)/gi,"DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  const args=indices.map(i=>{const v=params[i];return v==null?null:v instanceof Date?v.toISOString():typeof v==='object'?JSON.stringify(v):typeof v==='boolean'?Number(v):v;});
  if(!params.length&&(!/^\s*(SELECT|UPDATE|INSERT|DELETE)/i.test(sql)||sql.trim().split(';').filter(Boolean).length>1)){native.exec(sql);return {rows:[]};}
  const statement=native.prepare(sql);
  if(/^\s*SELECT/i.test(sql)||/RETURNING/i.test(sql))return {rows:statement.all(...args).map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,jsonKeys.has(k)&&typeof v==='string'?JSON.parse(v):v])))};
  const info=statement.run(...args);return {rows:[],rowCount:Number(info.changes)};
 }
 const db={
  async connect(){const old=tail;let unlock;tail=new Promise(r=>unlock=r);await old;let released=false;return {query:async(sql,args)=>query(sql,args),release(){if(!released){released=true;unlock();}}};},
  async query(sql,args){const c=await db.connect();try{return await c.query(sql,args);}finally{c.release();}},
 };
 return {db,engine:'sqlite-offline-harness',filename,reopen(){native.close();native=new DatabaseSync(filename);native.function('now',()=>new Date().toISOString());},close:async()=>{native.close();await rm(dir,{recursive:true,force:true});}};
}
export async function createBaseTables(db){await db.query(`
CREATE TABLE projects(id uuid PRIMARY KEY,name text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}');
CREATE TABLE materials(id uuid PRIMARY KEY,project_id uuid,filename text,path text,sha256 text,bytes integer,image jsonb,relative_path text);
CREATE TABLE jobs(id uuid PRIMARY KEY,project_id uuid,kind text,payload jsonb,status text,result jsonb,progress jsonb,error text,created_at timestamptz DEFAULT now(),started_at timestamptz,finished_at timestamptz);
CREATE TABLE annotations(id uuid PRIMARY KEY,project_id uuid,text text,anchor text,status text,reference jsonb,created_at timestamptz DEFAULT now());
`);}
