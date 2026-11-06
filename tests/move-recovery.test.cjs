const test=require('node:test'),assert=require('node:assert/strict');
global.DXMCore=require('../extension/core.js');global.DXMBatchState=require('../extension/batch-state.js');const Workflow=require('../extension/workflow.js');
function interrupted({missingChild=false,missingParent=false,wrongShop=false,missingClaim=false,scanFailure=false}={}){
  const rows=Array.from({length:21},(_,index)=>({index,source:'https://amazon.com/dp/B0TEST'+String(index).padStart(4,'0'),shop:'Shop',targetShop:'Shop',site:'英国',title:'Title '+index,collectedTitle:'Title '+index,data:{},history:[],status:'待执行',checkpoint:index<10?'claimed':'claim_lookup',...(index<10?{productId:'p'+index,productIds:['p'+index]}:{})}));
  const listing=r=>({id:'p'+r.index,source:r.source,title:r.title,text:'「Shop」英国',editUrl:'https://www.dianxiaomi.com/web/amazon/edit?id=p'+r.index,variantIds:r.index===0?['101','102','103','104']:r.index===1?['105','106']:[]});
  const draft=new Map(rows.slice(3).filter(r=>!missingClaim||r.index<10).map(r=>['p'+r.index,listing(r)])),offline=new Map(rows.slice(0,3).map(r=>['p'+r.index,listing(r)]));
  if(missingChild)offline.get('p1').variantIds=['105'];if(wrongShop)offline.get('p0').text='「Other Shop」英国';
  if(missingParent)offline.delete('p1');
  const childIds=['101','102','103','104','105','106'],job={rows,logs:[{message:'执行结果\n执行成功：3个\n执行失败：6\n'+childIds.map(id=>'产品：'+id+'\u2003失败原因：只能处在采集箱中的产品才能移入待发布！').join('\n')},{message:'父产品已移入；正在待发布列表核对全部子变体，禁止重复移入'}],pendingMove:{ids:['p0','p1','p2'],reconciling:true},pendingStage:'移入待发布',state:'running',options:{}};
  const sent=[];let path='',selected=[];
  const io={save:async()=>{},sleep:async()=>{},closeEditor:async()=>{},waitEditor:async()=>{},open:async url=>{assert.ok(!job.pendingMove||url.endsWith('/offline'));path=url;sent.push({action:'open',url});},call:async(action,args={})=>{
    sent.push({action,args});
    if(['collect','retry','claim'].includes(action))throw new Error('恢复时不应重新采集或认领');
    if(action==='snapshot'){if(scanFailure&&job.pendingMove)throw new Error('列表骨架加载超时');const values=[...(path.endsWith('/draft')?draft:offline).values()];return {rows:values,hasNext:false,signature:JSON.stringify(values.map(r=>r.id))};}
    if(action==='move'){selected=args.ids;assert.ok(selected.every(id=>!['p0','p1','p2'].includes(id)&&draft.has(id)));return {expected:selected.length,childIds:[]};}
    if(action==='moveProgress'){for(const id of selected){offline.set(id,draft.get(id));draft.delete(id);}return {done:true,success:selected.length,failed:0};}
    if(action==='editProduct')return {url:listing(args.record).editUrl};
    if(action==='fill')return {written:['离线测试']};if(action==='preflight')return {checked:[]};if(action==='publishStatus')return {done:true,submitted:true};return {};
  }};
  return {job,sent,run:()=>new Workflow(job,io).run()};
}
test('旧21条批次只恢复3个父产品，恢复11条认领映射，只移入余下18条',async()=>{
  const s=interrupted();await s.run();assert.equal(s.job.state,'done');assert.equal(s.job.rows.filter(r=>r.status==='已发布').length,21);assert.equal(s.job.pendingMove,null);assert.equal(s.job.pendingStage,null);
  const moves=s.sent.filter(e=>e.action==='move');assert.equal(moves.length,1);assert.equal(moves[0].args.ids.length,18);assert.equal(s.sent.filter(e=>e.action==='publish').length,21);
  assert.ok(!s.sent.some(e=>['collect','retry','claim'].includes(e.action)));assert.deepEqual(s.job.rows[0].movedProductIds,['p0']);assert.ok(s.job.logs.some(e=>e.message.includes('已恢复 3 个已移入父产品')));
});
test('旧批次子变体缺失也可恢复，只处理首个父产品',async()=>{
  const s=interrupted({missingChild:true});await s.run();assert.equal(s.job.state,'done');assert.equal(s.job.rows.filter(r=>r.status==='已发布').length,21);assert.equal(s.job.pendingMove,null);
  assert.ok(!s.sent.some(e=>['collect','retry','claim'].includes(e.action)));assert.equal(s.sent.filter(e=>e.action==='move').length,1);
});
test('恢复仍保留父产品缺失或身份不符的保护，不重复移入',async()=>{
  for(const options of [{missingParent:true},{wrongShop:true}]){const s=interrupted(options);await s.run();assert.equal(s.job.state,'review');assert.ok(s.job.pendingMove);assert.ok(!s.sent.some(e=>['move','fill','publish','claim'].includes(e.action)));assert.match(s.job.error,options.missingParent?/缺父产品 p1/:/不符 p0/);}
});
test('旧认领映射确实找不到时保留待核对，不重复认领，其他10条继续',async()=>{
  const s=interrupted({missingClaim:true});await s.run();assert.equal(s.job.rows.filter(r=>r.status==='已发布').length,10);assert.equal(s.job.rows.filter(r=>r.status==='待人工核对').length,11);assert.ok(!s.sent.some(e=>['claim','collect'].includes(e.action)));
});
test('恢复核对的列表加载超时仍保留提交锁，不能把部分列表当成完整结果',async()=>{
  const s=interrupted({scanFailure:true});await s.run();assert.equal(s.job.state,'review');assert.ok(s.job.pendingMove);assert.match(s.job.error,/列表骨架加载超时/);assert.ok(!s.sent.some(e=>['move','fill','publish'].includes(e.action)));
});

test('旧移入保存点包含多个历史父产品时，只恢复首个，不要求其余历史产品存在',async()=>{
  const record={source:'https://amazon.com/dp/B0TEST0000',title:'Title',targetShop:'Shop',site:'英国',productId:'p1',productIds:['p1','history-p1'],checkpoint:'claimed',history:[]};
  const job={rows:[record],logs:[],pendingStage:'移入待发布',pendingMove:{ids:['p1','history-p1'],childIds:['child'],reconciling:true}};
  const calls=[],io={save:async()=>{},open:async url=>calls.push(url),call:async action=>{calls.push(action);return action==='snapshot'?{rows:[{id:'p1',source:record.source,title:'Title',text:'「Shop」英国',variantIds:[]}],hasNext:false}:{};}};
  await new Workflow(job,io).reconcileMove();assert.equal(job.pendingMove,null);assert.equal(record.checkpoint,'offline');assert.deepEqual(record.movedProductIds,['p1']);assert.ok(!calls.includes('move'));
});
test('一页移入确认后立即保存已移入ID，下一页断线不会丢失第一页保存点',async()=>{
  const records=[0,1].map(index=>({productId:'p'+index,productIds:['p'+index],checkpoint:'claimed',history:[]})),job={rows:records,logs:[]};let page=0,selected=[],calls=0;const moved=new Set();
  const io={save:async()=>{},call:async(action,args={})=>{
    if(action==='firstPage')page=0;if(action==='nextPage')page++;
    if(action==='snapshot')return {rows:moved.has('p'+page)?[]:[{id:'p'+page}],hasNext:page===0};
    if(action==='move'){selected=args.ids;calls++;return {expected:1,childIds:[]};}
    if(action==='moveProgress'){if(calls===2)throw new Error('连接中断');selected.forEach(id=>moved.add(id));return {done:true,success:1,failed:0};}return {};
  }};
  await assert.rejects(()=>new Workflow(job,io).pageBatches(records,'productId','move'),error=>error.uncertain);
  assert.equal(records[0].checkpoint,'offline');assert.deepEqual(records[0].movedProductIds,['p0']);assert.equal(records[1].checkpoint,'claimed');assert.deepEqual(job.pendingMove.ids,['p1']);
});
