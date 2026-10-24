(function(root){
  'use strict';
  const terminal=new Set(['已发布','已上线','已提交待确认','失败','发布失败','数据错误','已跳过','已停止','待人工核对']);
  function range(rows,startValue,limitValue){
    const start=Number(startValue),limit=Number(limitValue),total=rows.length;
    if(!Number.isInteger(start)||start<1)return {error:'起始产品请填写大于 0 的整数。',rows:[]};
    if(!Number.isInteger(limit)||limit<1)return {error:'执行数量请填写大于 0 的整数。',rows:[]};
    if(start>total)return {error:`表格共有 ${total} 条产品，起始位置超出了范围。`,rows:[]};
    const selected=rows.slice(start-1,start-1+limit);
    return {start,end:start+selected.length-1,count:selected.length,valid:selected.filter(r=>!r.error).length,rows:selected,error:''};
  }
  function summary(job){
    if(!job)return {busy:false,stopping:false,tone:'idle',label:'准备就绪',total:0,processed:0,success:0,pending:0,failed:0,review:0,skipped:0,percent:0};
    const selected=job.options?range(job.rows,job.options.startIndex||1,job.options.limit||job.rows.length).rows:job.rows.filter(r=>r.status!=='未执行');
    const count=s=>selected.filter(r=>s.includes(r.status)).length;
    const value={busy:job.state==='running',stopping:job.state==='running'&&!!job.stop,total:selected.length,processed:selected.filter(r=>terminal.has(r.status)).length,success:count(['已发布','已上线']),pending:count(['已提交待确认']),failed:count(['失败','发布失败','数据错误']),review:count(['待人工核对']),skipped:count(['已跳过'])};
    value.percent=value.total?Math.round(value.processed/value.total*100):0;
    if(value.stopping)Object.assign(value,{tone:'paused',label:'正在停止，请等待当前步骤结束'});
    else if(value.busy)Object.assign(value,{tone:'running',label:job.step||'正在准备迁移'});
    else if(job.state==='review')Object.assign(value,{tone:'error',label:'需要核对当前产品，已停止自动操作'});
    else if(job.state==='error')Object.assign(value,{tone:'error',label:'执行中断，请查看原因'});
    else if(job.state==='stopped')Object.assign(value,{tone:'paused',label:'已停止，本轮记录已保留'});
    else if(value.failed)Object.assign(value,{tone:'error',label:`本轮结束，${value.failed} 条产品需要处理`});
    else if(value.review)Object.assign(value,{tone:'error',label:`本轮结束，${value.review} 条产品的发布结果待核对`});
    else if(value.pending)Object.assign(value,{tone:'paused',label:`已提交发布，${value.pending} 条等待平台确认`});
    else if(value.success)Object.assign(value,{tone:'success',label:`本轮完成，${value.success} 条已发布`});
    else Object.assign(value,{tone:'idle',label:value.skipped?`本轮结束，${value.skipped} 条已跳过`:'本轮已结束'});
    return value;
  }
  function tabLabel(tab){
    try{const p=new URL(tab.url).pathname;const page=p.includes('dataAcquisition')?'数据采集':p.includes('/draft')?'采集箱':p.includes('/offline')?'待发布产品':p.includes('/online')?'在线产品':p.includes('/edit')?'产品编辑':'工作页面';return `店小秘 · ${page}`;}catch{return tab.title||'店小秘页面';}
  }
  function statusTone(status){return ['已发布','已上线'].includes(status)?'success':['失败','发布失败','数据错误','待人工核对'].includes(status)?'error':['已停止','已提交待确认'].includes(status)?'paused':status==='未执行'||status==='已跳过'?'idle':'running';}
  const api={range,summary,tabLabel,statusTone};root.DXMUI=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
