const test=require('node:test'),assert=require('node:assert/strict'),{fit}=require('../extension/panel-layout.js');
test('初始面板留在屏幕右侧，保留导航空间',()=>{assert.deepEqual(fit(null,{width:1280,height:720},{width:480,height:340}),{left:780,top:112});});
test('拖动或恢复旧屏幕位置时，标题栏保持在可见区域',()=>{
  const view={width:1280,height:720},size={width:480,height:500};assert.deepEqual(fit({left:-200,top:-500},view,size),{left:12,top:12});assert.deepEqual(fit({left:2200,top:1800},view,size),{left:788,top:208});
});
test('窄屏及错误坐标也能恢复面板',()=>{
  assert.deepEqual(fit({left:NaN,top:Infinity},{width:320,height:500},{width:296,height:476}),{left:12,top:12});
});
