// Offline replay of the US list_price.0.value/currency structure inspected live.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    async function setup(options={}){
      await page.setContent('<div id="app"><input name="sourceUrl" value="https://amazon.com/dp/B0D5CZB7W8"><div class="ant-form-item"><div class="ant-form-item-label">产品标题</div><input value="2 PCS Bonnet Set"></div><div class="ant-form-item"><div class="ant-form-item-label">店铺账号</div><span class="ant-select-selection-item">琛迅通US</span></div><div class="ant-form-item"><div class="ant-form-item-label">站点选择</div><span class="ant-select-selection-item">美国</span></div><input name="price" value="1"><div hidden><input id="form_item_list_price.0.value_with_tax" value="999"></div></div>');
      for(const file of ['core.js','work-target.js','adapter.js'])await page.addScriptTag({path:path.join(root,'extension',file)});
      await page.evaluate(options=>{
        window.record={title:'2 PCS Bonnet Set',source:'https://amazon.com/dp/B0D5CZB7W8',targetShop:'琛迅通US',site:options.site||'US',data:{'Price':'9.95','List Price':options.blank?'':options.zero?'0':'18.99','德国标题翻译':'2 PCS Bonnet Set'}};
        const pathAttr=value=>options.labels?'':`data-path="${value}"`;
        const mountCurrency=()=>{
          document.getElementById('app').insertAdjacentHTML('beforeend',`<div class="ant-form-item"><div ${pathAttr('list_price.0.currency')}><div class="ant-form-item-label"><label class="ant-form-item-required">List Price Currency(价目表货币)</label></div><div class="ant-select"><div class="ant-select-selector"><input id="${options.dynamic||options.labels?'dynamic-currency':'form_item_list_price.0.currency'}" role="combobox" readonly aria-expanded="false" aria-controls="us-currency-list"><span class="ant-select-selection-placeholder">请选择</span></div></div></div></div>`);
          const combo=document.querySelector('[role="combobox"]'),box=combo.closest('.ant-select');
          if(options.wrong){const selected=document.createElement('span');selected.className='ant-select-selection-item';selected.textContent='EUR(欧元)';box.append(selected);}
          box.querySelector('.ant-select-selector').onmousedown=()=>{
            combo.setAttribute('aria-expanded','true');
            const dropdown=document.createElement('div');dropdown.className='ant-select-dropdown';
            // Match the real hidden ARIA list and separate visible virtual option.
            dropdown.innerHTML='<div role="listbox" id="us-currency-list" style="height:0;width:0;overflow:hidden"><div role="option" aria-label="USD(美元)">USD</div></div><div class="ant-select-item ant-select-item-option" title="USD(美元)"><div class="ant-select-item-option-content"><div><span>USD(美元) </span></div></div></div>';
            dropdown.querySelector('.ant-select-item-option').onclick=()=>{
              let selected=box.querySelector('.ant-select-selection-item');if(!selected){selected=document.createElement('span');selected.className='ant-select-selection-item';box.append(selected);}
              selected.textContent='USD(美元)';box.querySelector('.ant-select-selection-placeholder')?.remove();combo.setAttribute('aria-expanded','false');dropdown.remove();
            };
            document.body.append(dropdown);
          };
        };
        const mountAmount=()=>{
          document.getElementById('app').insertAdjacentHTML('beforeend',`<div class="ant-form-item"><div ${pathAttr('list_price.0.value')}><div class="ant-form-item-label"><label class="ant-form-item-required">List Price(不含税价目表)</label></div><input id="${options.dynamic||options.labels?'dynamic-amount':'form_item_list_price.0.value'}" value="${options.blank?'77':''}"></div></div>`);
          const field=document.getElementById(options.dynamic||options.labels?'dynamic-amount':'form_item_list_price.0.value');field.dataset.amount='true';
          if(options.disabled)field.readOnly=true;
          window.amountWrites=0;
          field.oninput=()=>{amountWrites++;if(options.reject)field.value='';if(options.replace){const fresh=field.cloneNode(true);fresh.value='';field.replaceWith(fresh);}};
        };
        if(options.delayed){setTimeout(mountCurrency,300);setTimeout(mountAmount,900);}else{mountCurrency();mountAmount();}
        // A similarly named option in another dropdown must never be clicked.
        const foreign=document.createElement('div');foreign.className='ant-select-dropdown';foreign.innerHTML='<div class="ant-select-item-option">EUR(欧元)</div>';foreign.onclick=()=>{throw Error('wrong dropdown');};document.body.append(foreign);
      },options);
    }
    for(const options of [{},{site:'美国',dynamic:true,wrong:true},{labels:true},{delayed:true},{replace:true},{zero:true}]){
      await setup(options);
      const result=await page.evaluate(async()=>{
        const filled=await DXMAdapter.commands.fill({record,continueOnError:true});record.title=filled.title;
        return {filled,price:document.querySelector('input[name="price"]').value,amount:document.querySelector('[data-amount]').value,currency:document.querySelector('.ant-select .ant-select-selection-item')?.textContent,hidden:document.getElementById('form_item_list_price.0.value_with_tax').value};
      });
      assert.equal(result.amount,options.zero?'0':'18.99');assert.equal(result.price,'9.95');assert.equal(result.currency,'USD(美元)');assert.equal(result.hidden,'999');
      assert.equal(result.filled.warnings.length,0);assert.ok(result.filled.written.includes('List Price'));assert.ok(result.filled.written.includes('List Price Currency：USD(美元)'));
      const repaired=await page.evaluate(async()=>{
        document.querySelector('[data-amount]').value='';document.querySelector('.ant-select .ant-select-selection-item').textContent='EUR(欧元)';
        const checked=await DXMAdapter.commands.preflight({record});
        return {checked,amount:document.querySelector('[data-amount]').value,currency:document.querySelector('.ant-select .ant-select-selection-item').textContent};
      });
      assert.equal(repaired.amount,options.zero?'0':'18.99');assert.equal(repaired.currency,'USD(美元)');
      assert.ok(repaired.checked.repaired.includes('List Price'));assert.ok(repaired.checked.repaired.includes('List Price Currency'));
    }
    for(const options of [{reject:true},{disabled:true}]){
      await setup(options);const result=await page.evaluate(()=>DXMAdapter.commands.fill({record,continueOnError:true}));
      assert.ok(result.warnings.some(w=>w.field==='List Price'&&/写入后未保留|只读/.test(w.message)));assert.ok(result.written.includes('List Price Currency：USD(美元)'));
    }
    await setup({blank:true});const blank=await page.evaluate(async()=>{const result=await DXMAdapter.commands.fill({record,continueOnError:true});return {result,amount:document.querySelector('[data-amount]').value};});
    assert.equal(blank.amount,'77');assert.ok(!blank.result.written.includes('List Price'));
    console.log('PASS: US/美国 List Price uses spreadsheet value independently of Price; USD selected from actual nested option; delayed fields, paths/dynamic IDs/labels, hidden stale tax field, zero, node replacement, preflight repair, rejected/read-only writes and blank source. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
