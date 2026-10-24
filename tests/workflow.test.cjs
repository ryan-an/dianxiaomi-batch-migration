const {test}=require('node:test'),assert=require('node:assert/strict');global.DXMCore=require('../extension/core.js');const Workflow=require('../extension/workflow.js');
const product=(i=1)=>({index:i-1,source:`https://www.amazon.com/dp/B0TEST000${i}`,shop:'万万欣UK',targetShop:'万万欣DE',site:'英国',data:{'Model Number':'/01'},title:'',status:'待执行',history:[],error:''});
function scenario(records,options={}){
  const job={rows:records,logs:[],state:'running',options:{modelNameFromNumber:true}};
  let path='',tab='',claimed=false,moved=false,retried=false,editorId='',movePolls=0;const sent=[],sleeps=[],published=new Set();
  const applies=key=>typeof options[key]==='function'?options[key](editorId):options[key];
  const crawl=r=>({id:`c${r.index}`,rowId:`row${r.index}`,source:r.source,title:`Title ${r.index}`,text:`Title ${r.index}`});
  const listing=r=>({id:`p${r.index}`,source:r.source,title:`Title ${r.index}`,text:`Title ${r.index}「万万欣DE」${options.pageSite||'英国'}`,editUrl:`https://www.dianxiaomi.com/web/amazon/edit?id=p${r.index}`,links:[]});
  const io={save:async()=>{},closeEditor:async r=>{assert.equal(r.status,'已发布');sent.push({a:'closeEditor',id:r.productId});},sleep:async ms=>{sleeps.push({ms,after:sent.at(-1)?.a});if(options.now)options.now.value+=ms;if(options.stopDuringWait&&ms===2000)job.stop=true;},waitEditor:async(u,r)=>{sent.push({a:'waitEditor',url:u});assert.equal(editorId,r.productId);},open:async u=>{assert.ok(!job.pendingMove,'结果确认前不能跳转');assert.ok(!u.includes('/amazon/edit?'),'编辑页只能从列表点击进入');sent.push({a:'open',url:u});path=u;editorId=new URL(u).searchParams.get('id');},call:async(a,args={},risky=false)=>{
    sent.push({a,args,risky});
    if(a==='editProduct'){assert.ok(path.endsWith('/offline'));editorId=args.record.productId;path=`https://www.dianxiaomi.com/web/amazon/edit?id=${editorId}`;return {url:path};}
    if(a==='acquisitionTab'){tab=args.name;return {};}
    if(a==='snapshot'){
      let rows=[];
      if(path.includes('productCrawl')){
        if(tab==='全部')rows=options.existing?[crawl(records[0])]:[];
        if(tab==='采集失败'&&options.retry&&!retried)rows=[crawl(records[0]),...(options.historicalFailure?[crawl(records[1]),{...crawl(product(9)),id:'foreign'}]:[])];
        if(tab==='未认领'&&!claimed){rows=records.filter((r,i)=>!(options.retry&&!retried&&i===0)).map(crawl);if(options.crawlAmbiguous)rows.push({...crawl(records[0]),id:'duplicate-crawl'});}
      }else if(path.endsWith('/draft'))rows=claimed&&!moved?records.map(listing):[];
      else if(path.endsWith('/offline'))rows=records.map(listing);
      else if(path.endsWith('/online'))rows=records.filter(r=>published.has(`p${r.index}`)).map(listing);
      if(options.ambiguous&&path.endsWith('/draft'))rows.push({...listing(records[0]),id:'duplicate'});
      return {rows,hasNext:false,signature:JSON.stringify(rows.map(r=>r.id))};
    }
    if(a==='claim'){assert.ok(args.ids.every(x=>x.startsWith('c')));assert.equal(args.shop,'万万欣DE');claimed=true;}
    if(a==='move'){assert.ok(args.ids.every(x=>x.startsWith('p')));return {submitted:true};}
    if(a==='moveProgress'){
      movePolls++;
      if(options.moveDisconnected)throw new Error('进度连接中断');
      if(movePolls<(options.movePolls||1))return {done:false,text:`正在移入 ${movePolls}`};
      moved=true;return {done:true,success:records.length-(options.moveFailed||0),failed:options.moveFailed||0,text:'执行结果'};
    }
    if(a==='retry')retried=true;
    if(a==='progress')return {done:true,text:'已完成',...(options.unknownCounts?{}:{failed:options.retry&&!retried?1:0})};
    if(a==='fill'){assert.equal(args.modelName,'/01');assert.equal(args.continueOnError,true);if(applies('fieldError')){const e=new Error('填写【配送渠道】失败：选项未展开');e.field='配送渠道';e.completedFields=['库存数量清空'];throw e;}return {written:['UPC','FBA'],skipped:options.skipped||[],warnings:options.fieldWarnings||[]};}
    if(a==='preflight'){assert.equal(sleeps.at(-1)?.ms,2000);if(applies('preflightError')){const e=new Error('提交前检查【Model Name】失败：型号名称仍为空');e.field='Model Name';throw e;}return {checked:['制造商','Model Number','Model Name'],repaired:options.repaired||[]};}
    if(a==='publish'){assert.equal(args.record.productId,editorId);if(applies('noClick')){const e=new Error('保存并发布按钮不可点击');e.notSubmitted=true;throw e;}if(applies('uncertain')){const e=new Error('连接断开');e.uncertain=true;throw e;}published.add(editorId);}
    if(a==='publishStatus'){if(applies('statusError'))throw new Error('读取发布结果时连接断开');if(applies('pendingStatus'))return {done:false};if(applies('noConfirmation'))return {done:true};return applies('validation')?{done:true,failed:true,text:'请输入型号名称'}:{done:true,submitted:true};}
    return {};
  }};
  return {job,sent,sleeps,run:()=>new Workflow(job,io).run()};
}
test('分组批量认领和移动，只提交本批次ID，以发布成功弹窗完成',async()=>{const s=scenario([product(1),product(2)]);await s.run();assert.equal(s.job.state,'done');assert.ok(s.job.rows.every(r=>r.status==='已发布'));assert.equal(s.sent.filter(x=>x.a==='collect').length,1);assert.equal(s.sent.find(x=>x.a==='claim').args.ids.length,2);});

test('UK与英国混用仍合并认领批次，页面两种写法均可匹配并发布',async()=>{
  for(const pageSite of ['英国','UK']){
    const s=scenario([{...product(1),site:'UK'},product(2)],{pageSite});await s.run();
    assert.ok(s.job.rows.every(r=>r.status==='已发布'));assert.equal(s.sent.filter(x=>x.a==='claim').length,1);assert.equal(s.sent.find(x=>x.a==='claim').args.ids.length,2);
  }
});

test('提交前等待2秒，检查失败记警告，仍点击发布并以成功弹窗完成',async()=>{
  const s=scenario([product()],{preflightError:true});await s.run();
  assert.equal(s.job.rows[0].status,'已发布');assert.equal(s.job.rows[0].error,'');assert.equal(s.job.rows[0].warnings[0].field,'Model Name');
  assert.deepEqual(s.sleeps,[{ms:2000,after:'fill'}]);assert.equal(s.sent.filter(x=>x.a==='publish').length,1);assert.equal(s.job.pendingStage,null);
  assert.ok(s.job.logs.some(x=>/提交前检查警告（继续执行）/.test(x.message)));assert.ok(!s.job.logs.some(x=>x.message.startsWith('提交前检查通过')));
});

test('提交前补填记录到日志，检查后执行发布',async()=>{
  const s=scenario([product()],{repaired:['制造商','Model Name']});await s.run();
  assert.ok(s.sent.findIndex(x=>x.a==='preflight')<s.sent.findIndex(x=>x.a==='publish'));
  assert.deepEqual(s.job.rows[0].checkedFields,['制造商','Model Number','Model Name']);assert.ok(s.job.logs.some(x=>x.message==='提交前已补填：制造商、Model Name'));
});
test('开始后直接提交整组链接，不在采集前扫描历史或跳过已有来源',async()=>{
  const records=[product(1),product(2)],sources=records.map(r=>r.source),s=scenario(records,{existing:true});await s.run();
  assert.deepEqual(s.sent.slice(0,2).map(x=>x.a),['open','collect']);
  assert.deepEqual(s.sent.find(x=>x.a==='collect').args.sources,sources);
  assert.ok(s.job.rows.every(r=>r.status==='已发布'));
  assert.ok(!s.job.logs.some(x=>/已有采集记录|未重复采集/.test(x.message)));
});
test('采集后来源匹配多条时仍记录失败，不认领、移动或发布',async()=>{
  const s=scenario([product()],{crawlAmbiguous:true});await s.run();
  assert.equal(s.job.rows[0].status,'失败');assert.match(s.job.rows[0].error,/采集链接和标题映射/);
  assert.equal(s.sent.filter(x=>['claim','move','fill','publish'].includes(x.a)).length,0);
});
test('采集失败只重试一次',async()=>{const s=scenario([product()],{retry:true});await s.run();assert.equal(s.sent.filter(x=>x.a==='retry').length,1);assert.equal(s.job.rows[0].retryCount,1);});
test('全部成功时不进入失败列表，也不提交重试',async()=>{
  const s=scenario([product(1),product(2)]);await s.run();
  assert.ok(!s.sent.some(x=>x.a==='retry'||x.a==='acquisitionTab'&&x.args.name==='采集失败'));
  assert.ok(s.job.rows.every(r=>r.status==='已发布'));
});
test('部分失败仅重试失败链接，排除成功来源的历史失败及其他批次',async()=>{
  const s=scenario([product(1),product(2)],{retry:true,historicalFailure:true});await s.run();
  assert.deepEqual(s.sent.filter(x=>x.a==='retry').map(x=>x.args.ids),[['c0']]);
  assert.equal(s.job.rows[1].retryCount,undefined);assert.ok(s.job.rows.every(r=>r.status==='已发布'));
});
test('失败数量未知时不猜测重试',async()=>{
  const s=scenario([product()],{unknownCounts:true});await s.run();
  assert.ok(!s.sent.some(x=>x.a==='retry'));assert.match(s.job.rows[0].error,/失败数量/);
});
test('同链接同店铺的重复产品使流程失败，不执行移入或发布',async()=>{const s=scenario([product()],{ambiguous:true});await s.run();assert.equal(s.job.rows[0].status,'失败');assert.equal(s.sent.filter(x=>['move','publish'].includes(x.a)).length,0);});
test('表单校验错误不算发布成功',async()=>{const s=scenario([product()],{validation:true});await s.run();assert.equal(s.job.rows[0].status,'失败');assert.match(s.job.rows[0].error,/型号名称/);});
test('不存在的字段跳过记录到产品和日志，不误记为本条填写失败',async()=>{
  const s=scenario([product()],{skipped:['Model Name','商品尺寸:长（cm）']});await s.run();
  assert.equal(s.job.rows[0].status,'已发布');assert.deepEqual(s.job.rows[0].skippedFields,['Model Name','商品尺寸:长（cm）']);
  assert.ok(s.job.logs.some(e=>e.message.includes('页面没有这些字段，已跳过：Model Name、商品尺寸:长（cm）')));
});
test('单条提交断线保留编辑页并继续下一条，不重复提交结果不明的产品',async()=>{
  const s=scenario([product(1),product(2)],{uncertain:id=>id==='p0'});await s.run();
  assert.equal(s.job.state,'done');assert.equal(s.sent.filter(x=>x.a==='publish').length,2);assert.equal(s.job.rows[0].status,'待人工核对');assert.equal(s.job.rows[0].publishUncertain,true);assert.equal(s.job.rows[1].status,'已发布');
  assert.equal(s.job.pendingStage,null);assert.equal(s.job.intent,null);assert.deepEqual(s.sent.filter(x=>x.a==='closeEditor').map(x=>x.id),['p1']);
  const count=s.sent.length;await s.run();assert.equal(s.sent.length,count);
});

test('发布结果读取失败和无成功确认只影响本条，均继续下一条',async()=>{
  for(const key of ['statusError','noConfirmation']){
    const s=scenario([product(1),product(2)],{[key]:id=>id==='p0'});await s.run();
    assert.equal(s.job.rows[0].status,'待人工核对');assert.equal(s.job.rows[0].publishUncertain,true);assert.equal(s.job.rows[1].status,'已发布');assert.equal(s.job.pendingStage,null);
  }
});

test('等待发布结果超时保留本条记录后继续下一条',async()=>{
  const now={value:0},realNow=Date.now;Date.now=()=>now.value;
  try{
    const s=scenario([product(1),product(2)],{now,pendingStatus:id=>id==='p0'});await s.run();
    assert.equal(s.job.rows[0].status,'待人工核对');assert.match(s.job.rows[0].error,/结果无法确认/);assert.equal(s.job.rows[1].status,'已发布');assert.equal(s.sent.filter(x=>x.a==='publish').length,2);
  }finally{Date.now=realNow;}
});

test('确认没有点击发布时记失败，继续下一条且允许之后重试',async()=>{
  const s=scenario([product(1),product(2)],{noClick:id=>id==='p0'});await s.run();
  assert.equal(s.job.rows[0].status,'失败');assert.equal(s.job.rows[0].publishUncertain,undefined);assert.equal(s.job.rows[1].status,'已发布');assert.equal(s.job.pendingStage,null);
});

test('等待2秒期间点击停止，不再检查或发布',async()=>{
  const s=scenario([product()],{stopDuringWait:true});await s.run();
  assert.equal(s.job.state,'stopped');assert.ok(!s.sent.some(x=>['preflight','publish'].includes(x.a)));
});

test('检查不通过仍发布，平台实际拒绝只记本条失败后继续下一条',async()=>{
  const s=scenario([product(1),product(2)],{preflightError:true,validation:id=>id==='p0'});await s.run();
  assert.equal(s.job.rows[0].status,'失败');assert.match(s.job.rows[0].error,/请输入型号名称/);assert.equal(s.job.rows[1].status,'已发布');assert.equal(s.sent.filter(x=>x.a==='publish').length,2);
});
test('翻页批量处理排除历史产品，处理后重新从首页定位剩余ID',async()=>{
  const job={rows:[],logs:[],state:'running'},members=[{collectorId:'c1',history:[]},{collectorId:'c2',history:[]}];let page=0;const done=new Set(),batches=[];
  const io={save:async()=>{},closeEditor:async r=>{assert.equal(r.status,'已发布');sent.push({a:'closeEditor',id:r.productId});},call:async(a,arg)=>{
    if(a==='firstPage'){page=0;return {};}
    if(a==='nextPage'){page++;return {};}
    if(a==='snapshot')return {rows:page===0?[{id:'foreign'}]:page===1&&!done.has('c1')?[{id:'c1'},{id:'foreign2'}]:page===2&&!done.has('c2')?[{id:'c2'}]:[],hasNext:page<2,signature:String(page)};
    if(a==='claim'){batches.push(arg.ids);arg.ids.forEach(i=>done.add(i));return {};}
    if(a==='progress')return {done:true,text:'完成'};
    return {};
  }};
  await new Workflow(job,io).pageBatches(members,'collectorId','claim');assert.deepEqual(batches,[['c1'],['c2']]);
});
test('分页不前进时停止，避免漏行或无限循环',async()=>{
  const job={logs:[],rows:[]},io={save:async()=>{},call:async a=>a==='snapshot'?{rows:[],hasNext:true,signature:'same'}:{}};
  await assert.rejects(()=>new Workflow(job,io).scan(),/分页没有前进/);
});
test('移动超过旧版等待时长也持续轮询，最终结果之前不关闭、翻页或跳转',async()=>{
  const s=scenario([product()],{movePolls:50});await s.run();
  assert.equal(s.job.state,'done');assert.equal(s.sent.filter(x=>x.a==='move').length,1);
  const start=s.sent.findIndex(x=>x.a==='move'),close=s.sent.findIndex(x=>x.a==='closeMoveProgress');
  assert.equal(s.sent.slice(start+1,close).length,50);assert.ok(s.sent.slice(start+1,close).every(x=>x.a==='moveProgress'));
  assert.equal(s.sent[close+1].a,'open');assert.match(s.sent[close+1].url,/\/offline$/);assert.equal(s.job.pendingMove,null);
});
test('移动进度断开时保留页面和待核对状态，不发布、不自动再次提交',async()=>{
  const s=scenario([product(1),product(2)],{moveDisconnected:true});await s.run();
  assert.equal(s.job.state,'review');assert.ok(s.job.pendingMove);assert.ok(s.job.rows.every(r=>r.status==='待人工核对'));
  const after=s.sent.slice(s.sent.findIndex(x=>x.a==='move')+1);assert.deepEqual(after.map(x=>x.a),['moveProgress']);
});
test('移动最终结果有失败时保留弹窗，不把部分成功当全成功',async()=>{
  const s=scenario([product(1),product(2)],{moveFailed:1});await s.run();
  assert.equal(s.job.state,'review');assert.match(s.job.error,/成功 1，失败 1/);assert.ok(s.job.pendingMove);
  assert.equal(s.sent.filter(x=>x.a==='closeMoveProgress'||x.a==='publish').length,0);
});
test('移动15分钟未结束时停止轮询，不关闭弹窗或执行任何跳转',async()=>{
  const job={logs:[],rows:[],state:'running'},members=[{productId:'p1',history:[]}],sent=[];let now=0;
  const realNow=Date.now;Date.now=()=>now;
  try{
    const io={save:async()=>{},closeEditor:async r=>{assert.equal(r.status,'已发布');sent.push({a:'closeEditor',id:r.productId});},sleep:async ms=>{now+=ms;},call:async a=>{sent.push(a);if(a==='snapshot')return {rows:[{id:'p1'}],hasNext:false};if(a==='moveProgress')return {done:false,text:'进行中'};return {};}};
    await assert.rejects(()=>new Workflow(job,io).pageBatches(members,'productId','move'),e=>e.uncertain&&/15分钟/.test(e.message));
    assert.ok(job.pendingMove);assert.equal(sent.filter(x=>x==='move').length,1);assert.ok(!sent.includes('closeMoveProgress'));
  }finally{Date.now=realNow;}
});
test('填写失败保留具体字段与已填字段为警告，仍检查并提交发布',async()=>{
  const s=scenario([product()],{fieldError:true});await s.run();const row=s.job.rows[0];
  assert.equal(row.status,'已发布');assert.equal(row.warnings[0].field,'配送渠道');assert.deepEqual(row.warnings[0].completedFields,['库存数量清空']);assert.match(row.warnings[0].message,/配送渠道/);assert.equal(s.sent.filter(m=>m.a==='publish').length,1);
});

test('逐字段填写返回的警告保留，继续预检与发布',async()=>{
  const warnings=[{field:'Model Number',message:'型号输入框被禁用',completedFields:['UPC']}],s=scenario([product()],{fieldWarnings:warnings});await s.run();
  assert.equal(s.job.rows[0].status,'已发布');assert.equal(s.job.rows[0].warnings[0].field,'Model Number');assert.ok(s.job.logs.some(x=>x.message.includes('型号输入框被禁用')));
});
test('填写失败后继续：保留日志与产品ID，不再采集、认领或移动',async()=>{
  const options={fieldError:true,validation:true},s=scenario([product()],options);await s.run();
  assert.equal(s.job.rows[0].checkpoint,'offline');const start=s.sent.length,logs=s.job.logs.length;
  options.fieldError=false;options.validation=false;s.job.rows[0].status='待执行';s.job.rows[0].error='';s.job.state='running';await s.run();
  assert.equal(s.job.rows[0].status,'已发布');assert.ok(s.job.logs.length>logs);
  assert.ok(!s.sent.slice(start).some(x=>['collect','claim','move'].includes(x.a)));
});
test('从采集完成的保存点继续，只认领后续步骤',async()=>{
  const r=product();Object.assign(r,{collectorId:'c0',title:'Title 0',checkpoint:'collected'});
  const s=scenario([r]);await s.run();assert.equal(r.status,'已发布');
  assert.ok(!s.sent.some(x=>x.a==='collect'));assert.equal(s.sent.filter(x=>x.a==='claim').length,1);
});
test('已经上线再次继续不会重复发布或采集',async()=>{
  const s=scenario([product()]);await s.run();const n=s.sent.length;await s.run();
  assert.equal(s.sent.length,n);assert.equal(s.job.rows[0].status,'已发布');
});
test('每个产品都返回待发布按标题查找并点击编辑，不直接跳转编辑URL',async()=>{
  const s=scenario([product(1),product(2)]);await s.run();assert.ok(s.job.rows.every(r=>r.status==='已发布'));
  const edits=s.sent.map((x,i)=>x.a==='editProduct'?i:-1).filter(i=>i>=0);assert.equal(edits.length,2);
  for(const i of edits){const previous=s.sent.slice(0,i),lastOpen=previous.findLastIndex(x=>x.a==='open');assert.match(previous[lastOpen].url,/\/offline$/);assert.ok(previous.slice(lastOpen).some(x=>x.a==='searchTitle'&&x.args.title===s.sent[i].args.record.title));assert.equal(s.sent[i+1].a,'waitEditor');assert.equal(s.sent[i+2].a,'fill');}
});
test('成功弹窗即完成并关闭编辑页，下一条之前关闭，不读取在线或发布失败列表',async()=>{
  const s=scenario([product(1),product(2)]);await s.run();
  assert.ok(s.job.rows.every(r=>r.status==='已发布'&&r.checkpoint==='published'));
  assert.deepEqual(s.sent.filter(x=>x.a==='closeEditor').map(x=>x.id),['p0','p1']);
  assert.ok(s.sent.findIndex(x=>x.a==='closeEditor')<s.sent.findIndex(x=>x.a==='editProduct'&&x.args.record.productId==='p1'));
  assert.ok(!s.sent.some(x=>x.a==='listState'||x.url?.endsWith('/online')));
});
test('旧待确认记录继续时直接完成，不重复提交也不查询在线',async()=>{
  const r=product();r.status='已提交待确认';r.checkpoint='submitted';const s=scenario([r]);await s.run();
  assert.equal(r.status,'已发布');assert.equal(s.sent.length,0);
});
