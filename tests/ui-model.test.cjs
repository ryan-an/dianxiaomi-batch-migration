const test=require('node:test'),assert=require('node:assert/strict'),U=require('../extension/ui-model.js');
test('执行范围验证正整数并截到实际产品数量',()=>{
  const rows=Array.from({length:10},(_,i)=>({index:i,error:i===4?'链接错误':''}));
  const r=U.range(rows,3,99);assert.equal(r.start,3);assert.equal(r.end,10);assert.equal(r.count,8);assert.equal(r.valid,7);
  for(const [s,n] of [[0,1],[1,0],[1.2,1],[1,1.1],['',1],[11,1]])assert.ok(U.range(rows,s,n).error);
});
test('已提交与真正上线区分；只统计本轮选择范围',()=>{
  const job={state:'done',options:{startIndex:2,limit:2},rows:[{status:'数据错误'},{status:'已上线'},{status:'已提交待确认'},{status:'失败'}]};
  const s=U.summary(job);assert.equal(s.total,2);assert.equal(s.success,1);assert.equal(s.pending,1);assert.equal(s.failed,0);assert.equal(s.percent,100);assert.equal(s.tone,'paused');assert.match(s.label,/等待平台确认/);
});
test('停止请求到后台结束之间仍属于执行中',()=>{
  const job={state:'running',stop:true,step:'正在停止',rows:[{status:'待执行'}],options:{startIndex:1,limit:1}};
  const s=U.summary(job);assert.equal(s.busy,true);assert.equal(s.stopping,true);assert.equal(s.percent,0);
  job.state='stopped';job.rows[0].status='已停止';assert.equal(U.summary(job).busy,false);assert.equal(U.summary(job).percent,100);
});
test('中断与失败不显示完成成功状态',()=>{
  const rows=[{status:'待人工核对'}];assert.equal(U.summary({state:'review',rows}).tone,'error');assert.equal(U.summary({state:'review',rows}).review,1);
  assert.equal(U.summary({state:'error',rows}).tone,'error');
  assert.equal(U.summary({state:'done',rows:[{status:'失败'}]}).failed,1);
  assert.equal(U.summary({state:'done',rows:[{status:'已上线'}]}).tone,'success');
  assert.equal(U.summary(null).total,0);
});
test('店小秘标签显示中文页面用途',()=>{assert.equal(U.tabLabel({url:'https://www.dianxiaomi.com/web/amazon/pageList/offline'}),'店小秘 · 待发布产品');assert.equal(U.statusTone('待人工核对'),'error');});

test('批次继续完成后，有发布结果待核对时不显示全部成功',()=>{
  const s=U.summary({state:'done',rows:[{status:'已发布'},{status:'待人工核对'}]});
  assert.equal(s.tone,'error');assert.equal(s.review,1);assert.match(s.label,/1 条产品的发布结果待核对/);assert.equal(s.percent,100);
});
