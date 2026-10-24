// Local UI fixture only. No tab navigation or remote requests are implemented.
const mockData={},mockSyncData={oldSetting:1},mockSessionData={oldState:1},fixtureState=new URL(location.href).searchParams.get('state')||'ready';
const fixtureClearKey='dxm-test-cache-cleared:'+fixtureState;
let fixtureJob=null,fixtureInitialized=false;const fixtureListeners=[];
const initMock=(async()=>{
  if(fixtureState==='idle'||localStorage.getItem(fixtureClearKey))return;
  const bytes=new Uint8Array(await(await fetch('/迁移数据.xls')).arrayBuffer());let b='';
  for(let i=0;i<bytes.length;i+=8192)b+=String.fromCharCode(...bytes.subarray(i,i+8192));
  mockData.dxmFile={name:'迁移数据.xls',size:bytes.length,base64:btoa(b)};
  mockData.dxmUIPrefs={startIndex:2,limit:1,scope:'one'};
  Object.assign(mockData,JSON.parse(localStorage.getItem('dxm-test-panel-position')||'{}'));
})();
async function initializeFixture(){
  await initMock;if(fixtureInitialized)return;fixtureInitialized=true;
  if(!mockData.dxmFile||!['running','done','review','stopped','error'].includes(fixtureState))return;
  const rows=DXMCore.parseWorkbook(XLSX.read(mockData.dxmFile.base64,{type:'base64'}),XLSX,{mergeSplit:true}).rows;
  rows.forEach((r,i)=>{r.status=i===1?'待执行':'未执行';});
  Object.assign(rows[1],{title:'10 PCS Gold S Hooks, Brass S Hooks for Hanging',collectorId:'184527809328870833',productId:'184807703383437685'});
  fixtureJob={id:'local-ui-demo',rows,state:fixtureState==='done'?'done':fixtureState,tabId:101,options:{startIndex:2,limit:1},step:'正在填写第 2 条产品的信息',logs:[{time:'14:30:00',message:'开始处理第 2 条，共 1 条产品。'},{time:'14:30:02',message:'已确认目标店铺：万万欣DE / 英国。'},{time:'14:30:05',message:'采集完成，已对应来源链接与产品标题。'},{time:'14:30:08',message:'已认领，并移入待发布。'},{time:'14:30:12',message:'正在填写产品信息，配送方式设为 FBA。'}]};
  if(fixtureState==='done'){rows[1].status='已提交待确认';fixtureJob.logs.push({time:'14:30:20',message:'保存并发布已提交，等待平台确认。'});}
  if(fixtureState==='stopped')rows[1].status='已停止';
  if(fixtureState==='review'||fixtureState==='error'){rows[1].status=fixtureState==='review'?'待人工核对':'失败';rows[1].error='示例：平台未返回明确结果，请核对当前产品。';fixtureJob.error=rows[1].error;}
}
const clearMock=data=>{for(const key of Object.keys(data))delete data[key];};
async function notifyFixture(kind){
  await Promise.allSettled(fixtureListeners.map(fn=>new Promise(resolve=>{const result=fn({kind},{},resolve);if(result!==true)resolve();})));
}
window.chrome={
  storage:{local:{get:async keys=>{await initMock;installMockExport();return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,mockData[k]]));},set:async value=>{Object.assign(mockData,value);const layout={};for(const key of ['dxmPanelPosition','dxmPanelClosed'])if(key in mockData)layout[key]=mockData[key];localStorage.setItem('dxm-test-panel-position',JSON.stringify(layout));},clear:async()=>{clearMock(mockData);localStorage.removeItem('dxm-test-panel-position');}},sync:{clear:async()=>clearMock(mockSyncData)},session:{clear:async()=>clearMock(mockSessionData)}},
  tabs:{query:async()=>fixtureState==='notabs'?[]:[{id:101,windowId:1,active:true,url:'https://www.dianxiaomi.com/web/amazon/pageList/draft',title:'店小秘 - 采集箱'},{id:102,windowId:1,active:false,url:'https://www.dianxiaomi.com/web/productCrawl/dataAcquisition',title:'店小秘 - 数据采集'}]},
  runtime:{onMessage:{addListener:fn=>fixtureListeners.push(fn)},sendMessage:async message=>{
    await initializeFixture();
    if(message.kind==='DXM_STATUS')return fixtureState==='backend-error'?{ok:false,error:'本地示例：扩展后台未能启动'}:{ok:true,job:fixtureJob,owner:true};
    if(message.kind==='DXM_IMPORT'){
      const file={...message.file,id:crypto.randomUUID()};await chrome.storage.local.set({dxmFile:file});fixtureJob=null;return {ok:true,file};
    }
    if(message.kind==='DXM_CLEAR_CACHE'){
      if(fixtureJob?.state==='running')return {ok:false,error:'请先停止执行，等待任务结束后再清空缓存'};
      await notifyFixture('DXM_CACHE_PREPARE');
      if(fixtureState==='clear-error'){await notifyFixture('DXM_CACHE_FAILED');return {ok:false,error:'清空缓存失败：本地模拟存储错误'};}
      for(const area of ['sync','session','local'])await chrome.storage[area].clear();fixtureJob=null;localStorage.setItem(fixtureClearKey,'1');
      await notifyFixture('DXM_CACHE_CLEARED');
      const out=document.getElementById('mockCacheCheck')||document.body.appendChild(document.createElement('output'));out.id='mockCacheCheck';out.style.cssText='display:block;padding:20px;color:#196856';
      out.textContent=`缓存检查：local ${Object.keys(mockData).length} 项，sync ${Object.keys(mockSyncData).length} 项，session ${Object.keys(mockSessionData).length} 项；批次已清除。`;return {ok:true};
    }
    if(message.kind==='DXM_START'){
      if(fixtureState==='start-error'||fixtureState==='notabs')return {ok:false,error:'请先在这个浏览器中打开并登录店小秘，再点击开始执行。'};
      if(fixtureJob){fixtureJob.state='running';fixtureJob.stop=false;fixtureJob.step='本地演示：继续执行';return {ok:true};}
      const rows=structuredClone(message.rows);rows.forEach(r=>{if(!r.error)r.status='待执行';});
      fixtureJob={id:'local-start-demo',rows,options:{startIndex:1,limit:rows.length,modelNameFromNumber:true},tabId:101,state:'running',step:'本地演示：正在准备采集',logs:[{time:'14:32:00',message:`已准备 ${rows.length} 条产品（本地演示，不连接店小秘）。`}]};return {ok:true};
    }
    if(message.kind==='DXM_STOP'){
      if(fixtureJob){fixtureJob.stop=true;setTimeout(()=>{fixtureJob.state='stopped';fixtureJob.rows.forEach(r=>{if(r.status==='待执行')r.status='已停止';});fixtureJob.logs.push({time:'14:32:05',message:'已停止，本轮结果已保留。'});},1800);}return {ok:true};
    }
    return {ok:false,error:'本地预览不支持此操作'};
  }}
};
document.getElementById('simulateIcon')?.addEventListener('click',()=>{for(const fn of fixtureListeners)fn({kind:'DXM_PANEL_OPEN'},{},()=>{});});
function installMockExport(){
  if(document.getElementById('mockExportCheck'))return;
  const check=document.body.appendChild(document.createElement('output'));check.id='mockExportCheck';check.hidden=true;check.style.cssText='margin:12px;padding:12px;background:#edf3ff;color:#245bd6;font:12px system-ui';check.textContent='本地导出检查已就绪。';
  XLSX.writeFile=(book,name)=>{
    check.hidden=false;
    check.style.display='block';
    const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'}),read=XLSX.read(bytes,{type:'array'}),sheet=read.Sheets[read.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1});
    const idCells=['J3','K3'].map(key=>sheet[key]);
    const exact=idCells.every(cell=>cell?.t==='s'&&/^\d{18}$/.test(cell.v));
    check.textContent=`本地导出检查：${name}；${rows.length-1} 条产品；${bytes.byteLength} 字节；采集 ID 与产品 ID ${exact?'保持完整文本':'无演示 ID'}。此预览仅验证 XLSX 内容，不启动浏览器下载。`;
  };
}
