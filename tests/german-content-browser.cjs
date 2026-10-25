// Uses the supplied DOM structure and the site's public CKEditor 4.6.2 build.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),workspace=path.resolve(__dirname,'..'),assetRoot=path.join(workspace,'artifact-work/ckeditor-fixture'),prepare=process.argv.includes('--prepare');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage(),missing=[],downloads=[];
    page.on('pageerror',error=>console.error('Browser:',error.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='migration.test'){await route.abort();return;}
      let file;
      if(url.pathname.startsWith('/ckeditor/')){
        const relative=decodeURIComponent(url.pathname.slice('/ckeditor/'.length));file=path.resolve(assetRoot,relative);
        if(!file.startsWith(assetRoot+path.sep)){await route.abort();return;}
        if(!fs.existsSync(file)&&prepare){
          try{const response=await fetch('https://s13.dianxiaomi.com/fe-res/ckeditor/'+relative,{signal:AbortSignal.timeout(10000)});if(response.ok){const bytes=Buffer.from(await response.arrayBuffer());fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);downloads.push(relative);}}catch(error){console.error('Asset:',relative,error.message);}
        }
      }else file=path.resolve(workspace,url.pathname==='/web/amazon/edit'?'tests/fixture.html':'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(workspace+path.sep)||!fs.existsSync(file)){missing.push(url.pathname);await route.abort();return;}
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.gif':'image/gif'};
      let body=fs.readFileSync(file);if(file.endsWith('fixture.html'))body=Buffer.from(body.toString('utf8').replace(/<meta[^>]+http-equiv=[\"']Content-Security-Policy[\"'][^>]*>/i,''));await route.fulfill({body,contentType:types[path.extname(file)]||'application/octet-stream'});
    });
    async function setup(site='DE',title='4 Stück Edelstahl Gewürzschalen'){
      await page.goto('http://migration.test/web/amazon/edit');await page.waitForFunction(()=>document.getElementById('result').textContent.startsWith('DOM 已加载'));
      await page.addScriptTag({url:'http://migration.test/ckeditor/ckeditor.js'});
      await page.evaluate(async({site,title})=>{
        record.site=site;record.collectedTitle=record.title;record.data['德国标题翻译']=title;record.data['产品数量']=site==='UK'?'40':'quantity is ignored';
        const siteItem=[...document.querySelectorAll('.ant-form-item')].find(item=>item.querySelector('.ant-form-item-label')?.textContent.trim()==='站点选择');siteItem.querySelector('.ant-select-selection-item').textContent=site==='UK'?'英国':'德国';
        const currency=document.getElementById('form_item_list_price.0.currency').closest('.ant-select').querySelector('.ant-select-selection-item');if(currency)currency.textContent=site==='UK'?'GBP(英镑)':'EUR(欧元)';
        document.getElementById('app').insertAdjacentHTML('beforeend','<div class="ant-form-item"><div data-path="product_description.0.value" class="ant-row ant-form-item-row"><div class="ant-form-item-label"><label class="ant-form-item-required" title="产品描述">产品描述</label></div><div class="ant-form-item-control"><textarea id="ckeditor14">Old English description</textarea></div></div></div>');
        for(let i=0;i<6;i++){
          const item=document.createElement('div');item.className='ant-form-item';item.innerHTML='<div class="ant-form-item-label"><label for="form_item_bulletPoints_'+i+'">'+(i===0?'* Bullet Point： AI生成':'')+'</label></div><textarea id="form_item_bulletPoints_'+i+'" rows="3"></textarea>';item.querySelector('textarea').value='Old English bullet '+i;document.getElementById('app').append(item);
        }
        window.editorRequests=0;document.addEventListener('DXM_EDITOR_REQUEST',()=>editorRequests++);
        await new Promise(resolve=>{const editor=CKEDITOR.replace('ckeditor14',{customConfig:'',language:'zh-cn',skin:'moono-lisa',plugins:'wysiwygarea,sourcearea,toolbar,basicstyles,undo,enterkey',toolbar:[['Source','Bold','Italic']],contentsCss:[],height:120});editor.on('change',()=>{window.descriptionModel=editor.getData();});editor.on('instanceReady',resolve);});
      },{site,title});
      await page.addScriptTag({url:'http://migration.test/extension/editor-bridge.js'});
    }
    await setup();
    if(prepare){await page.waitForTimeout(800);assert.equal(missing.length,0,'Missing editor assets: '+missing.join(','));console.log('Cached public CKEditor assets for offline validation: '+downloads.join(', '));return;}
    let result=await page.evaluate(async()=>{
      let replaced=false;document.getElementById('form_item_bulletPoints_0').addEventListener('input',()=>{if(replaced)return;replaced=true;for(const field of document.querySelectorAll('textarea[id^="form_item_bulletPoints_"]')){const fresh=field.cloneNode(true);fresh.value=field.value;field.replaceWith(fresh);}});
      const filled=await DXMAdapter.commands.fill({record,continueOnError:true});record.title=filled.title;
      document.querySelectorAll('.ant-form-item-explain-error').forEach(e=>e.remove());
      const checked=await DXMAdapter.commands.preflight({record});
      return {filled,checked,title:record.title,html:CKEDITOR.instances.ckeditor14.getData(),description:CKEDITOR.instances.ckeditor14.document.getBody().getText().trim(),hidden:document.getElementById('ckeditor14').value,model:descriptionModel,bullets:[...document.querySelectorAll('textarea[id^="form_item_bulletPoints_"]')].map(field=>field.value),currency:document.getElementById('form_item_list_price.0.currency').closest('.ant-select').querySelector('.ant-select-selection-item').textContent};
    });
    assert.equal(result.title,'4 Stück Edelstahl Gewürzschalen');assert.equal(result.description,result.title);assert.equal(result.hidden,result.html);assert.equal(result.model,result.html);
    assert.deepEqual(result.bullets,[result.title,'','','','','']);assert.equal(result.currency,'EUR(欧元)');assert.ok(result.checked.checked.includes('产品描述（德国翻译）'));assert.ok(result.checked.checked.includes('Bullet Point（德国翻译）'));assert.equal(result.filled.warnings.length,0);
    // Real Chrome isolated-world adapter -> MAIN-world bridge -> actual CKEditor.
    await setup('德国','3 Stück Aufbewahrungskorb');
    const cdp=await page.context().newCDPSession(page),{frameTree}=await cdp.send('Page.getFrameTree');
    const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'dxm-german-test'});
    for(const file of ['core.js','work-target.js','batch-state.js','adapter.js'])await cdp.send('Runtime.evaluate',{contextId:executionContextId,expression:fs.readFileSync(path.join(workspace,'extension',file),'utf8')});
    const isolatedRecord=await page.evaluate(()=>record);
    const isolated=await cdp.send('Runtime.evaluate',{contextId:executionContextId,expression:'(async()=>{const editorVisible=typeof CKEDITOR;const filled=await DXMAdapter.commands.fill({record:'+JSON.stringify(isolatedRecord)+',continueOnError:true});return {editorVisible,filled};})()',awaitPromise:true,returnByValue:true});
    if(isolated.exceptionDetails)throw new Error(JSON.stringify(isolated.exceptionDetails));
    assert.equal(isolated.result.value.editorVisible,'undefined');assert.equal(isolated.result.value.filled.title,'3 Stück Aufbewahrungskorb');assert.equal(isolated.result.value.filled.warnings.length,0);
    assert.equal(await page.evaluate(()=>CKEDITOR.instances.ckeditor14.document.getBody().getText().trim()),'3 Stück Aufbewahrungskorb');
    await cdp.detach();
    // The German source translation is text, including literal HTML characters.
    await setup('DE','4 Stück <b>Schalen</b> & Zubehör');
    result=await page.evaluate(async()=>{const filled=await DXMAdapter.commands.fill({record,continueOnError:true});return {filled,text:CKEDITOR.instances.ckeditor14.document.getBody().getText().trim(),bold:CKEDITOR.instances.ckeditor14.document.getBody().find('b').count()};});
    assert.equal(result.text,'4 Stück <b>Schalen</b> & Zubehör');assert.equal(result.bold,0);
    // UK keeps the quantity flow and leaves description and all bullets intact.
    await setup('UK');
    result=await page.evaluate(async()=>{const filled=await DXMAdapter.commands.fill({record,continueOnError:true});return {filled,requests:editorRequests,description:CKEDITOR.instances.ckeditor14.document.getBody().getText().trim(),bullets:[...document.querySelectorAll('textarea[id^="form_item_bulletPoints_"]')].map(field=>field.value)};});
    assert.equal(result.filled.title,'40 PCS Gold S Hooks, Brass S Hooks for Hanging, 3.54 Inch');assert.equal(result.description,'Old English description');assert.equal(result.requests,0);assert.deepEqual(result.bullets,Array.from({length:6},(_,i)=>'Old English bullet '+i));
    // Stopping after an editor read must prevent a new content write.
    await setup('DE');
    result=await page.evaluate(async()=>{
      document.addEventListener('DXM_EDITOR_RESPONSE',()=>{DXMAdapter.commands.stop();},{once:true});
      let error='';try{await DXMAdapter.commands.fill({record,continueOnError:true});}catch(caught){error=caught.message;}
      return {error,description:CKEDITOR.instances.ckeditor14.document.getBody().getText().trim(),bullets:[...document.querySelectorAll('textarea[id^="form_item_bulletPoints_"]')].map(field=>field.value)};
    });
    assert.match(result.error,/已停止/);assert.equal(result.description,'Old English description');assert.deepEqual(result.bullets,Array.from({length:6},(_,i)=>'Old English bullet '+i));
    assert.equal(missing.length,0,'Missing cached assets: '+missing.join(','));
    console.log('PASS: DE/Germany translated title, actual CKEditor 4.6.2 content/model/hidden-value synchronization, first Bullet Point replacement, all remaining bullets cleared after node replacement, isolated/MAIN worlds, literal text escaping, preflight, EUR preserved and UK quantity/content regression. Offline cached assets only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

