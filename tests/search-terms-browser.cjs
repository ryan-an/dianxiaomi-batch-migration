// Search Terms has no stable ID in the captured editor. Replay its label and
// required/error markup offline, then exercise the actual fill/preflight flow.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({...(process.env.DXM_TEST_CHROMIUM?{executablePath:process.env.DXM_TEST_CHROMIUM}:{channel:'msedge'}),headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    async function setup(options={}){
      await page.goto('about:blank');
      await page.setContent('<input name="sourceUrl" value="https://amazon.com/dp/B0TEST0001"><div class="ant-form-item"><div class="ant-form-item-label">产品标题</div><input id="title"></div><div class="ant-form-item"><div class="ant-form-item-label">店铺账号</div><span class="ant-select-selection-item">Shop</span></div><div class="ant-form-item"><div class="ant-form-item-label">站点选择</div><span class="ant-select-selection-item" id="site">英国</span></div><div id="keywordInfo"><div class="ant-form-item"><div class="ant-form-item-label"><label class="ant-form-item-required">Search Terms：</label></div><textarea data-field="search-terms"></textarea><div class="ant-form-item-explain-error">Search Terms 不能为空</div></div><div class="ant-form-item"><div class="ant-form-item-label">Other Search Terms</div><textarea id="other-terms">Other keywords</textarea></div></div>');
      for(const file of ['core.js','work-target.js','adapter.js'])await page.addScriptTag({path:path.join(root,'extension',file)});
      await page.evaluate(options=>{
        window.record={source:'https://amazon.com/dp/B0TEST0001',title:options.title??'6 Pack Sleep Caps',site:options.site||'UK',targetShop:'Shop',data:options.data||{}};
        document.getElementById('title').value=record.title;document.getElementById('site').textContent=record.site;window.events=[];
        const field=document.querySelector('[data-field="search-terms"]'),item=field.closest('.ant-form-item');field.value=options.value||'';
        if(options.optional||options.aria||options.native)item.querySelector('label').classList.remove('ant-form-item-required');
        if(options.aria)field.setAttribute('aria-required','true');if(options.native)field.required=true;
        if(options.optional)item.querySelector('.ant-form-item-explain-error').remove();
        if(options.disabled)field.disabled=true;if(options.readOnly)field.readOnly=true;
        if(options.hiddenOld){const copy=item.cloneNode(true);copy.style.display='none';copy.querySelector('textarea').value='Historical keywords';item.before(copy);}
        if(options.duplicate)item.after(item.cloneNode(true));
        if(options.absent)item.remove();
        if(record.site==='US'){
          record.data['List Price']='12.34';
          document.body.insertAdjacentHTML('beforeend','<div class="ant-form-item"><div class="ant-form-item-label">List Price Currency</div><div class="ant-select"><input id="form_item_list_price.0.currency" role="combobox"><span class="ant-select-selection-item">USD(美元)</span></div></div><div class="ant-form-item"><div class="ant-form-item-label">List Price</div><input id="form_item_list_price.0.value" value="12.34"></div>');
        }
        let replaced=false,renamed=false;
        for(const type of ['input','change','blur'])document.addEventListener(type,event=>{
          if(!event.target.matches('[data-field="search-terms"]'))return;events.push(type);
          event.target.closest('.ant-form-item')?.querySelectorAll('.ant-form-item-explain-error').forEach(e=>e.remove());
          if(options.replace&&!replaced){replaced=true;const fresh=event.target.cloneNode(true);fresh.value='';event.target.replaceWith(fresh);}
          if(options.reject)event.target.value='';
          if(options.rename&&!renamed){renamed=true;document.getElementById('title').value='Latest title after rerender';}
          if(options.stop)DXMAdapter.commands.stop();
        });
      },options);
    }
    const ensure=()=>page.evaluate(()=>DXMAdapter.commands.ensureSearchTerms());
    for(const options of [{},{value:'Old keywords'},{aria:true},{native:true},{replace:true},{hiddenOld:true}]){
      await setup(options);const result=await ensure();assert.equal(result.value,'6 Pack Sleep Caps');assert.equal(result.changed,true);
      assert.equal(await page.locator('textarea[data-field="search-terms"]').filter({visible:true}).inputValue(),'6 Pack Sleep Caps');assert.equal(await page.locator('#other-terms').inputValue(),'Other keywords');
    }
    await setup({rename:true});assert.equal((await ensure()).value,'Latest title after rerender');
    await setup({value:'6 Pack Sleep Caps'});assert.equal((await ensure()).changed,false);assert.deepEqual(await page.evaluate(()=>events),[]);
    await setup({optional:true,value:'Keep keywords'});assert.equal((await ensure()).changed,false);assert.equal(await page.locator('[data-field="search-terms"]').inputValue(),'Keep keywords');assert.deepEqual(await page.evaluate(()=>events),[]);
    await setup({absent:true});assert.equal((await ensure()).absent,true);
    for(const [options,message] of [[{disabled:true},/禁用或只读/],[{readOnly:true},/禁用或只读/],[{reject:true},/未保留/],[{title:''},/标题为空/],[{duplicate:true},/找到 2 个控件/],[{stop:true},/已停止/]]){
      await setup(options);await assert.rejects(ensure,message);
    }
    for(const options of [{site:'UK',title:'6 Pack Sleep Caps',data:{'产品数量':'3'}},{site:'US',title:'6 Pack Sleep Caps',data:{'德国标题翻译':'Translated & final title <plain text>'}}]){
      await setup(options);
      const result=await page.evaluate(async()=>{
        const filled=await DXMAdapter.commands.fill({record,continueOnError:true});record.title=filled.title;
        const writtenValue=document.querySelector('[data-field="search-terms"]').value;
        document.querySelector('[data-field="search-terms"]').value='';
        const checked=await DXMAdapter.commands.preflight({record});
        return {filled,writtenValue,checked,finalValue:document.querySelector('[data-field="search-terms"]').value};
      });
      const expected=options.site==='UK'?'3 Pack Sleep Caps':options.data['德国标题翻译'];
      assert.equal(result.filled.title,expected);assert.equal(result.writtenValue,expected);assert.equal(result.finalValue,expected);
      assert.ok(result.filled.written.includes('Search Terms：当前标题'));assert.ok(result.checked.checked.includes('Search Terms'));assert.ok(result.checked.repaired.includes('Search Terms'));
    }
    // Required status may appear after preflight. Recheck before clicking Publish.
    await setup({optional:true,value:'Keep keywords'});
    const published=await page.evaluate(async()=>{
      await DXMAdapter.commands.preflight({record});const field=document.querySelector('[data-field="search-terms"]');field.closest('.ant-form-item').querySelector('label').classList.add('ant-form-item-required');field.value='';
      let clicks=0,atClick='';const button=document.createElement('button');button.textContent='保存并发布';button.onclick=()=>{clicks++;atClick=field.value;};document.body.append(button);
      await DXMAdapter.commands.publish({record});return {clicks,atClick};
    });assert.deepEqual(published,{clicks:1,atClick:'6 Pack Sleep Caps'});
    await setup({reject:true});
    const rejected=await page.evaluate(async()=>{
      let clicks=0;const button=document.createElement('button');button.textContent='保存并发布';button.onclick=()=>clicks++;document.body.append(button);
      try{await DXMAdapter.commands.publish({record});return {};}catch(error){return {message:error.message,notSubmitted:error.notSubmitted,clicks};}
    });assert.match(rejected.message,/Search Terms.*未保留/);assert.equal(rejected.notSubmitted,true);assert.equal(rejected.clicks,0);
    console.log('PASS: label-only required Search Terms, label/ARIA/native markers, final quantity/translated titles, fill/preflight/publish checks, optional/absent preservation, hidden old fields, rerender retry, ambiguity, disabled/read-only/rejected writes and stop. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
