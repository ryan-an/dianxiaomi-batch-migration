importScripts('core.js','workflow.js','work-target.js');
let job=null,busy=false,loadPromise=null,resetting=false,panelOpening=false;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
chrome.action.onClicked.addListener(async tab=>{
  if(panelOpening)return;
  panelOpening=true;
  try{
    let target=DXMTarget.allowedTab(tab)?tab:null;
    if(!target){try{target=await DXMTarget.resolve(chrome);}catch{await chrome.tabs.create({url:'https://www.dianxiaomi.com/web/productCrawl/dataAcquisition',active:true});return;}}
    await chrome.tabs.update(target.id,{active:true});
    let result;
    try{result=await chrome.tabs.sendMessage(target.id,{kind:'DXM_PANEL_OPEN'});}catch{}
    if(!result?.ok){
      const probe=await chrome.scripting.executeScript({target:{tabId:target.id},func:()=>{
        if(globalThis.DXMPanel){globalThis.DXMPanel.show();return true;}
        document.getElementById('dxm-migration-panel')?.remove();return false;
      }});
      if(!probe.some(frame=>frame.result===true)){
        const scripts=chrome.runtime.getManifest().content_scripts;
        for(const entry of scripts.filter(entry=>entry.world==='MAIN'&&target.url.includes('/web/amazon/')))
          await chrome.scripting.executeScript({target:{tabId:target.id},world:'MAIN',files:entry.js});
        await chrome.scripting.executeScript({target:{tabId:target.id},files:scripts[0].js});
        result=await chrome.tabs.sendMessage(target.id,{kind:'DXM_PANEL_OPEN'});
        if(!result?.ok)throw new Error('面板初始化后仍未响应');
      }
    }
    await chrome.action.setBadgeText({text:''});
    await chrome.action.setTitle({title:'显示网页内迁移面板'});
  }catch(error){
    console.error('迁移助手面板打开失败：',error);
    await chrome.action.setBadgeText({text:'刷新'});
    await chrome.action.setTitle({title:'请刷新店小秘页面，再点击插件图标显示面板'});
  }finally{panelOpening=false;}
});
async function save(){if(job)await chrome.storage.local.set({dxmJob:job});}
async function load(){
  if(loadPromise)return loadPromise;
  loadPromise=(async()=>{job=(await chrome.storage.local.get('dxmJob')).dxmJob||null;
  let migrated=false;for(const r of job?.rows||[])if(r.status==='已提交待确认'){r.status='已发布';r.checkpoint='published';r.step='完成';r.error='';migrated=true;}
  if(migrated)await save();
  if(job?.state==='running'){
    job.state='review';job.error='浏览器或后台曾中断，请核对页面。为避免重复发布，不自动重跑。';
    for(const r of job.rows)if(!['未执行','数据错误','失败','已跳过','已上线','已发布','已提交待确认'].includes(r.status)){r.status='待人工核对';r.error=job.error;}
    await save();
  }})();return loadPromise;
}
async function clearCache(){
  if(busy||job?.state==='running')throw new Error('请先停止执行，等待任务结束后再清空缓存');
  if(resetting)throw new Error('正在清空缓存，请稍候');
  resetting=true;let tabs=[];
  const broadcast=async kind=>Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{kind})));
  try{
    tabs=await chrome.tabs.query({url:['https://www.dianxiaomi.com/web/*']});
    // Flush earlier UI writes and cancel pending imports before clearing storage.
    await broadcast('DXM_CACHE_PREPARE');
    for(const area of ['sync','session','local'])if(chrome.storage[area]?.clear)await chrome.storage[area].clear();
    job=null;loadPromise=Promise.resolve();
    await broadcast('DXM_CACHE_CLEARED');
    await Promise.allSettled([chrome.action.setBadgeText({text:''}),chrome.action.setTitle({title:'显示网页内迁移面板'})]);
    return {ok:true};
  }catch(e){await broadcast('DXM_CACHE_FAILED');throw new Error(`清空缓存失败：${e.message}`);}
  finally{resetting=false;}
}
function allowed(url){const u=new URL(url);return u.origin==='https://www.dianxiaomi.com'&&/^\/web\/(amazon\/|productCrawl\/)/.test(u.pathname);}
async function raw(action,args={}){
  if(job.stop&&action!=='stop')throw new Error('用户已停止');
  const result=await chrome.tabs.sendMessage(job.tabId,{kind:'DXM_ACTION',action,args,runId:job.id});
  if(!result?.ok){const e=new Error(result?.error||'页面没有返回执行结果');e.field=result?.field;e.completedFields=result?.completedFields;e.notSubmitted=result?.notSubmitted;throw e;}return result.data;
}
async function germanNewImages(record){
  if(!DXMCore.isNewProduct(record))throw new Error('本条未标记为新品');
  const productTabId=job.tabId,before=new Set((await chrome.tabs.query({})).map(t=>t.id));
  const initial=await raw('prepareGermanNewImages',{record});if(initial.done)return initial;
  let editor;
  const guard=()=>{if(job.stop)throw new Error('用户已停止');};
  const send=async action=>{
    guard();const response=await chrome.tabs.sendMessage(editor.id,{kind:'DXM_IMAGE_ACTION',action,runId:job.id});
    if(!response?.ok)throw new Error(response?.error||'图片编辑器没有返回结果');return response.data;
  };
  try{
    const end=Date.now()+45000;let observedTabs=[];
    while(Date.now()<end){
      guard();observedTabs=await chrome.tabs.query({});const candidates=observedTabs.filter(t=>!before.has(t.id)&&DXMTarget.imageEditorTab(t)&&(!t.openerTabId||t.openerTabId===productTabId));
      if(candidates.length>1)throw new Error('小秘美图打开多个新标签，请核对');
      if(candidates.length===1){editor=candidates[0];break;}await pause(300);
    }
    if(!editor)throw new Error(DXMTarget.imageEditorOpenError(observedTabs,[...before],productTabId));
    job.imageTabId=editor.id;await save();await chrome.tabs.update(editor.id,{active:true});
    const readyEnd=Date.now()+60000;let ready=false,lastError;
    while(Date.now()<readyEnd){
      guard();try{if((await send('ready'))?.ready){ready=true;break;}}catch(error){lastError=error;}
      await pause(300);
    }
    if(!ready)throw new Error(`小秘美图未就绪：${lastError?.message||'图片未加载'}`);
    await send('crop');guard();
    // Successful apply can close the editor before its reply reaches us. The
    // product form is authoritative; do not send Save a second time.
    let saveError;try{await send('save');}catch(error){saveError=error;}
    const appliedEnd=Date.now()+60000;
    while(Date.now()<appliedEnd){
      guard();const state=await raw('germanImageState',{record});
      if(state.done&&state.src!==initial.src){
        await chrome.tabs.update(productTabId,{active:true});
        try{await chrome.tabs.get(editor.id);await chrome.tabs.remove(editor.id);}catch{}
        return {...state,removed:initial.removed};
      }
      await pause(300);
    }
    throw new Error(`图片保存后未确认应用300×300主图${saveError?'：'+saveError.message:''}，保留页面核对`);
  }finally{delete job.imageTabId;await save();}
}
const io={save,sleep:pause,
  async closeEditor(record){
    if(record.status!=='已发布')throw new Error('未收到发布成功确认，保留编辑页');
    const editor=await chrome.tabs.get(job.tabId);
    if(!DXMTarget.samePage(editor.url,`https://www.dianxiaomi.com/web/amazon/edit?id=${encodeURIComponent(record.productId)}`))throw new Error('当前标签不是本条产品，禁止关闭');
    let list;
    if(job.listTabId)try{const saved=await chrome.tabs.get(job.listTabId);if(DXMTarget.samePage(saved.url,'https://www.dianxiaomi.com/web/amazon/pageList/offline'))list=saved;}catch{}
    if(!list)list=await chrome.tabs.create({url:'https://www.dianxiaomi.com/web/amazon/pageList/offline',active:true});
    job.tabId=list.id;job.listTabId=list.id;await save();
    await chrome.tabs.update(list.id,{active:true});await chrome.tabs.remove(editor.id);
  },
  async call(action,args={},risky=false){
    if(job.stop)throw new Error('用户已停止');
    if(action==='germanNewImages')return germanNewImages(args.record);
    let beforeTabs;
    if(action==='editProduct'){job.listTabId=job.tabId;beforeTabs=(await chrome.tabs.query({})).map(t=>t.id);await save();}
    if(risky){job.intent={action,time:new Date().toISOString()};await save();}
    try{const data=await raw(action,args);job.intent=null;await save();return action==='editProduct'?{...data,beforeTabs}:data;}
    catch(e){if(risky&&!e.notSubmitted)e.uncertain=true;throw e;}
  },
  async waitEditor(url,record,beforeTabs=[]){
    if(!beforeTabs.length)return this.open(url,record,false);
    const current=await chrome.tabs.get(job.tabId);
    if(!DXMTarget.samePage(current.url,url)){
      const end=Date.now()+45000;let found;
      while(Date.now()<end){
        if(job.stop)throw new Error('用户已停止');
        const candidates=(await chrome.tabs.query({})).filter(t=>!beforeTabs.includes(t.id)&&DXMTarget.samePage(t.url,url)&&(!t.openerTabId||t.openerTabId===job.listTabId));
        if(candidates.length>1)throw new Error('编辑点击后出现多个对应标签，已停止，请核对');
        if(candidates.length===1){found=candidates[0];break;}await pause(300);
      }
      if(!found)throw new Error('点击编辑后没有找到新开的对应产品标签');
      job.tabId=found.id;await save();await chrome.tabs.update(job.tabId,{active:true});
    }
    return this.open(url,record,false);
  },
  async open(url,record,navigate=true){
    if(!allowed(url))throw new Error('不允许跳转到店小秘工作流之外的地址');
    if(navigate&&new URL(url).pathname==='/web/amazon/edit')throw new Error('编辑页只能从待发布列表点击进入');
    if(job.stop)throw new Error('用户已停止');
    if(job.pendingMove){const e=new Error('移入待发布结果尚未确认，已阻止刷新或跳转');e.uncertain=true;throw e;}
    if(navigate){
      const current=await chrome.tabs.get(job.tabId);
      if(new URL(current.url).pathname==='/web/amazon/edit'){
        let list;
        if(job.listTabId)try{const saved=await chrome.tabs.get(job.listTabId);if(allowed(saved.url)&&!new URL(saved.url).pathname.includes('/amazon/edit'))list=saved;}catch{}
        if(!list)list=await chrome.tabs.create({url,active:true});
        job.tabId=list.id;await save();
        if(!DXMTarget.samePage(list.url,url))await chrome.tabs.update(list.id,{url,active:true});
        else await chrome.tabs.update(list.id,{active:true});
      }else if(!DXMTarget.samePage(current.url,url))await chrome.tabs.update(job.tabId,{url});
      if(new URL(url).pathname==='/web/amazon/pageList/offline'){job.listTabId=job.tabId;await save();}
    }
    const end=Date.now()+45000;let error;
    while(Date.now()<end){
      if(job.stop)throw new Error('用户已停止');
      try{
        const tab=await chrome.tabs.get(job.tabId);
        if(tab.status==='complete'&&DXMTarget.samePage(tab.url,url)){
          const ready=await raw('ready',{expectedUrl:url,record});
          if(DXMTarget.samePage(ready.url,url)&&(!record||DXMCore.sourceKey(ready.source)===DXMCore.sourceKey(record.source)))return ready;
          error=new Error('页面仍在切换，尚未加载到目标产品ID及来源链接');
        }
      }catch(e){error=e;}
      await pause(500);
    }
    throw new Error(`页面未准备好：${error?.message||url}`);
  }
};
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  (async()=>{
    await load();
    if(m.kind==='DXM_STATUS')return {ok:true,job,owner:!!job&&(s.tab?.id===job.tabId||s.tab?.id===job.listTabId)};
    if(m.kind==='DXM_CLEAR_CACHE')return clearCache();
    if(m.kind==='DXM_IMPORT'){
      if(busy||resetting)throw new Error('请先停止执行，再更换表格');
      if(!m.file?.base64)throw new Error('表格文件为空');
      const file={...m.file,id:crypto.randomUUID()};
      await chrome.storage.local.set({dxmFile:file,dxmJob:null});job=null;
      return {ok:true,file};
    }
    if(m.kind==='DXM_FIELD_PROGRESS'){
      if(!job||job.state!=='running'||job.stop||s.tab?.id!==job.tabId||m.runId!==job.id)throw new Error('批次已失效，禁止继续填写');
      const r=job.rows.find(r=>r.productId===m.productId&&DXMCore.sourceKey(r.source)===DXMCore.sourceKey(m.source));
      if(!r||typeof m.field!=='string'||!m.field||m.field.length>100)throw new Error('字段日志与当前产品不匹配');
      const entry={time:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),message:`正在填写：${m.field}`};
      job.logs.push(entry);if(job.logs.length>1000)job.logs.shift();r.history.push(entry);r.currentField=m.field;await save();return {ok:true};
    }
    if(m.kind==='DXM_STOP'){
      if(job&&busy){job.stop=true;await save();await Promise.allSettled([chrome.tabs.sendMessage(job.tabId,{kind:'DXM_ACTION',action:'stop'}),...(job.imageTabId?[chrome.tabs.sendMessage(job.imageTabId,{kind:'DXM_IMAGE_ACTION',action:'stop'})]:[])]);}
      return {ok:true};
    }
    if(m.kind==='DXM_START'){
      if(resetting)throw new Error('正在清空缓存，请稍候再开始');
      if(busy)throw new Error('已有批次正在执行');
      busy=true;
      try {
      if(!Array.isArray(m.rows)||!m.rows.length)throw new Error('没有有效数据');
      const tab=await DXMTarget.resolve(chrome,s.tab);
      const options={startIndex:1,limit:m.rows.length,modelNameFromNumber:true};
      const storedFile=(await chrome.storage.local.get('dxmFile')).dxmFile;
      if(m.fileId&&storedFile?.id!==m.fileId)throw new Error('表格已更换，请刷新面板');
      const continuing=!!job;
      if(continuing&&(job.intent||job.pendingMove||job.pendingStage))throw new Error('上次提交的结果尚未确认，已保留进度。请先核对店小秘结果，避免重复提交');
      const rows=structuredClone(continuing?job.rows:m.rows);
      for(let i=0;i<rows.length;i++){
        const r=rows[i];if(!continuing)r.history=[];
        if(continuing&&r.publishUncertain){r.status='待人工核对';continue;}
        if(continuing){if(!['数据错误','已上线','已发布','已提交待确认','发布失败','已跳过'].includes(r.status)){r.error='';r.status='待执行';}}
        if(!r.error){DXMCore.sourceKey(r.source);r.site=DXMCore.normalizeSite(r.site);r.targetShop=DXMCore.shopForSite(r.shop,r.site);if(!continuing)r.status='待执行';}
      }
      if(!rows.some(r=>!r.error))throw new Error(rows.some(r=>r.publishUncertain)?'剩余产品的发布结果待核对，已保留编辑页，不自动重复提交':'表格中没有可执行的产品，请检查原表数据');
      const nextJob={...(continuing?job:{}),id:crypto.randomUUID(),fileId:storedFile?.id,state:'running',rows,logs:continuing?job.logs:[],options,tabId:tab.id,imageTabId:null,startedAt:continuing?job.startedAt:new Date().toISOString(),step:continuing?'继续执行':'准备',stop:false,intent:null,error:'',resuming:continuing};
      await chrome.storage.local.set({dxmJob:nextJob});job=nextJob;
      setTimeout(()=>new DXMWorkflow(job,io).run().catch(async e=>{
        job.state='review';job.stop=true;job.error=`后台执行中断，请核对当前产品：${e.message}`;
        for(const r of job.rows)if(!['数据错误','失败','已跳过','已上线','已发布','已提交待确认','发布失败'].includes(r.status)){r.status='待人工核对';r.error=job.error;}
        try{await save();}catch{}
      }).finally(()=>{busy=false;}),0);
      return {ok:true};
      }catch(e){busy=false;throw e;}
    }
    throw new Error('未知请求');
  })().then(reply,e=>reply({ok:false,error:e.message}));return true;
});
chrome.tabs.onRemoved.addListener(async tabId=>{await load();if(job?.tabId===tabId&&busy){job.stop=true;job.error='执行标签页已关闭';await save();}});
