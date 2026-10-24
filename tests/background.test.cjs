const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function boot({failSave=false,noTabs=false,rejectRun=false,previous=null,navigation=null,extraData={},clearFailure='',clearGate=null,allTabs=null,tabsApi=null}={}){
  const data={...extraData,dxmJob:previous},tasks=[],sent=[],badges=[],created=[],updates=[],clears=[],syncData={oldSyncSetting:1},sessionData={oldSessionState:1};let listener,action;
  const clear=async(name,storage)=>{clears.push(name);if(name==='local'&&clearGate)await clearGate();if(clearFailure===name)throw new Error('模拟清理失败');for(const key of Object.keys(storage))delete storage[key];};
  const next=list=>list.length>1?list.shift():list[0];
  const context=vm.createContext({URL,structuredClone,console,crypto:{randomUUID:()=> 'local-run'},setTimeout:(fn,ms)=>ms?queueMicrotask(fn):tasks.push(fn)});
  context.chrome={action:{onClicked:{addListener:fn=>action=fn},setBadgeText:async v=>badges.push(v),setTitle:async()=>{}},storage:{local:{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>{if(failSave)throw new Error('存储空间不足');Object.assign(data,structuredClone(value));}}},runtime:{onMessage:{addListener:fn=>listener=fn}},tabs:{query:async filter=>noTabs?[]:filter.url?[{id:101,url:'https://www.dianxiaomi.com/web/amazon/pageList/draft'}]:[{id:101,url:'https://www.dianxiaomi.com/web/amazon/pageList/draft'}],get:async id=>navigation?{id,...next(navigation.tabs)}:{id,url:'https://www.dianxiaomi.com/web/amazon/pageList/draft'},update:async(id,args)=>updates.push({id,...args}),create:async v=>created.push(v),sendMessage:async(id,m)=>{sent.push({id,...m});return m.action==='ready'&&navigation?{ok:true,data:next(navigation.ready)}:{ok:true};},onRemoved:{addListener:()=>{}}}};
  context.chrome.storage.local.clear=()=>clear('local',data);context.chrome.storage.sync={clear:()=>clear('sync',syncData)};context.chrome.storage.session={clear:()=>clear('session',sessionData)};
  if(allTabs)context.chrome.tabs.query=async filter=>filter.url?allTabs:[allTabs[0]];
  if(tabsApi)Object.assign(context.chrome.tabs,tabsApi);
  context.importScripts=(...names)=>{for(const name of names){if(name==='workflow.js'){context.DXMWorkflow=class{constructor(job){this.job=job;}async run(){if(rejectRun)throw new Error('存储失败');this.job.state=this.job.stop?'stopped':'done';}};}else vm.runInContext(fs.readFileSync(path.join('extension',name),'utf8'),context,{filename:name});}};
  vm.runInContext(fs.readFileSync('extension/background.js','utf8'),context,{filename:'background.js'});
  return {data,tasks,sent,badges,created,updates,clears,syncData,sessionData,closeEditor:record=>vm.runInContext('io',context).closeEditor(record),waitEditor:(url,record,before)=>vm.runInContext('io',context).waitEditor(url,record,before),open:(url,record)=>vm.runInContext('io',context).open(url,record),click:tab=>action(tab),send:(m,tab)=>new Promise(resolve=>listener(m,tab?{tab}:{},r=>resolve(structuredClone(r))))};
}
const rows=()=>[1,2].map(i=>({source:`https://www.amazon.com/dp/B0TEST000${i}`,shop:'万万欣UK',site:'英国',targetShop:'旧的错误映射',data:{},error:'',status:'待执行'}));

test('新批次与恢复批次中的UK均按英国重新匹配店铺',async()=>{
  for(const continuing of [false,true]){
    const records=rows();records[0].site='UK';
    const b=boot({previous:continuing?{state:'stopped',rows:records,logs:[]}:null});
    assert.equal((await b.send({kind:'DXM_START',rows:records})).ok,true);
    const job=(await b.send({kind:'DXM_STATUS'})).job;
    assert.ok(job.rows.every(r=>r.site==='英国'&&r.targetShop==='万万欣DE'));
  }
});
test('发布成功关闭编辑标签前先保存完成记录并切换工作标签，避免误触停止',async()=>{
  const record={productId:'p1',status:'已发布'},removed=[],url='https://www.dianxiaomi.com/web/amazon/pageList/offline';
  const b=boot({previous:{state:'done',tabId:202,listTabId:101,rows:[record]},tabsApi:{get:async id=>({id,url:id===202?'https://www.dianxiaomi.com/web/amazon/edit?id=p1':url}),remove:async id=>{assert.equal(b.data.dxmJob.tabId,101);assert.equal(b.data.dxmJob.rows[0].status,'已发布');removed.push(id);}}});
  await b.send({kind:'DXM_STATUS'});await b.closeEditor(record);assert.deepEqual(removed,[202]);assert.deepEqual(b.updates,[{id:101,active:true}]);
  await assert.rejects(()=>b.closeEditor({productId:'p1',status:'失败'}),/未收到发布成功/);
});
test('旧版已提交待确认记录恢复为已发布，不再等待在线确认',async()=>{
  const b=boot({previous:{state:'error',rows:[{status:'已提交待确认',error:''}],logs:[]}});const status=await b.send({kind:'DXM_STATUS'});
  assert.equal(status.job.rows[0].status,'已发布');assert.equal(status.job.rows[0].checkpoint,'published');assert.equal(b.sent.length,0);
});
test('发布失败后切回保留的待发布标签，不刷新或导航失败编辑页',async()=>{
  const url='https://www.dianxiaomi.com/web/amazon/pageList/offline',editor='https://www.dianxiaomi.com/web/amazon/edit?id=p1';
  const tabs={101:{id:101,url,status:'complete'},202:{id:202,url:editor,status:'complete'}};
  const b=boot({previous:{state:'done',tabId:202,listTabId:101,rows:[]},navigation:{ready:[{url}]},tabsApi:{get:async id=>tabs[id]}});
  await b.send({kind:'DXM_STATUS'});await b.open(url);
  assert.equal(b.data.dxmJob.tabId,101);assert.deepEqual(b.updates,[{id:101,active:true}]);assert.equal(b.created.length,0);
});
test('从孤立的失败编辑页另开列表，原编辑页保持不动',async()=>{
  const url='https://www.dianxiaomi.com/web/amazon/pageList/offline',created=[];
  const b=boot({previous:{state:'done',tabId:202,rows:[]},navigation:{ready:[{url}]},tabsApi:{get:async id=>({id,url:id===202?'https://www.dianxiaomi.com/web/amazon/edit?id=p1':url,status:'complete'}),create:async args=>{created.push(args);return {id:303,url};}}});
  await b.send({kind:'DXM_STATUS'});await b.open(url);
  assert.equal(created.length,1);assert.equal(created[0].url,url);assert.equal(b.data.dxmJob.tabId,303);assert.ok(!b.updates.some(x=>x.id===202));
});
test('点击编辑后接管新开的对应标签，排除点击前已存在的同产品标签',async()=>{
  const url='https://www.dianxiaomi.com/web/amazon/edit?id=p1',record={productId:'p1',source:rows()[0].source};
  const tabs=[{id:101,url:'https://www.dianxiaomi.com/web/amazon/pageList/offline',status:'complete'},{id:202,url,status:'complete'},{id:303,url,status:'complete',openerTabId:101}];
  const b=boot({previous:{state:'done',tabId:101,listTabId:101,rows:[]},navigation:{ready:[{url,source:record.source}]},tabsApi:{get:async id=>tabs.find(t=>t.id===id),query:async()=>tabs}});
  await b.send({kind:'DXM_STATUS'});await b.waitEditor(url,record,[101,202]);
  assert.equal(b.data.dxmJob.tabId,303);assert.deepEqual(b.updates,[{id:303,active:true}]);assert.equal(b.created.length,0);
});
test('点击编辑后仅等待目标表单就绪，不用tabs.update直接导航',async()=>{
  const url='https://www.dianxiaomi.com/web/amazon/edit?id=184807703384729919',record={productId:'184807703384729919',source:rows()[0].source};
  const b=boot({previous:{state:'stopped',tabId:101,rows:[]},navigation:{tabs:[{url,status:'complete'}],ready:[{url,source:record.source}]}});await b.send({kind:'DXM_STATUS'});
  await b.waitEditor(url,record);assert.equal(b.updates.length,0);assert.equal(b.sent[0].action,'ready');assert.equal(b.sent[0].args.record.productId,record.productId);
});
test('同表继续保留保存点、历史日志与上线状态，不使用上传的空白行重建任务',async()=>{
  const rs=rows();Object.assign(rs[0],{status:'已上线',productId:'p0',history:[]});Object.assign(rs[1],{status:'失败',checkpoint:'offline',productId:'p1',history:[],error:'字段失败'});
  const previous={id:'old',state:'done',rows:rs,logs:[{message:'旧日志'}],options:{},startedAt:'original'};
  const b=boot({previous});assert.equal((await b.send({kind:'DXM_START',rows:rows()})).ok,true);
  const saved=b.data.dxmJob;assert.equal(saved.rows[0].status,'已上线');assert.equal(saved.rows[1].checkpoint,'offline');assert.equal(saved.rows[1].status,'待执行');assert.equal(saved.rows[1].productId,'p1');assert.equal(saved.logs[0].message,'旧日志');assert.equal(saved.startedAt,'original');
});
test('更换表格才重置任务，拒绝旧面板启动旧表格',async()=>{
  const b=boot({previous:{state:'done',rows:rows(),logs:[]}});
  const imported=await b.send({kind:'DXM_IMPORT',file:{name:'new.xls',base64:'YWJj'}});
  assert.equal(imported.ok,true);assert.equal(b.data.dxmJob,null);assert.equal(b.data.dxmFile.name,'new.xls');
  assert.equal((await b.send({kind:'DXM_START',rows:rows(),fileId:'stale'})).ok,false);
  assert.equal((await b.send({kind:'DXM_START',rows:rows(),fileId:imported.file.id})).ok,true);
});
test('提交结果不明的保存进度不能盲目重跑',async()=>{
  const b=boot({previous:{state:'review',pendingStage:'发布 p1',rows:rows(),logs:[]}});
  assert.match((await b.send({kind:'DXM_START',rows:rows()})).error,/结果尚未确认/);assert.equal(b.tasks.length,0);
});

test('继续执行只重试明确失败的产品，跳过发布结果不明的产品',async()=>{
  const rs=rows();Object.assign(rs[0],{status:'待人工核对',publishUncertain:true,error:'发布结果连接断开',checkpoint:'offline'});Object.assign(rs[1],{status:'失败',error:'校验失败',checkpoint:'offline'});
  const b=boot({previous:{state:'done',rows:rs,logs:[]}});
  assert.equal((await b.send({kind:'DXM_START',rows:rows()})).ok,true);
  assert.equal(b.data.dxmJob.rows[0].status,'待人工核对');assert.equal(b.data.dxmJob.rows[0].error,'发布结果连接断开');assert.equal(b.data.dxmJob.rows[1].status,'待执行');
});

test('剩余全部结果不明时说明待核对，不自动重新发布',async()=>{
  const rs=rows().map(r=>({...r,status:'待人工核对',publishUncertain:true,error:'发布结果连接断开'}));
  const b=boot({previous:{state:'done',rows:rs,logs:[]}});
  assert.match((await b.send({kind:'DXM_START',rows:rows()})).error,/发布结果待核对/);assert.equal(b.tasks.length,0);
});
test('点击工具栏打开网页内面板，不依赖独立窗口 API',async()=>{
  const manifest=JSON.parse(fs.readFileSync('extension/manifest.json'));assert.equal(manifest.action.default_popup,undefined);
  const b=boot();assert.equal((await b.send({kind:'DXM_STATUS'})).ok,true);
  await b.click({id:202,url:'https://www.dianxiaomi.com/web/amazon/pageList/draft'});assert.deepEqual(b.sent,[{id:202,kind:'DXM_PANEL_OPEN'}]);assert.equal(b.badges[0].text,'');
});
test('没有工作页面时工具栏打开采集页面，页面自身显示面板',async()=>{
  const b=boot({noTabs:true});await b.click({id:5,url:'https://example.com'});assert.equal(b.created.length,1);assert.equal(b.created[0].url,'https://www.dianxiaomi.com/web/productCrawl/dataAcquisition');assert.equal(b.sent.length,0);
});
test('点击网页面板开始时绑定这个标签页',async()=>{
  const b=boot();await b.send({kind:'DXM_START',rows:rows()},{id:202,url:'https://www.dianxiaomi.com/web/amazon/pageList/offline'});assert.equal((await b.send({kind:'DXM_STATUS'})).job.tabId,202);assert.equal((await b.send({kind:'DXM_STATUS'},{id:202})).owner,true);assert.equal((await b.send({kind:'DXM_STATUS'},{id:101})).owner,false);
});
test('整表自动执行，旧范围和旧店铺设置不能影响本轮',async()=>{
  const b=boot(),r=await b.send({kind:'DXM_START',rows:rows(),options:{startIndex:2,limit:1},tabId:999});assert.equal(r.ok,true);
  const job=(await b.send({kind:'DXM_STATUS'})).job;assert.equal(job.tabId,101);assert.equal(job.options.startIndex,1);assert.equal(job.options.limit,2);assert.equal(job.options.modelNameFromNumber,true);assert.ok(job.rows.every(r=>r.status==='待执行'&&r.targetShop==='万万欣DE'));assert.equal(b.tasks.length,1);
  assert.match((await b.send({kind:'DXM_START',rows:rows()})).error,/已有批次/);
});
test('缺少工作页面时返回错误，保留上次结果，不启动工作流',async()=>{
  const previous={state:'done',rows:[]},b=boot({noTabs:true,previous});assert.match((await b.send({kind:'DXM_START',rows:rows()})).error,/打开并登录/);assert.deepEqual((await b.send({kind:'DXM_STATUS'})).job,previous);assert.equal(b.tasks.length,0);
});
test('开始时保存失败不会留下假运行状态或锁住页面',async()=>{
  const b=boot({failSave:true});assert.match((await b.send({kind:'DXM_START',rows:rows()})).error,/存储空间/);assert.equal((await b.send({kind:'DXM_STATUS'})).job,null);assert.equal(b.tasks.length,0);
});
test('后台意外拒绝会返回待核对，避免未处理的 Promise 错误',async()=>{
  const b=boot({rejectRun:true});await b.send({kind:'DXM_START',rows:rows()});await b.tasks[0]();const job=(await b.send({kind:'DXM_STATUS'})).job;assert.equal(job.state,'review');assert.ok(job.rows.every(r=>r.status==='待人工核对'));assert.match(job.error,/存储失败/);
});
test('后台硬性阻止移入结果未确认时刷新或跳转',async()=>{
  const b=boot({previous:{state:'review',pendingMove:{ids:['p1']},rows:[]}});await b.send({kind:'DXM_STATUS'});
  await assert.rejects(()=>b.open('https://www.dianxiaomi.com/web/amazon/pageList/offline'),e=>e.uncertain&&/已阻止刷新或跳转/.test(e.message));
  assert.equal(b.sent.length,0);
});
test('连续编辑相同路径的不同产品时，旧标签URL和旧表单都不能提前通过就绪',async()=>{
  const old='https://www.dianxiaomi.com/web/amazon/edit?id=184807703384602947',url='https://www.dianxiaomi.com/web/amazon/edit?id=184807703384602948';
  const oldSource='https://www.amazon.com/dp/B0FMXZ1XHX',record={productId:'184807703384602948',source:'https://www.amazon.com/dp/B0FNJMLLWP',title:'Second'};
  const b=boot({previous:{state:'review',tabId:101,rows:[]},navigation:{tabs:[{url:old,status:'complete'},{url,status:'complete'}],ready:[{url:old,source:oldSource},{url,source:oldSource},{url,source:record.source}]}});
  await b.send({kind:'DXM_STATUS'});const ready=await b.waitEditor(url,record);
  assert.equal(ready.source,record.source);assert.equal(b.updates.length,0);assert.equal(b.sent.length,3);
  assert.ok(b.sent.every(m=>m.action==='ready'&&m.args.expectedUrl===url&&m.args.record.source===record.source));
});
test('字段日志绑定本批次、标签页和产品，过期或其他标签的消息不能污染记录',async()=>{
  const b=boot(),rs=rows();rs[0].productId='p1';await b.send({kind:'DXM_START',rows:rs});
  const message={kind:'DXM_FIELD_PROGRESS',runId:'local-run',productId:'p1',source:rs[0].source,field:'配送渠道（FBA）'};
  assert.equal((await b.send(message,{id:999})).ok,false);assert.equal((await b.send({...message,runId:'old'},{id:101})).ok,false);
  assert.equal((await b.send(message,{id:101})).ok,true);const job=(await b.send({kind:'DXM_STATUS'})).job;
  assert.equal(job.logs.length,1);assert.equal(job.rows[0].currentField,message.field);assert.equal(job.rows[0].history.length,1);
  await b.send({kind:'DXM_STOP'});assert.equal((await b.send(message,{id:101})).ok,false);
});
test('清空缓存删除表格、旧版设置和所有存储区，并复位后台及全部面板',async()=>{
  const previous={state:'done',rows:[],logs:[{message:'旧日志'}]},allTabs=[{id:101,url:'https://www.dianxiaomi.com/web/amazon/edit?id=1'},{id:102,url:'https://www.dianxiaomi.com/web/productCrawl/dataAcquisition'}];
  const b=boot({previous,allTabs,extraData:{dxmFile:{name:'旧表.xls'},dxmPanelPosition:{left:10,top:10},dxmPanelCollapsed:true,dxmUIPrefs:{limit:1},legacyCache:'old'}});
  assert.equal((await b.send({kind:'DXM_CLEAR_CACHE'})).ok,true);
  assert.deepEqual(b.data,{});assert.deepEqual(b.syncData,{});assert.deepEqual(b.sessionData,{});assert.equal((await b.send({kind:'DXM_STATUS'})).job,null);
  for(const kind of ['DXM_CACHE_PREPARE','DXM_CACHE_CLEARED'])assert.deepEqual(b.sent.filter(m=>m.kind===kind).map(m=>m.id),[101,102]);
  assert.equal(b.updates.length,0);assert.equal(b.sent.filter(m=>m.kind==='DXM_ACTION').length,0);
  assert.equal((await b.send({kind:'DXM_CLEAR_CACHE'})).ok,true);assert.equal((await b.send({kind:'DXM_STATUS'})).job,null);
});
test('执行中及停止尚未完成时拒绝清空，停止完成后可以清空',async()=>{
  const b=boot();await b.send({kind:'DXM_START',rows:rows()});
  assert.match((await b.send({kind:'DXM_CLEAR_CACHE'})).error,/先停止/);assert.equal(b.clears.length,0);
  await b.send({kind:'DXM_STOP'});assert.equal((await b.send({kind:'DXM_CLEAR_CACHE'})).ok,false);
  await b.tasks[0]();assert.equal((await b.send({kind:'DXM_CLEAR_CACHE'})).ok,true);assert.equal((await b.send({kind:'DXM_STATUS'})).job,null);
});
test('清理存储失败不误报成功或丢失原任务，其他面板解除清理状态',async()=>{
  const previous={state:'done',rows:[],logs:[]},b=boot({previous,extraData:{dxmFile:{name:'原表.xls'}},clearFailure:'local'});
  const result=await b.send({kind:'DXM_CLEAR_CACHE'});assert.equal(result.ok,false);assert.match(result.error,/清空缓存失败/);
  assert.deepEqual((await b.send({kind:'DXM_STATUS'})).job,previous);assert.equal(b.data.dxmFile.name,'原表.xls');
  assert.ok(b.sent.some(m=>m.kind==='DXM_CACHE_FAILED'));assert.ok(!b.sent.some(m=>m.kind==='DXM_CACHE_CLEARED'));
});
test('清理期间阻止另一个标签启动任务，旧字段消息也不能恢复清掉的缓存',async()=>{
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const b=boot({previous:{state:'done',rows:[]},clearGate:async()=>{entered();await gate;}});
  const clearing=b.send({kind:'DXM_CLEAR_CACHE'});await started;
  assert.match((await b.send({kind:'DXM_START',rows:rows()})).error,/正在清空缓存/);release();assert.equal((await clearing).ok,true);
  assert.equal((await b.send({kind:'DXM_FIELD_PROGRESS',runId:'old',productId:'p1',source:rows()[0].source,field:'UPC'},{id:101})).ok,false);assert.deepEqual(b.data,{});
});
