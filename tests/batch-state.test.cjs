const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const B=require('../extension/batch-state.js');
const final=(success,failed)=>({title:'执行结果',text:`执行成功：${success}个，产品成功移入待发布\n执行失败：${failed}\n关闭`});
test('实测最终弹窗必须有成功、失败数，按商品数核对而不是分组勾选数',()=>{
  const actual=JSON.parse(fs.readFileSync('docs/evidence/move-regression-progress.json','utf8')).modals[0];
  assert.deepEqual(B.move({title:'执行结果',text:actual.text},1),{done:true,success:1,failed:0,text:actual.text});
});
test('确认弹窗、空窗、百分比100及普通进度已完成都不能视为移入最终结果',()=>{
  for(const s of [{},{title:'提示',text:'确定要移入待发布吗？'},{title:'批量移入',state:'已完成!',text:'进度100%'},{title:'执行结果',text:'执行成功：0\n执行失败：0'}])assert.equal(B.move(s,8).done,false);
});
test('最终数量未覆盖本页全部产品时继续等待',()=>{const p=B.move(final(7,0),8);assert.equal(p.done,false);assert.match(p.text,/7 \/ 8/);});
test('有进行中状态或加载动画时，即使已有统计也不能提前关闭',()=>{
  assert.equal(B.move({...final(8,0),state:'进行中...'},8).done,false);
  assert.equal(B.move({...final(8,0),loading:true},8).done,false);
});
test('保留全部失败和部分失败数量供工作流中止',()=>{
  assert.equal(B.move(final(7,1),8).failed,1);assert.equal(B.move(final(0,8),8).failed,8);
});

test('只允许本组子变体的重复移入提示进入待发布核对，其他失败仍阻止',()=>{
  const text='执行成功：1个\n执行失败：2\n产品：101\u2003失败原因：只能处在采集箱中的产品才能移入待发布！\n产品：102\u2003失败原因：只能处在采集箱中的产品才能移入待发布！';
  const result=B.move({title:'执行结果',text},3);
  assert.equal(B.movedChildren(result,['101','102']),true);
  for(const ids of [[],['101'],['101','103']])assert.equal(B.movedChildren(result,ids),false);
  assert.equal(B.movedChildren({...result,failed:1},['101','102']),false);
  assert.equal(B.movedChildren({...result,success:0},['101','102']),false);
  assert.equal(B.movedChildren({...result,failures:[{id:'101',reason:'其他错误'},{id:'102',reason:'只能处在采集箱中的产品才能移入待发布！'}]},['101','102']),false);
});
