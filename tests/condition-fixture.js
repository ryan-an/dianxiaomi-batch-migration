'use strict';
const app=document.getElementById('app'),out=document.getElementById('result');
const assert=(value,message)=>{if(!value)throw new Error(message);};
async function setup(required){
  const data=await(await fetch('/docs/evidence/condition-new.json')).json();app.innerHTML=data.before.html;
  const label=app.querySelector('.ant-form-item-label label');if(!required)label.classList.remove('ant-form-item-required');
  const box=app.querySelector('.ant-select'),combo=box.querySelector('[role="combobox"]');let clicks=0;
  box.querySelector('.ant-select-selector').onmousedown=()=>{
    clicks++;const dropdown=document.createElement('div');dropdown.className='ant-select-dropdown';dropdown.innerHTML='<div id="'+combo.getAttribute('aria-controls')+'"></div>';
    for(const name of ['Collectible - Like New(收藏品-像新的)','New(新的)','New - OEM(新-原始设备制造商)','New - Open Box(新打开的盒子)']){
      const option=document.createElement('div');option.className='ant-select-item-option';option.textContent=name;option.onclick=()=>{let selected=box.querySelector('.ant-select-selection-item');if(!selected){selected=document.createElement('span');selected.className='ant-select-selection-item';box.querySelector('.ant-select-selector').append(selected);}selected.textContent=name;dropdown.remove();};dropdown.append(option);
    }app.append(dropdown);
  };
  return {clicks:()=>clicks,selected:()=>box.querySelector('.ant-select-selection-item')?.textContent};
}
document.getElementById('test').onclick=async()=>{try{
  const required=await setup(true);const selected=await DXMAdapter.commands.ensureCondition();assert(selected.changed&&required.selected()==='New(新的)','必填时未精确选择New');
  const optional=await setup(false);await DXMAdapter.commands.ensureCondition();assert(optional.clicks()===0,'非必填字段被改动');
  app.replaceChildren();assert((await DXMAdapter.commands.ensureCondition()).absent,'缺失字段未跳过');
  out.textContent='PASS：必填精确选择New，排除Like New/OEM/Open Box；非必填保留；字段不存在跳过。';
}catch(e){out.textContent='FAIL：'+e.message;}};
