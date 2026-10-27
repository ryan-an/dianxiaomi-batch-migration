(function(){
  'use strict';
  const panel=globalThis.DXMPanel,root=panel?.root||document;
  const $=id=>root.getElementById(id);
  let parsed=null,fileInfo=null,job=null,owner=false,reading=false,starting=false,refreshing=false,error='',connectionError='';
  let logSignature='',lastLogJob='',clearing=false,clearPending=false,resetSerial=0,notice='',uiEpoch=0,fileWrite=Promise.resolve();
  const busy=()=>job?.state==='running';
  const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
  function parseBook(book){
    parsed=DXMCore.parseWorkbook(book,XLSX,{mergeSplit:true,shopAliases:DXMCore.alias});
  }
  function renderLogs(){
    const entries=job?.logs||[],signature=JSON.stringify(entries);if(signature===logSignature)return;logSignature=signature;
    const box=$('logs'),follow=box.scrollHeight-box.scrollTop-box.clientHeight<35,top=box.scrollTop;box.replaceChildren();
    if(!entries.length)box.append(node('p','开始后显示操作进度。','empty'));
    for(const entry of entries){const line=node('p',null,'entry'),time=node('time',(entry.time||'').match(/\d{1,2}:\d{2}:\d{2}/)?.[0]||'');time.title=entry.time||'';line.append(time,node('span',entry.message));box.append(line);}
    $('logCount').textContent=entries.length?`${entries.length} 条`:'';
    if(follow)box.scrollTop=box.scrollHeight;else box.scrollTop=top;
    $('latestLog').hidden=follow||!entries.length;
    if(job?.id!==lastLogJob&&busy()){$('logDetails').open=true;lastLogJob=job.id;box.scrollTop=box.scrollHeight;}
  }
  function render(){
    const s=DXMUI.summary(job),valid=parsed?.rows.filter(r=>!r.error).length||0,locked=busy()||reading||starting||clearing;
    $('upload').disabled=locked;$('start').disabled=locked||!valid||!!connectionError;
    $('startLabel').textContent=starting?'正在准备…':busy()?'执行中':job?'继续执行':'开始执行';
    $('stop').hidden=!busy();$('stop').disabled=s.stopping;$('stop').textContent=s.stopping?'停止中…':'停止';
    $('download').disabled=clearing||!job?.rows?.length;
    $('clearCache').disabled=locked;$('clearCache').textContent=clearing?'清空中…':'清空缓存';
    $('clearCache').title=busy()?'请先停止执行，等待任务结束后再清空缓存':'清空表格、执行记录、日志和面板设置；不删除店小秘产品';
    $('closePanel').disabled=busy()||starting||clearing;
    $('closePanel').title=busy()||starting?'执行过程中不能关闭，请先停止任务':'关闭面板';
    $('runNotice').hidden=!busy()&&!starting;
    $('filename').textContent=fileInfo?.name||'上传迁移表格';$('chooseFile').textContent=fileInfo?'更换':'选择文件';
    $('fileMeta').textContent=parsed?`已识别 ${parsed.rows.length} 条产品`:fileInfo?'表格未能解析，请重新上传':'支持 XLS / XLSX，也可以拖入文件';
    const invalid=(parsed?.rows.length||0)-valid;$('parseHint').hidden=!invalid;$('parseHint').textContent=`${invalid} 条数据需要处理，原因会保留在结果表。`;
    $('status').dataset.tone=connectionError||error?'error':s.tone;
    $('status').textContent=clearing?'正在清空缓存…':reading?'正在读取表格…':starting?'正在准备执行…':connectionError?'后台连接失败':error?'需要处理':notice|| (job?s.label:parsed?`准备就绪，将处理全部 ${parsed.rows.length} 条产品`:'请先上传表格');
    if(job?.state==='done'&&!clearing&&!reading&&!starting&&!connectionError&&!error&&!notice){
      const completed=node('span');completed.append('本轮结束，已发布',node('span',String(s.success),'published-count'),`条，总共${s.total}条`);$('status').replaceChildren(completed);
    }
    const message=error||connectionError||job?.error||'';$('message').hidden=!message;$('message').textContent=message;
    $('progress').hidden=!job;$('progressFill').style.width=`${s.percent}%`;$('progressBar').setAttribute('aria-valuenow',s.percent);
    $('progressText').textContent=`已处理 ${s.processed} / ${s.total} 条`;
    $('resultText').replaceChildren('已发布 ',node('span',String(s.success),'published-count'),` · 待确认 ${s.pending} · 失败 `,node('span',String(s.failed+s.review),'failed-count'),s.skipped?` · 已跳过 ${s.skipped}`:'');
    renderLogs();
    panel?.update({locked:(busy()&&owner)||starting,running:busy()||starting,summary:s});
  }
  async function importFile(file){
    if(!file||busy()||starting||reading||clearing)return;
    const epoch=++uiEpoch;notice='';
    if(!/\.xlsx?$/i.test(file.name)){error='请选择 .xls 或 .xlsx 表格。';render();return;}
    if(file.size>5*1024*1024){error='请使用 5 MB 以内的表格。';render();return;}
    reading=true;error='';render();
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());if(epoch!==uiEpoch)return;const book=XLSX.read(bytes,{type:'array'});
      const nextParsed=DXMCore.parseWorkbook(book,XLSX,{mergeSplit:true,shopAliases:DXMCore.alias});let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      fileWrite=chrome.runtime.sendMessage({kind:'DXM_IMPORT',file:{name:file.name,base64:btoa(binary)}});const imported=await fileWrite;
      if(!imported?.ok)throw new Error(imported?.error||'保存表格失败');
      if(epoch!==uiEpoch)return;parsed=nextParsed;fileInfo=imported.file;job=null;await refresh();
    }catch(e){if(epoch===uiEpoch){parsed=null;error=`表格导入失败：${e.message}`;}}finally{if(epoch===uiEpoch){reading=false;$('file').value='';render();}}
  }
  async function refresh(){
    if(refreshing||clearing)return;refreshing=true;const epoch=uiEpoch;
    try{const r=await chrome.runtime.sendMessage({kind:'DXM_STATUS'});if(epoch!==uiEpoch)return;if(!r?.ok)throw new Error(r?.error||'没有收到后台响应');job=r.job||null;owner=!!r.owner;connectionError='';}
    catch(e){if(epoch===uiEpoch)connectionError=`${e.message}。请重新加载扩展并刷新店小秘页面。`;}
    finally{refreshing=false;render();}
  }
  $('chooseFile').onclick=()=>$('file').click();$('file').onchange=()=>importFile($('file').files[0]);
  $('dropzone').ondragover=e=>{e.preventDefault();if(!busy()&&!starting&&!reading)$('dropzone').classList.add('dragging');};
  $('dropzone').ondragleave=()=>$('dropzone').classList.remove('dragging');
  $('dropzone').ondrop=e=>{e.preventDefault();$('dropzone').classList.remove('dragging');importFile(e.dataTransfer.files[0]);};
  $('start').onclick=async()=>{
    if(busy()||starting||clearing||!parsed?.rows.some(r=>!r.error))return;
    notice='';
    const epoch=uiEpoch;starting=true;error='';render();
    try{const r=await chrome.runtime.sendMessage({kind:'DXM_START',rows:parsed.rows,fileId:fileInfo?.id});if(epoch!==uiEpoch)return;if(!r?.ok)throw new Error(r?.error||'任务没有启动');await refresh();}
    catch(e){if(epoch===uiEpoch)error=e.message;}finally{if(epoch===uiEpoch){starting=false;render();}}
  };
  $('stop').onclick=async()=>{
    const epoch=uiEpoch;$('stop').disabled=true;
    try{const r=await chrome.runtime.sendMessage({kind:'DXM_STOP'});if(epoch!==uiEpoch)return;if(!r?.ok)throw new Error(r?.error||'停止请求没有发送');await refresh();}
    catch(e){if(epoch===uiEpoch){error=e.message;render();}}
  };
  function prepareCache(event){uiEpoch++;clearing=true;reading=false;starting=false;event?.detail?.waitUntil(fileWrite);render();}
  function resetView(){
    uiEpoch++;resetSerial++;parsed=null;fileInfo=null;job=null;owner=false;reading=false;starting=false;clearing=clearPending;
    error='';connectionError='';notice='缓存已清空，请重新上传表格';logSignature='';lastLogJob='';
    $('file').value='';$('logDetails').open=false;$('dropzone').classList.remove('dragging');render();
  }
  root.addEventListener('dxm-cache-prepare',prepareCache);
  root.addEventListener('dxm-cache-cleared',resetView);
  root.addEventListener('dxm-cache-failed',()=>{clearing=clearPending;render();refresh();});
  if(!panel)chrome.runtime.onMessage?.addListener((m,s,reply)=>{
    if(m.kind==='DXM_CACHE_PREPARE'){prepareCache();fileWrite.catch(()=>{}).then(()=>reply({ok:true}));return true;}
    if(m.kind==='DXM_CACHE_CLEARED'){resetView();reply({ok:true});}
    if(m.kind==='DXM_CACHE_FAILED'){clearing=clearPending;render();reply({ok:true});}
  });
  $('clearCache').onclick=async()=>{
    if(busy()||reading||starting||clearing)return;const resetBefore=resetSerial;clearPending=true;clearing=true;error='';render();
    try{const r=await chrome.runtime.sendMessage({kind:'DXM_CLEAR_CACHE'});if(!r?.ok)throw new Error(r?.error||'后台没有确认清空');if(resetBefore===resetSerial){resetView();panel?.reset();}}
    catch(e){error=e.message;}finally{clearPending=false;clearing=false;render();}
  };
  $('download').onclick=()=>{
    if(!job?.rows?.length)return;
    try{const sheet=XLSX.utils.aoa_to_sheet(DXMCore.resultTable(job.rows));sheet['!cols']=DXMCore.resultColumns.map(column=>({wch:column.width}));sheet['!autofilter']={ref:sheet['!ref']};const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'迁移结果');XLSX.writeFile(book,`迁移结果_${new Date().toISOString().slice(0,10)}.xlsx`);}
    catch(e){error=`结果导出失败：${e.message}`;render();}
  };
  $('latestLog').onclick=()=>{$('logs').scrollTop=$('logs').scrollHeight;$('latestLog').hidden=true;};
  $('logs').onscroll=()=>{$('latestLog').hidden=$('logs').scrollHeight-$('logs').clientHeight-$('logs').scrollTop<35;};
  $('closePanel').hidden=!panel;
  $('closePanel').onclick=()=>{if(!busy()&&!starting&&!clearing)panel?.close();};
  root.addEventListener('dxm-panel-open',refresh);
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.dxmJob)refresh();});
  async function init(){
    reading=true;render();const epoch=uiEpoch;
    try{const stored=await chrome.storage.local.get('dxmFile');if(epoch===uiEpoch&&stored.dxmFile){fileInfo=stored.dxmFile;parseBook(XLSX.read(fileInfo.base64,{type:'base64'}));}}
    catch(e){if(epoch===uiEpoch)error=`上次表格未能恢复，请重新上传：${e.message}`;}
    if(epoch===uiEpoch)reading=false;
    await refresh();setInterval(refresh,1500);
  }
  init();
})();
