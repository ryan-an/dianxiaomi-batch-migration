'use strict';
let retryMode='',retryClicks=0,confirmClicks=0;
const byId=id=>document.getElementById(id),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function setupRetry(mode){
  DXMAdapter.reset();retryMode=mode;retryClicks=confirmClicks=0;byId('feedback').replaceChildren();byId('stats').replaceChildren();byId('trace').textContent='';
  byId('rows').innerHTML='<tr class="vxe-body--row" rowid="row_retry"><td><label><input type="checkbox"></label></td><td><a href="https://www.amazon.com/dp/B0TEST0001">亚马逊(美国)</a></td><td><div class="no-new-line4" title="Offline failed product">Offline failed product</div></td><td>采集失败：采集产品失败，建议使用插件采集</td></tr>';
  byId('batch-menu').innerHTML=await(await fetch('/docs/evidence/retry-menu.html')).text();byId('batch-menu').hidden=true;
  byId('batch-menu').querySelectorAll('[role="menuitem"]').forEach(item=>{if(item.textContent.trim()==='批量重试')item.onclick=submitRetry;});
}
byId('batch').onclick=()=>byId('batch-menu').hidden=!byId('batch-menu').hidden;
function notice(message){const item=document.createElement('div');item.className='ant-message-notice-content';item.textContent=message;byId('feedback').append(item);}
function submitRetry(){
  retryClicks++;byId('batch-menu').hidden=true;
  if(retryMode==='silent'||retryMode==='isolation')return;
  if(retryMode==='reject'){notice('请选择可重试的产品');return;}
  if(retryMode==='direct'){notice('已加入采集队列');return;}
  if(retryMode==='list'){setTimeout(()=>byId('rows').replaceChildren(),120);return;}
  if(retryMode==='popover'||retryMode==='popconfirm'){
    const prompt=document.createElement('div');prompt.className=retryMode==='popover'?'ant-popover':'ant-popconfirm';prompt.innerHTML='确定重试所选产品吗？<button>确定</button>';byId('feedback').append(prompt);
    prompt.querySelector('button').onclick=()=>{confirmClicks++;setTimeout(()=>{prompt.remove();notice('已提交采集重试');},250);};return;
  }
  const modal=document.createElement('div');modal.className='ant-modal';modal.innerHTML='<div id="commonProgressBarStatus">进行中...</div><div id="commonProgressBarDetail">已执行0条，成功:0，失败:0</div><button>关闭</button>';byId('feedback').append(modal);
  modal.querySelector('button').onclick=()=>modal.remove();setTimeout(()=>{byId('commonProgressBarStatus').textContent='采集完成';byId('commonProgressBarDetail').textContent='已执行1条，成功:1，失败:0';},300);
}
async function invokeRetry(){
  const ids=DXMAdapter.rows().map(row=>row.id),realNow=Date.now;let advance=0;
  if(retryMode==='silent'||retryMode==='isolation')Date.now=()=>realNow()+(advance+=10000);
  try{return await DXMAdapter.commands.retry({ids});}finally{Date.now=realNow;}
}
async function verifyIsolation(){
  const records=Array.from({length:21},(_,i)=>({index:i,source:'https://www.amazon.com/dp/B0TEST'+String(i+1).padStart(4,'0'),shop:'Shop',targetShop:'Shop',site:'英国',data:{},status:'待执行',history:[]}));
  const job={rows:records,logs:[],state:'running',options:{startIndex:1,limit:21}},retryId=DXMAdapter.rows()[0].id,claimedIds=new Set();let tab='',path='',moving=0,claimed=false;
  const crawl=r=>({id:r.index?'c'+r.index:retryId,source:r.source,title:'Title '+r.index,text:'Title '+r.index});
  const listing=r=>({id:'p'+r.index,source:r.source,title:r.title,text:'「Shop」英国',editUrl:'https://www.dianxiaomi.com/web/amazon/edit?id=p'+r.index});
  const io={save:async()=>{},sleep:async()=>{},open:async url=>{path=url;},waitEditor:async()=>{},closeEditor:async()=>{},call:async(action,args={})=>{
    if(action==='progress')return {done:true,failed:claimed?0:1,text:'整组采集完成：21条，成功20，失败1'};
    if(action==='acquisitionTab')tab=args.name;
    if(action==='snapshot'){
      const rows=path.includes('productCrawl')?(tab==='未认领'?records.slice(1).map(crawl).filter(row=>!claimedIds.has(row.id)):tab==='采集失败'?[crawl(records[0])]:[]):records.filter(r=>claimedIds.has(crawl(r).id)).map(listing);
      return {rows,hasNext:false,signature:JSON.stringify(rows.map(r=>r.id))};
    }
    if(action==='retry'){job.intent={action:'retry',ids:args.ids};try{return await invokeRetry();}catch(error){if(!error.notSubmitted)error.uncertain=true;throw error;}}
    if(action==='claim'){claimed=true;args.ids.forEach(id=>claimedIds.add(id));}
    if(action==='move')moving=args.ids.length;
    if(action==='moveProgress')return {done:true,success:moving,failed:0};
    if(action==='editProduct')return {url:listing(args.record).editUrl};
    if(action==='fill')return {written:['离线模拟后续填写'],title:args.record.title};
    if(action==='preflight')return {checked:[]};
    if(action==='publishStatus')return {done:true,submitted:true};
    return {};
  }};
  await new DXMWorkflow(job,io).run();const summary=DXMUI.summary(job);
  if(summary.success!==20||summary.review!==1||summary.failed!==0||retryClicks!==1||job.intent)throw new Error('异常隔离校验失败：'+JSON.stringify(summary));
  byId('stats').innerHTML='<span>完成离线后续流程 <strong>'+summary.success+'</strong></span><span>待核对 <strong>'+summary.review+'</strong></span><span>失败 <strong>'+summary.failed+'</strong></span>';
  byId('trace').textContent=job.logs.slice(-6).map(entry=>entry.message).join(' | ');
  return '验证通过：1条重试无反馈，仅该条待核对；其他20条继续。重试只提交1次，结果不明的记录不会再次重试。';
}
async function runRetryFixture(mode){
  document.querySelectorAll('#cases button').forEach(button=>button.disabled=true);byId('result').dataset.state='running';byId('result').textContent='正在离线验证…';
  try{
    await setupRetry(mode);
    if(mode==='skip')byId('rows').querySelector('td:last-child').textContent='跳过采集：采集已经采集过';
    if(mode==='isolation')byId('result').textContent=await verifyIsolation();
    else{
      const result=await invokeRetry();
      if(result.mode==='modal'){let state;do{state=await DXMAdapter.commands.progress();if(!state.done)await pause(200);}while(!state.done);await DXMAdapter.commands.closeProgress();}
      if(retryClicks!==1||(['popover','popconfirm'].includes(mode)&&confirmClicks!==1))throw new Error('发生重复提交或确认');
      byId('result').textContent='验证通过：'+({modal:'进度弹窗',popover:'确认气泡',direct:'无弹窗提示',list:'列表状态变化'}[mode]||mode)+'已识别；重试提交 '+retryClicks+' 次，确认 '+confirmClicks+' 次。';
    }
    byId('result').dataset.state='passed';return {passed:true,retryClicks,confirmClicks};
  }catch(error){byId('result').dataset.state='failed';byId('result').textContent=error.message;return {passed:false,message:error.message,notSubmitted:!!error.notSubmitted,retryClicks,confirmClicks};}
  finally{document.querySelectorAll('#cases button').forEach(button=>button.disabled=false);}
}
document.querySelectorAll('#cases button').forEach(button=>button.onclick=()=>runRetryFixture(button.dataset.case));
