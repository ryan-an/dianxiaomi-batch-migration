const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup({present=true,required=false,aria=false,native=false,value='',disabled=false}={}){
  class Input {get value(){return this._value||'';}set value(v){this._value=v;}getAttribute(name){return name==='aria-required'&&aria?'true':null;}closest(){return {querySelector:()=>required?{}:null};}dispatchEvent(e){events.push(e.type);}}
  const events=[],field=new Input();field.value=value;field.required=native;field.disabled=disabled;field.tagName='INPUT';
  const context={DXMCore:require('../extension/core.js'),document:{getElementById:()=>present?field:null},HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},FocusEvent:class{constructor(type){this.type=type;}},setTimeout};
  vm.runInNewContext(fs.readFileSync('extension/adapter.js','utf8'),context);
  return {run:()=>context.DXMAdapter.commands.ensurePartNumber(),field,events};
}
test('必填零件编号固定为文本01，覆盖已有值并触发表单事件',async()=>{const s=setup({required:true,value:'/99'});assert.equal((await s.run()).value,'01');assert.equal(s.field.value,'01');assert.deepEqual(s.events,['input','change','blur']);});
test('aria-required和原生required必填标记均填写01',async()=>{for(const flags of [{aria:true},{native:true}]){const s=setup(flags);await s.run();assert.equal(s.field.value,'01');}});
test('非必填零件编号保留原值，缺失字段跳过',async()=>{const s=setup({value:'original'});assert.equal((await s.run()).changed,false);assert.equal(s.field.value,'original');assert.equal((await setup({present:false}).run()).absent,true);});
test('必填零件编号禁用时报告失败',async()=>{await assert.rejects(setup({required:true,disabled:true}).run(),/输入框被禁用/);});
