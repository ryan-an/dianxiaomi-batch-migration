// Replay the actual German dropdowns captured from the failed product, offline.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const evidence=JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/german-condition-options.json'),'utf8'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    async function setup({english=false,selectedBattery=true,optional=false,duplicate=false}={}){
      const site=english?'英国':'德国';
      await page.setContent('<input name="sourceUrl" value="https://amazon.com/dp/B0TEST0001"><div class="ant-form-item"><div class="ant-form-item-label">产品标题</div><input value="Test"></div><div class="ant-form-item"><div class="ant-form-item-label">店铺账号</div><span class="ant-select-selection-item">Shop</span></div><div class="ant-form-item"><div class="ant-form-item-label">站点选择</div><span class="ant-select-selection-item">'+site+'</span></div>'+evidence.before+evidence.dropdown[0]+evidence.after.batteryHtml+evidence.batteryDropdown[0]);
      for(const file of ['core.js','work-target.js','adapter.js'])await page.addScriptTag({path:path.join(root,'extension',file)});
      await page.evaluate(({english,selectedBattery,optional,duplicate,site})=>{
        window.record={source:'https://amazon.com/dp/B0TEST0001',title:'Test',targetShop:'Shop',site,data:{'德国标题翻译':'Test'}};window.opened={condition:0,battery:0};window.choices=[];
        const condition=document.querySelector('[data-path="condition_type.0.value"]').closest('.ant-form-item'),battery=document.querySelector('[data-path="batteries_required.0.value"]').closest('.ant-form-item');
        if(optional)condition.querySelector('label').classList.remove('ant-form-item-required');
        if(!selectedBattery)battery.querySelector('.ant-select-selection-item').remove();
        if(english){
          const option=document.querySelector('.ant-select-item-option[title="Neu(新的)"]');option.title='New(新的)';option.querySelector('.ant-select-item-option-content').textContent='New(新的)';
          for(const node of battery.querySelectorAll('.ant-select-selection-item'))node.textContent='No(不)';
          for(const node of document.querySelectorAll('.ant-select-item-option[title="Nein(不)"]')){node.title='No(不)';node.querySelector('.ant-select-item-option-content').textContent='No(不)';}
        }
        for(const [key,item] of [['condition',condition],['battery',battery]]){
          const box=item.querySelector('.ant-select'),combo=box.querySelector('[role="combobox"]'),dropdown=document.getElementById(combo.getAttribute('aria-controls')).closest('.ant-select-dropdown');
          dropdown.style.display='none';combo.setAttribute('aria-expanded','false');
          box.querySelector('.ant-select-selector').onmousedown=()=>{opened[key]++;dropdown.style.display='block';combo.setAttribute('aria-expanded','true');};
          if(key==='condition'&&duplicate){const node=dropdown.querySelector('[title="Neu(新的)"]');node.parentElement.append(node.cloneNode(true));}
          for(const option of dropdown.querySelectorAll('.ant-select-item-option'))option.onclick=()=>{
            const value=option.querySelector('.ant-select-item-option-content').textContent.trim();choices.push(value);
            let selected=box.querySelector('.ant-select-selection-item');if(!selected){selected=document.createElement('span');selected.className='ant-select-selection-item';box.querySelector('.ant-select-selector').append(selected);}
            selected.textContent=value;box.querySelector('.ant-select-selection-placeholder')?.remove();item.querySelectorAll('.ant-form-item-explain-error').forEach(e=>e.remove());dropdown.style.display='none';combo.setAttribute('aria-expanded','false');
          };
        }
      },{english,selectedBattery,optional,duplicate,site});
    }
    for(const english of [false,true]){
      await setup({english,selectedBattery:false});
      const result=await page.evaluate(()=>DXMAdapter.commands.fill({record,continueOnError:true}));
      assert.deepEqual(result.warnings,[]);assert.ok(result.written.includes('物品状况：'+(english?'New(新的)':'Neu(新的)')));
      const choices=await page.evaluate(()=>choices);assert.deepEqual(choices,[english?'No(不)':'Nein(不)',english?'New(新的)':'Neu(新的)']);
      // Correctly selected translated values should not reopen the dropdown.
      const before=await page.evaluate(()=>opened);const again=await page.evaluate(()=>DXMAdapter.commands.ensureCondition());assert.equal(again.changed,false);assert.deepEqual(await page.evaluate(()=>opened),before);
    }
    await setup();
    const existingBattery=await page.evaluate(()=>DXMAdapter.commands.fill({record,continueOnError:true}));assert.deepEqual(existingBattery.warnings,[]);assert.equal(await page.evaluate(()=>opened.battery),0);
    // The submit preflight repairs a lost required condition with its locale.
    await page.evaluate(()=>document.querySelector('[data-path="condition_type.0.value"] .ant-select-selection-item').remove());
    const checked=await page.evaluate(()=>DXMAdapter.commands.preflight({record}));assert.ok(checked.repaired.includes('物品状况'));assert.ok(checked.checked.includes('物品状况'));
    await setup({optional:true});assert.equal((await page.evaluate(()=>DXMAdapter.commands.ensureCondition())).changed,false);assert.equal(await page.evaluate(()=>opened.condition),0);
    await setup({duplicate:true});await assert.rejects(()=>page.evaluate(()=>DXMAdapter.commands.ensureCondition()),/多个同名选项/);assert.deepEqual(await page.evaluate(()=>choices),[]);
    await page.setContent('');assert.equal((await page.evaluate(()=>DXMAdapter.commands.ensureCondition())).absent,true);
    console.log('PASS: captured German Neu/Nein options, exact exclusion of used/like-new/OEM/open-box, English New/No regression, already-selected translated values, actual fill warnings, preflight repair, optional/absent fields and ambiguous options. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
