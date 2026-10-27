// Actual required number_of_boxes markup, replayed offline.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const evidence=JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/required-box-count.json'),'utf8'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    async function setup(options={}){
      await page.setContent('<input name="sourceUrl" value="https://amazon.com/dp/B0TEST0001"><div class="ant-form-item"><div class="ant-form-item-label">产品标题</div><input value="Test"></div><div class="ant-form-item"><div class="ant-form-item-label">店铺账号</div><span class="ant-select-selection-item">Shop</span></div><div class="ant-form-item"><div class="ant-form-item-label">站点选择</div><span class="ant-select-selection-item">德国</span></div><div class="ant-form-item"><div class="ant-form-item-label">产品数量</div><input id="other-count" value="12"></div>'+evidence.html);
      for(const file of ['core.js','work-target.js','adapter.js'])await page.addScriptTag({path:path.join(root,'extension',file)});
      await page.evaluate(options=>{
        window.record={source:'https://amazon.com/dp/B0TEST0001',title:'Test',site:'DE',targetShop:'Shop',data:{'德国标题翻译':'Test'}};window.events=[];
        const row=document.querySelector('[data-path="number_of_boxes.0.value"]'),field=row.querySelector('input');field.value=options.value||'';
        if(options.idChanged)field.id='category-specific-box-count';
        if(options.optional||options.aria||options.native)row.querySelector('label').classList.remove('ant-form-item-required');
        if(options.aria)field.setAttribute('aria-required','true');if(options.native)field.required=true;
        if(options.disabled)field.disabled=true;if(options.readOnly)field.readOnly=true;
        let replaced=false;
        for(const type of ['input','change'])document.addEventListener(type,event=>{
          if(!event.target.closest('[data-path="number_of_boxes.0.value"]'))return;
          events.push(type);row.closest('.ant-form-item').querySelectorAll('.ant-form-item-explain-error').forEach(e=>e.remove());
          if(options.replace&&!replaced){replaced=true;const fresh=event.target.cloneNode(true);fresh.value='';event.target.replaceWith(fresh);}
          if(options.reject)event.target.value='';
        });
      },options);
    }
    for(const options of [{},{value:'9'},{idChanged:true},{aria:true},{native:true},{replace:true}]){
      await setup(options);const result=await page.evaluate(()=>DXMAdapter.commands.ensureBoxCount());assert.equal(result.value,'1');assert.equal(result.changed,true);
      assert.equal(await page.locator('[data-path="number_of_boxes.0.value"] input').inputValue(),'1');assert.equal(await page.locator('#other-count').inputValue(),'12');
    }
    await setup({optional:true,value:'7'});assert.equal((await page.evaluate(()=>DXMAdapter.commands.ensureBoxCount())).changed,false);assert.equal(await page.locator('[data-path="number_of_boxes.0.value"] input').inputValue(),'7');assert.deepEqual(await page.evaluate(()=>events),[]);
    await setup({value:'1'});assert.equal((await page.evaluate(()=>DXMAdapter.commands.ensureBoxCount())).changed,false);assert.deepEqual(await page.evaluate(()=>events),[]);
    for(const options of [{disabled:true},{readOnly:true},{reject:true}]){await setup(options);await assert.rejects(()=>page.evaluate(()=>DXMAdapter.commands.ensureBoxCount()),options.reject?/未保留/:/禁用或只读/);}
    await setup();const filled=await page.evaluate(()=>DXMAdapter.commands.fill({record,continueOnError:true}));assert.ok(filled.written.includes('箱子数量：1'));assert.deepEqual(filled.warnings,[]);
    await page.evaluate(()=>document.querySelector('[data-path="number_of_boxes.0.value"] input').value='');const checked=await page.evaluate(()=>DXMAdapter.commands.preflight({record}));assert.ok(checked.checked.includes('箱子数量'));assert.ok(checked.repaired.includes('箱子数量'));
    await page.setContent('');assert.equal((await page.evaluate(()=>DXMAdapter.commands.ensureBoxCount())).absent,true);
    console.log('PASS: required box count fixed to 1, actual German markup, label/ARIA/native required markers, changed IDs, node replacement/retry, optional/absent preservation, disabled/read-only/rejected writes, other quantity preserved, fill log and preflight repair. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
