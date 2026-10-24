'use strict';
const app=document.getElementById('app'),out=document.getElementById('result');
const assert=(value,message)=>{if(!value)throw new Error(message);};
function setup(count,already=false,defaultIndex=0){
  let clicks=0,confirmed=0;
  app.innerHTML='<div class="ant-select"><input id="form_item_category"><span class="ant-select-selection-item">'+(already?'已选择分类':'')+'</span></div><button id="auto">自动识别产品类型</button>';
  document.getElementById('auto').onclick=()=>{
    clicks++;const m=document.createElement('div');m.className='ant-modal';m.innerHTML='<h3>Amazon推荐产品类型</h3><p>推荐产品类型：DISHWARE_PLATE</p>'+Array.from({length:count},(_,i)=>'<label><input type="radio" name="category" '+(i===defaultIndex?'checked':'')+'>分类'+i+'</label>').join('')+'<button>确定</button>';app.append(m);
    m.querySelector('button').onclick=()=>{confirmed++;app.querySelector('.ant-select-selection-item').textContent='唯一推荐分类';m.remove();};
  };
  return {clicks:()=>clicks,confirmed:()=>confirmed};
}
document.getElementById('test').onclick=async()=>{try{
  const existing=setup(1,true);const kept=await DXMAdapter.commands.ensureCategory();assert(!kept.changed&&existing.clicks()===0,'已有分类被修改');
  const single=setup(1);const filled=await DXMAdapter.commands.ensureCategory();assert(filled.changed&&single.clicks()===1&&single.confirmed()===1,'唯一推荐未确认');
  const multi=setup(2,false,1);const chosen=await DXMAdapter.commands.ensureCategory();assert(multi.confirmed()===1&&chosen.recommendedPath==='分类1'&&chosen.recommendedType==='DISHWARE_PLATE','没有选择平台默认推荐或未记录类型');
  const fallback=setup(2,false,-1);const first=await DXMAdapter.commands.ensureCategory();assert(fallback.confirmed()===1&&first.recommendedPath==='分类0','无默认项时未选择第一条推荐');
  out.textContent='PASS：已有分类保留；空分类识别；唯一推荐确认；多项优先平台默认项；无默认时第一条；记录推荐类型与路径。';
}catch(e){out.textContent='FAIL：'+e.message;}};
