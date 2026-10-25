// Offline DOM regression for both spellings of the UK site.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent('<div id="app"></div>');
    for(const name of ['core.js','work-target.js','batch-state.js','adapter.js'])await page.addScriptTag({path:path.join(__dirname,'../extension',name)});
    for(const [expected,actual] of [['UK','英国'],['英国','UK'],[' uk ','英国'],['DE','德国'],['德国','DE'],[' de ','德国']]){
      const result=await page.evaluate(async({expected,actual})=>{
        document.getElementById('app').innerHTML=`<input name="sourceUrl" value="https://amazon.com/dp/B0TEST0001">
          <div class="ant-form-item"><div class="ant-form-item-label">产品标题</div><input value="Test product"></div>
          <div class="ant-form-item"><div class="ant-form-item-label">店铺账号</div><span class="ant-select-selection-item">万万欣DE</span></div>
          <div class="ant-form-item"><div class="ant-form-item-label">站点选择</div><span class="ant-select-selection-item">${actual}</span></div>
          <div class="ant-form-item"><div class="ant-form-item-label">List Price Currency</div><div class="ant-select"><div class="ant-select-selector"><input id="form_item_list_price.0.currency" role="combobox" aria-controls="currency-list"><span class="ant-select-selection-item">EUR(欧元)</span></div></div></div>`;
        document.querySelector('.ant-select-selector').onmousedown=()=>{
          const dropdown=document.createElement('div');dropdown.className='ant-select-dropdown';dropdown.innerHTML='<div id="currency-list"><div class="ant-select-item-option">GBP(英镑)</div></div>';
          dropdown.querySelector('.ant-select-item-option').onclick=()=>{document.querySelector('.ant-select .ant-select-selection-item').textContent='GBP(英镑)';dropdown.remove();};document.body.append(dropdown);
        };
        const record={source:'https://amazon.com/dp/B0TEST0001',title:'Test product',targetShop:'万万欣DE',site:expected,data:DXMCore.sameSite(expected,'德国')?{'德国标题翻译':'Test product','产品数量':'unused'}:{}};
        const filled=await DXMAdapter.commands.fill({record});
        return {written:filled.written,currency:document.querySelector('.ant-select .ant-select-selection-item').textContent};
      },{expected,actual});
      assert.equal(result.currency,['DE','德国',' de '].includes(expected)?'EUR(欧元)':'GBP(英镑)');assert.equal(result.written.includes('List Price Currency：GBP(英镑)'),!['DE','德国',' de '].includes(expected));
    }
    const mismatch=await page.evaluate(async()=>{
      try{await DXMAdapter.commands.fill({record:{source:'https://amazon.com/dp/B0TEST0001',title:'Test product',targetShop:'万万欣DE',site:'美国',data:{}}});return '';}
      catch(error){return error.message;}
    });assert.match(mismatch,/站点不匹配/);
    for(const [expected,actual] of [['UK','英国'],['英国','UK'],['DE','德国'],['德国','DE']]){
      const selected=await page.evaluate(async({expected,actual})=>{
        document.getElementById('app').innerHTML=`<button id="claim">批量认领</button><div class="ant-modal" hidden>选择店铺-认领到采集箱<div class="shop-div" name="amazon"><label>[${actual}]万万欣DE<input id="correct" type="checkbox"></label><label>[美国]万万欣DE<input id="wrong" type="checkbox"></label></div><button id="confirm">确定</button></div>`;
        document.getElementById('claim').onclick=()=>document.querySelector('.ant-modal').hidden=false;
        document.getElementById('confirm').onclick=()=>document.querySelector('.ant-modal').insertAdjacentHTML('beforeend','<div id="commonProgressBarStatus">认领到采集箱</div>');
        await DXMAdapter.commands.claim({ids:[],shop:'万万欣DE',site:expected});
        return {correct:document.getElementById('correct').checked,wrong:document.getElementById('wrong').checked};
      },{expected,actual});assert.deepEqual(selected,{correct:true,wrong:false});
    }
    console.log('PASS：英国/UK、德国/DE双向兼容编辑页校验和批量认领；英国GBP、德国保留EUR；美国站仍拒绝匹配。全部使用本地模拟DOM。');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
