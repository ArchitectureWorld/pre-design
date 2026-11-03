/** Entirely synthetic fixtures; never publish private project evidence. */
export function peerRequest() {
  const rows = [
    { name:'合成邻里运动馆', address:'合成路1号', status:'operating', positioning:'社区体育与亲子活动', format:'体育培训',
      coordinate:{longitude:114.31,latitude:30.61,crs:'EPSG:4326',entranceStatus:'source-recorded'},
      price:{offer:'成人单次票',basis:'成人单次入场不含课程',currency:'CNY',unit:'元/人次',period:'2026-09',amount:80},
      targetAudience:'亲子家庭', observedAudience:{description:'现场访客以成人为主',sampleSize:12,method:'合成定点观察',period:'2026-09-20'},
      metric:{name:'visits',amount:120,unit:'人次',period:'2026-09-20',denominator:null} },
    { name:'合成滨水活动中心', address:'合成路2号', status:'planned', positioning:'户外休闲',format:'运动休闲',
      price:{offer:'成人单次票',basis:'成人单次入场不含课程',currency:'CNY',unit:'元/人次',period:'2026-09',amount:100} },
    { name:'异地模式参考', address:'外地合成路', status:'operating',format:'文化体验' },
  ]
  const fields = ['name','address','status','positioning','format','coordinate','price','targetAudience','observedAudience','metric']
  return {
    schemaVersion:'peer-research-request.v1',projectId:'project-peers',snapshotId:'snapshot-peer-001',asOf:'2026-09-24',scope:'合成研究范围',
    captures:[{schemaVersion:'research-source-capture.v1',sourceId:'source-peers',label:'合成调查原始记录',locator:'workspace:peers.json',
      observedAt:'2026-09-20T00:00:00Z',retrievedAt:'2026-09-24T00:00:00Z',claimClass:'assumption',rights:'synthetic',
      mediaType:'application/json',content:JSON.stringify({rows}),sha256:''}],
    peers:rows.map((row,i)=>({peerId:`peer-${i+1}`,role:i===2?'reference':'direct',selectionReason:'合成纳入决定，用于验证分类边界',
      claims:fields.filter(f=>f in row).map(field=>({id:`claim-${i}-${field}`,field,value:(row as any)[field],
        sourceId:'source-peers',selector:{type:'json-pointer',pointer:`/rows/${i}/${field}`}}))})),
  }
}
