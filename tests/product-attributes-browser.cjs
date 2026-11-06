// Replay the inspected Number of Items / Color / Size form entirely offline.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),evidence=JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/required-product-attributes-20261106.json'),'utf8'));
(async()=>{
  const browser=await chromium.launch({...(process.env.DXM_TEST_CHROMIUM?{executablePath:process.env.DXM_TEST_CHROMIUM}:{channel:'msedge'}),headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    async function setup(options={}){
      await page.goto('about:blank');
      await page.setContent('<input name="sourceUrl" value="https://amazon.com/dp/B0TEST0001"><div class="ant-form-item"><div class="ant-form-item-label">产品标题</div><input id="title" value="2 Pack Cake Pan"></div><div class="ant-form-item"><div class="ant-form-item-label">店铺账号</div><span class="ant-select-selection-item">Shop</span></div><div class="ant-form-item"><div class="ant-form-item-label">站点选择</div><span class="ant-select-selection-item" id="site">英国</span></div><div id="attrInfo">'+evidence.fields.map(field=>field.html).join('')+'</div><div id="transportInfo"><div class="ant-form-item"><div class="ant-form-item-label">产品数量</div><input id="inventory" placeholder="请输入产品数量" value="18"></div></div>');
      for(const file of ['core.js','work-target.js','adapter.js'])await page.addScriptTag({path:path.join(root,'extension',file)});
      await page.evaluate(options=>{
        window.record={source:'https://amazon.com/dp/B0TEST0001',title:'2 Pack Cake Pan',site:options.site||'UK',targetShop:'Shop',data:{'产品数量':'7','Color':'Silver','商品尺寸:长（cm）':'23.50','德国标题翻译':'Translated Cake Pan','List Price':'30.99',...options.data}};
        document.getElementById('site').textContent=record.site;window.originalData=JSON.stringify(record.data);window.events=[];
        const paths={'Number of Items':'number_of_items.0.value','Color':'color.0.value','Size':'size.0.value','Item Package Quantity':'item_package_quantity.0.value'};
        for(const [key,path] of Object.entries(paths)){
          const field=document.getElementById('form_item_'+path),item=field.closest('.ant-form-item');field.dataset.key=key;
          if(key==='Item Package Quantity'){field.value='77';continue;}
          if(options.optional&&key!=='Color'){item.querySelector('label').classList.remove('ant-form-item-required');item.querySelector('.ant-form-item-explain-error')?.remove();field.value=key==='Size'?'XL':'99';}
          if(options.colorRequired&&key==='Color')item.querySelector('label').classList.add('ant-form-item-required');
          if(options.marker&&key!=='Color'){
            item.querySelector('label').classList.remove('ant-form-item-required');
            if(options.marker==='aria')field.setAttribute('aria-required','true');
            if(options.marker==='native')field.required=true;
            if(options.marker==='asterisk')item.querySelector('label').prepend('*');
          }
          if(options.hiddenOld){const old=item.cloneNode(true);old.style.display='none';old.querySelector('input').value='Historical';item.before(old);}
          if(options.dynamic||options.labels)field.id='dynamic-'+key.replaceAll(' ','-');
          if(options.labels)item.querySelector('[data-path]').removeAttribute('data-path');
          if(options.aliasPaths&&key!=='Number of Items'){
            const alias=key==='Color'?'color_name.0.value':'size_name.0.value';field.id='form_item_'+alias;item.querySelector('[data-path]').setAttribute('data-path',alias);
          }
          if(options.disabled===key)field.disabled=true;if(options.readOnly===key)field.readOnly=true;
          if(options.duplicate===key)item.after(item.cloneNode(true));
          if(options.absent===key)item.remove();
        }
        let replaced=false,reset=false;
        document.addEventListener('input',event=>{
          const key=event.target.dataset.key;if(!key)return;events.push(key);
          event.target.closest('.ant-form-item').querySelector('.ant-form-item-explain-error')?.remove();
          if(options.replace===key&&!replaced){replaced=true;const fresh=event.target.cloneNode(true);fresh.value='';event.target.replaceWith(fresh);}
          if(options.reject===key)event.target.value='';
          if(options.crossReset&&key==='Color'&&!reset){reset=true;const field=document.querySelector('input[data-key="Number of Items"]'),fresh=field.cloneNode(true);fresh.value='';field.replaceWith(fresh);}
          if(options.stop===key)DXMAdapter.commands.stop();
        });
        if(record.site==='US'){
          document.body.insertAdjacentHTML('beforeend','<div class="ant-form-item"><div class="ant-form-item-label">List Price Currency</div><div class="ant-select"><input id="form_item_list_price.0.currency" role="combobox"><span class="ant-select-selection-item">USD(美元)</span></div></div><div class="ant-form-item"><div class="ant-form-item-label">List Price</div><input id="form_item_list_price.0.value" value="30.99"></div><div id="imageInfo"><div class="img-list"><div class="img-item"><img class="img-css" src="data:image/png;base64,AA=="><span class="img-size">500 X 500</span></div></div></div>');
        }
      },options);
    }
    const ensure=()=>page.evaluate(()=>DXMAdapter.commands.ensureSpreadsheetAttributes({record}));
    const values=()=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('input[data-key],#inventory')].filter(field=>field.getClientRects().length).map(field=>[field.dataset.key||'inventory',field.value])));
    for(const options of [{},{dynamic:true},{labels:true},{hiddenOld:true},{aliasPaths:true},{marker:'aria'},{marker:'native'},{marker:'asterisk'},{replace:'Color'},{replace:'Size'},{crossReset:true},{colorRequired:true},{data:{Color:'',color:'Blue'}},{data:{'商品尺寸:长（cm）':'','商品尺寸：长 (cm)':'0',Color:'0'}}]){
      await setup(options);const result=await ensure(),actual=await values();
      assert.equal(actual['Number of Items'],'7',JSON.stringify(options));assert.equal(actual.Size,options.data?.['商品尺寸：长 (cm)']??'23.50');assert.equal(actual.Color,options.data?.color??options.data?.Color??'Silver');assert.equal(actual['Item Package Quantity'],'77');assert.equal(actual.inventory,'18');
      assert.deepEqual(result.checked,['Number of Items','Size','Color']);assert.equal(await page.evaluate(()=>JSON.stringify(record.data)===originalData),true);
      if(options.hiddenOld)assert.ok((await page.locator('.ant-form-item[style="display: none;"] input').evaluateAll(fields=>fields.map(field=>field.value))).every(value=>value==='Historical'));
    }
    await setup({optional:true});const optional=await ensure();assert.deepEqual(optional.checked,['Color']);assert.deepEqual(await values(),{'Number of Items':'99','Item Package Quantity':'77',Color:'Silver',Size:'XL',inventory:'18'});
    await setup();await ensure();const count=await page.evaluate(()=>events.length);assert.deepEqual((await ensure()).repaired,[]);assert.equal(await page.evaluate(()=>events.length),count);
    await setup({absent:'Color'});assert.ok((await ensure()).skipped.includes('Color'));
    for(const [options,message] of [
      [{data:{'产品数量':''}},/Number of Items.*表格“产品数量”为空/],
      [{data:{'商品尺寸:长（cm）':''}},/Size.*表格“商品尺寸:长（cm）”为空/],
      [{colorRequired:true,data:{Color:''}},/Color.*表格“Color”为空/],
      [{readOnly:'Color'},/Color.*只读/],[{disabled:'Size'},/Size.*禁用/],[{reject:'Color'},/Color.*未保留/],
      [{duplicate:'Color'},/Color.*找到 2 个控件/],[{stop:'Color'},/已停止/]
    ]){await setup(options);await assert.rejects(ensure,message);}
    for(const site of ['UK','US','DE']){
      await setup({site,replace:'Color'});
      const result=await page.evaluate(async()=>{
        const filled=await DXMAdapter.commands.fill({record,continueOnError:true});record.title=filled.title;
        const afterFill=Object.fromEntries([...document.querySelectorAll('input[data-key]')].map(field=>[field.dataset.key,field.value]));
        for(const field of document.querySelectorAll('input[data-key]'))if(field.dataset.key!=='Item Package Quantity')field.value='';
        const checked=await DXMAdapter.commands.preflight({record});return {filled,afterFill,checked};
      });
      assert.equal(result.filled.warnings.length,0);for(const key of ['Number of Items','Size','Color']){assert.ok(result.filled.written.includes(key));assert.ok(result.checked.repaired.includes(key));}
      assert.equal(result.afterFill['Number of Items'],'7');assert.equal(result.afterFill.Size,'23.50');assert.equal(result.afterFill.Color,'Silver');assert.equal(result.filled.title,site==='UK'?'7 Pack Cake Pan':'Translated Cake Pan');
    }
    await setup({data:{'产品数量':''}});const isolated=await page.evaluate(()=>DXMAdapter.commands.fill({record,continueOnError:true}));assert.ok(isolated.warnings.some(warning=>warning.field==='Number of Items'));assert.equal((await values()).Color,'Silver');assert.equal((await values()).Size,'23.50');
    // A validation marker can appear after preflight; the publish guard repairs it.
    await setup({optional:true});await page.evaluate(()=>{document.querySelectorAll('input[data-key="Number of Items"],input[data-key="Size"]').forEach(field=>{field.required=true;field.value='';});window.clicks=0;window.atClick=null;const button=document.createElement('button');button.textContent='保存并发布';button.onclick=()=>{clicks++;atClick=Object.fromEntries([...document.querySelectorAll('input[data-key]')].map(field=>[field.dataset.key,field.value]));};document.body.append(button);});
    await page.evaluate(()=>DXMAdapter.commands.publish({record}));const published=await page.evaluate(()=>({clicks,atClick}));assert.equal(published.clicks,1);assert.equal(published.atClick['Number of Items'],'7');assert.equal(published.atClick.Size,'23.50');assert.equal(published.atClick.Color,'Silver');
    await setup({reject:'Color'});const rejected=await page.evaluate(async()=>{window.clicks=0;const button=document.createElement('button');button.textContent='保存并发布';button.onclick=()=>clicks++;document.body.append(button);try{await DXMAdapter.commands.publish({record});return {};}catch(error){return {message:error.message,notSubmitted:error.notSubmitted,clicks};}});assert.match(rejected.message,/Color.*未保留/);assert.equal(rejected.notSubmitted,true);assert.equal(rejected.clicks,0);
    // Inventory's identical placeholder must not clear Number of Items.
    await setup();await page.evaluate(()=>{
      document.querySelector('input[data-key="Number of Items"]').placeholder='请输入产品数量';window.inventoryAtFBA='';
      document.getElementById('transportInfo').insertAdjacentHTML('beforeend','<div class="ant-form-item"><div class="ant-form-item-label">配送渠道</div><div class="ant-select"><div class="ant-select-selector"><input role="combobox" aria-controls="shipping-options" aria-expanded="false"><span class="ant-select-selection-item">FBA</span></div></div></div>');
      const box=document.querySelector('#transportInfo .ant-select'),combo=box.querySelector('input');box.querySelector('.ant-select-selector').onmousedown=()=>{combo.setAttribute('aria-expanded','true');const dropdown=document.createElement('div');dropdown.className='ant-select-dropdown';dropdown.innerHTML='<div id="shipping-options"></div>';for(const value of ['FBM','FBA']){const option=document.createElement('div');option.className='ant-select-item-option';option.textContent=value;option.onclick=()=>{box.querySelector('.ant-select-selection-item').textContent=value;combo.setAttribute('aria-expanded','false');dropdown.remove();if(value==='FBA'){inventoryAtFBA=document.getElementById('inventory').value;document.getElementById('inventory').remove();}};dropdown.append(option);}document.body.append(dropdown);};
    });
    const inventoryFill=await page.evaluate(()=>DXMAdapter.commands.fill({record,continueOnError:true}));assert.equal(inventoryFill.warnings.length,0);assert.equal(await page.evaluate(()=>inventoryAtFBA),'');assert.equal((await values())['Number of Items'],'7');
    console.log('PASS: inspected required item count and size use spreadsheet count and item length; optional Color always filled; IDs/paths/labels, case/punctuation aliases, zero, rerender/cross-field reset, optional preservation, stock/package isolation, fill/preflight/publish repair, missing source and failed-write guards. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
