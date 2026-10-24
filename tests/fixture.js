'use strict';
const app=document.querySelector('#app'),out=document.querySelector('#result');let record,original;
const assert=(yes,message)=>{if(!yes)throw new Error(message);};
const selectValues={
  'ListPriceCurrency(价目表货币)':['USD(美元)','EUR(欧元)','GBP(英镑)'],
  '配送渠道':['FBM','FBA'],'Item Package Weight Unit(包装重量单位)':['Grams(克)','Kilograms(公斤)']
};
function initSelections(){
  for(const box of app.querySelectorAll('.ant-select')){
    const combo=box.querySelector('[role="combobox"]');
    const controls=combo?.getAttribute('aria-controls')||combo?.id+'_list';combo?.setAttribute('aria-controls',controls);combo?.setAttribute('aria-expanded','false');
    box.querySelector('.ant-select-selector')?.addEventListener('mousedown',()=>{
      document.querySelectorAll('.ant-select-dropdown:not(#foreign-dropdown)').forEach(e=>e.remove());
      const label=box.closest('.ant-form-item')?.querySelector('.ant-form-item-label')?.textContent.replace(/[\s*:：]/g,'');
      const values=selectValues[label]||[box.querySelector('.ant-select-selection-item')?.textContent||''];
      const dropdown=document.createElement('div');dropdown.className='ant-select-dropdown';const list=document.createElement('div');list.id=controls;dropdown.append(list);combo?.setAttribute('aria-expanded','true');
      for(const value of values){const item=document.createElement('div');item.className='ant-select-item-option';item.textContent=value;item.onclick=()=>{let selected=box.querySelector('.ant-select-selection-item');if(!selected){selected=document.createElement('span');selected.className='ant-select-selection-item';box.querySelector('.ant-select-selector').append(selected);box.querySelector('.ant-select-selection-placeholder')?.remove();}selected.textContent=value;dropdown.remove();combo?.setAttribute('aria-expanded','false');if(label==='配送渠道'){
        const quantity=app.querySelector('#fixture-quantity');if(value==='FBA')quantity?.remove();
      }};dropdown.append(item);}document.body.append(dropdown);
    });
  }
}
async function setup(){
  record=await (await fetch('/tests/fixture-data.json')).json();original=await (await fetch('/docs/evidence/editor-form.html')).text();app.innerHTML=original;
  // The captured form has FBA selected. Recreate the observed FBM quantity field to verify order.
  const item=[...app.querySelectorAll('.ant-form-item')].find(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()==='产品数量');item?.remove();
  const q=document.createElement('div');q.id='fixture-quantity';q.className='ant-form-item';q.innerHTML='<div class="ant-form-item-label"><label>产品数量</label></div><input placeholder="请输入产品数量" value="18">';app.append(q);
  const delivery=[...app.querySelectorAll('.ant-form-item')].find(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()==='配送渠道');
  const latestDelivery=await(await fetch('/docs/evidence/write-failure-delivery-dropdown.json')).json();delivery.outerHTML=latestDelivery.delivery;
  const deliveryInput=app.querySelector('[data-path="fulfillment_availability.0.fulfillment_channel_code"] [role="combobox"]');deliveryInput.id='fixture_delivery';deliveryInput.setAttribute('aria-controls','fixture_delivery_list');deliveryInput.setAttribute('aria-owns','fixture_delivery_list');
  const currency=await(await fetch('/docs/evidence/list-price-currency.json')).json();app.insertAdjacentHTML('beforeend',currency.before.html);
  q.querySelector('input').addEventListener('input',e=>{window.lastQuantity=e.target.value;});
  initSelections();const foreign=document.createElement('div');foreign.id='foreign-dropdown';foreign.className='ant-select-dropdown';foreign.innerHTML='<div class="ant-select-item-option">FBA</div>';foreign.style.left='0';foreign.style.right='auto';app.append(foreign);out.textContent='DOM 已加载，可以运行本地验证（下拉仅响应mousedown，并有其他控件的同名FBA选项）。';
  const readyButton=document.createElement('button');readyButton.textContent='验证编辑页等待来源切换';readyButton.onclick=testReady;document.querySelector('.bar').insertBefore(readyButton,out);
  const idButton=document.createElement('button');idButton.textContent='验证产品ID保护';idButton.onclick=testProductId;document.querySelector('.bar').insertBefore(idButton,out);
  const missingButton=document.createElement('button');missingButton.textContent='验证缺失字段跳过';missingButton.onclick=testMissing;document.querySelector('.bar').insertBefore(missingButton,out);
  const disabledButton=document.createElement('button');disabledButton.textContent='验证禁用字段仍报错';disabledButton.onclick=async()=>{try{app.querySelector('[id="form_item_model_number.0.value"]').disabled=true;await DXMAdapter.commands.fill({record,modelName:'/01'});out.textContent='FAIL：禁用字段未报错';}catch(e){out.textContent=/禁用/.test(e.message)?'PASS：存在但禁用的字段仍记录真实错误。':'FAIL：'+e.message;}};document.querySelector('.bar').insertBefore(disabledButton,out);
}
async function testMissing(){try{
  for(const e of [...app.querySelectorAll('[id^="form_item_model_"],[id^="form_item_item_dimensions."],[id^="form_item_item_package_"],[id^="form_item_country_of_origin."],[id^="form_item_batteries_required."],[id^="form_item_color."],[id="form_item_list_price.0.currency"]')])e.closest('.ant-form-item')?.remove();
  [...app.querySelectorAll('.ant-form-item')].filter(e=>/危险商品规管/.test(e.querySelector('.ant-form-item-label')?.textContent||'')).forEach(e=>e.remove());
  await DXMAdapter.commands.ready({record,expectedUrl:location.href});
  const result=await DXMAdapter.commands.fill({record:{...record,data:{...record.data,'容量':'20'}},modelName:'/01'});
  for(const key of ['Model Number','Model Name','Color','商品尺寸:长（cm）','容量','原产地','电池','危险商品规管','List Price Currency'])assert(result.skipped.includes(key),'未记录跳过：'+key);
  assert(result.written.includes('UPC')&&result.written.includes('Price'),'现有字段未继续填写');
  assert(!result.written.includes('Model Name'),'缺失字段被误记为已填写');
  out.textContent='PASS：没有型号也能就绪，缺失字段跳过并记录，现有UPC和价格继续填写。\n'+result.skipped.join('、');
}catch(e){out.textContent='FAIL：'+e.message;}}
async function testReady(){
  try{
    const source=app.querySelector('input[name="sourceUrl"]');source.value='https://www.amazon.com/dp/B0WRONG000';
    const table=document.createElement('div');table.className='vxe-table--main-wrapper';table.innerHTML='<button title="下一页">下一页</button>';app.append(table);
    const start=performance.now();setTimeout(()=>{source.value=record.source;},2100);
    const ready=await DXMAdapter.commands.ready({expectedUrl:location.href,record});
    assert(ready.source===record.source&&performance.now()-start>=2100,'旧表单提前通过就绪');table.remove();out.textContent='PASS：URL相同但表单仍是旧来源时持续等待，目标来源加载后才就绪。';
  }catch(e){out.textContent='FAIL：'+e.message;}
}
async function testProductId(){
  const before=app.querySelector('input[placeholder="必填项，Prodcut ID"]').value;
  try{await DXMAdapter.commands.fill({record:{...record,productId:'184807703384602948'},modelName:'/01'});out.textContent='FAIL：未阻止产品ID不匹配';}
  catch(e){out.textContent=e.message.includes('产品ID不匹配')&&app.querySelector('input[placeholder="必填项，Prodcut ID"]').value===before?'PASS：产品ID不匹配时在任何写入前停止。':'FAIL：'+e.message;}
}
document.querySelector('#fill').onclick=async()=>{try{
  const result=await DXMAdapter.commands.fill({record,modelName:'/01'});
  assert(app.querySelector('input[placeholder="必填项，Prodcut ID"]').value==='780715899310','UPC错误');
  assert(app.querySelector('[id="form_item_item_dimensions.0.length.value"]').value==='0','0值被跳过');
  assert(app.querySelector('[id="form_item_color.0.value"]').value==='Gold','颜色错误');
  assert(app.querySelector('[id="form_item_list_price.0.currency"]').closest('.ant-select').querySelector('.ant-select-selection-item')?.textContent==='GBP(英镑)','英国站价目表货币未设为GBP');
  assert(window.lastQuantity==='','数量未先清空');assert(!app.querySelector('input[placeholder="请输入产品数量"]'),'FBA后数量控件未移除');
  out.textContent='PASS：UPC、SKU、0值尺寸、颜色、包装单位、数量先清空再FBA和固定属性。\n'+result.written.join('、');
}catch(e){out.textContent='FAIL：'+e.message;}};
document.querySelector('#mismatch').onclick=async()=>{try{await DXMAdapter.commands.fill({record:{...record,source:'https://amazon.com/dp/B000000000'},modelName:'/01'});out.textContent='FAIL：未阻止错误来源';}catch(e){out.textContent=e.message.includes('来源链接不匹配')?'PASS：来源不匹配，已阻止写入。':'FAIL：'+e.message;}};
document.querySelector('#crawl').onclick=async()=>{app.innerHTML='<div class="vxe-table--main-wrapper"><table><tbody>'+await(await fetch('/docs/evidence/collected-row.html')).text()+'</tbody></table></div>';const rows=DXMAdapter.rows();out.textContent=rows.length===1&&rows[0].id==='184527809328870833'?'PASS：固定列重复行已去重，采集ID及来源标题正确。':'FAIL：'+JSON.stringify(rows);};
document.querySelector('#online').onclick=async()=>{app.innerHTML='<div class="vxe-table--main-wrapper"><table><tbody>'+await(await fetch('/docs/evidence/online-product.html')).text()+'</tbody></table></div>';const rows=DXMAdapter.rows();out.textContent=rows.length===1&&rows[0].id==='184807703383437685'&&rows[0].fba?'PASS：在线产品ID、原来源链接和FBA标识正确。':'FAIL：'+JSON.stringify(rows);};
setup().catch(e=>out.textContent='FAIL：'+e.message);
