// Replay captured form DOM offline; no live products or requests are used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),workspace=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url()),file=path.resolve(workspace,'.'+decodeURIComponent(url.pathname));
      if(url.hostname!=='migration.test'||!file.startsWith(workspace+path.sep)||!fs.existsSync(file)){await route.abort();return;}
      const type=path.extname(file)==='.html'?'text/html; charset=utf-8':path.extname(file)==='.js'?'text/javascript; charset=utf-8':path.extname(file)==='.json'?'application/json':'text/plain; charset=utf-8';
      await route.fulfill({body:fs.readFileSync(file),contentType:type});
    });
    async function setup(){await page.goto('http://migration.test/tests/fixture.html');await page.waitForFunction(()=>document.getElementById('result').textContent.startsWith('DOM 已加载'));}
    async function fill(){return page.evaluate(async()=>{
      const result=await DXMAdapter.commands.fill({record,modelName:record.data['Model Number']});
      // Captured HTML has a currency error; the fixture has no Vue validator.
      const item=document.getElementById('form_item_list_price.0.currency').closest('.ant-form-item');
      if(item.querySelector('.ant-select-selection-item')?.textContent==='GBP(英镑)')item.querySelectorAll('.ant-form-item-explain-error').forEach(e=>e.remove());
      return result;
    });}
    await setup();
    // IDs and placeholders vary by category; labels must still locate these fields.
    await page.evaluate(()=>{
      record.data['制造商']='Wrong manufacturer';
      for(const selector of ['input[placeholder="请输入制造商"]','[id="form_item_model_number.0.value"]','[id="form_item_model_name.0.value"]']){
        const field=document.querySelector(selector);field.id='changed-'+field.id;field.removeAttribute('placeholder');
      }
    });
    await fill();
    let check=await page.evaluate(async()=>{
      const result=await DXMAdapter.commands.preflight({record});
      const values=Object.fromEntries([...document.querySelectorAll('.ant-form-item')].filter(e=>/^(制造商|Model Number|Model Name)/.test(e.querySelector('.ant-form-item-label')?.textContent.trim())).map(e=>[e.querySelector('.ant-form-item-label').textContent.trim(),e.querySelector('input')?.value]));
      return {result,values};
    });assert.ok(check.result.checked.includes('制造商'));assert.deepEqual(Object.values(check.values),['Preocea','/01','/01']);
    // Lose values after initial fill, then replace nodes on the first repair attempt.
    check=await page.evaluate(async()=>{
      let replaced=false;
      const items=[...document.querySelectorAll('.ant-form-item')].filter(e=>/^(制造商|Model Number|Model Name)/.test(e.querySelector('.ant-form-item-label')?.textContent.trim()));
      for(const item of items){const field=item.querySelector('input');field.value='';field.addEventListener('input',()=>{if(replaced)return;replaced=true;const fresh=field.cloneNode(true);fresh.value='';field.replaceWith(fresh);});}
      const result=await DXMAdapter.commands.preflight({record});return {result,replaced};
    });assert.equal(check.replaced,true);assert.deepEqual(check.result.repaired,['制造商','Model Number','Model Name']);
    // An independent Model Name remains authoritative; missing manufacturer data uses brand.
    check=await page.evaluate(async()=>{delete record.data['制造商'];record.data['Model Name']='Distinct model';const result=await DXMAdapter.commands.preflight({record});return result;});assert.ok(check.repaired.includes('Model Name'));
    // Missing source model data is reported without inventing a value.
    const missing=await page.evaluate(async()=>{
      delete record.data['Model Number'];delete record.data['Model Name'];
      for(const item of [...document.querySelectorAll('.ant-form-item')].filter(e=>/^(Model Number|Model Name)/.test(e.querySelector('.ant-form-item-label')?.textContent.trim())))item.querySelector('input').value='';
      try{await DXMAdapter.commands.preflight({record});return '';}catch(e){return e.message;}
    });assert.match(missing,/原表型号数据.*缺失/);
    await setup();await fill();
    const otherRequired=await page.evaluate(async()=>{
      document.getElementById('app').insertAdjacentHTML('beforeend','<div class="ant-form-item"><div class="ant-form-item-label"><label class="ant-form-item-required">Other attribute</label></div><input></div>');
      try{await DXMAdapter.commands.preflight({record});return '';}catch(e){return e.message;}
    });assert.match(otherRequired,/Other attribute.*未填写/);
    await setup();await fill();
    const rejected=await page.evaluate(async()=>{
      const field=document.getElementById('form_item_model_name.0.value');field.value='';field.addEventListener('input',()=>{field.value='';});
      try{await DXMAdapter.commands.preflight({record});return '';}catch(e){return e.message;}
    });assert.match(rejected,/写入后未保留/);
    // Reactive validation can retain old errors for more than the old 300ms wait.
    await setup();await fill();
    const delayed=await page.evaluate(async()=>{
      const error=document.createElement('div');error.className='ant-form-item-explain-error';error.textContent='请输入型号';document.getElementById('app').append(error);
      setTimeout(()=>error.remove(),1500);const started=performance.now();
      const result=await DXMAdapter.commands.preflight({record});return {result,elapsed:performance.now()-started};
    });assert.ok(delayed.elapsed>=2000);assert.ok(delayed.result.checked.includes('Model Number'));
    // A disabled field becomes a warning; subsequent fields must still be filled.
    await setup();
    const continued=await page.evaluate(async()=>{
      document.getElementById('form_item_model_number.0.value').disabled=true;
      const result=await DXMAdapter.commands.fill({record,continueOnError:true});
      return {result,modelName:document.getElementById('form_item_model_name.0.value').value,price:document.querySelector('input[name="price"]').value};
    });assert.equal(continued.result.warnings[0].field,'Model Number');assert.equal(continued.modelName,'/01');assert.equal(continued.price,recordPrice());
    // Run the real workflow and DOM adapter together; all requests remain offline.
    await setup();await page.addScriptTag({url:'http://migration.test/extension/workflow.js'});
    const flow=await page.evaluate(async()=>{
      const app=document.getElementById('app');
      app.insertAdjacentHTML('beforeend','<div class="ant-form-item"><div class="ant-form-item-label"><label class="ant-form-item-required">Included Components(所包含组件)</label></div><input></div><div class="ant-form-item-explain-error">请输入含税价目表</div>');
      document.getElementById('form_item_model_number.0.value').disabled=true;
      const save=document.createElement('button');save.textContent='保存并发布';save.disabled=true;app.append(save);
      let clicks=0,filledAt=0,checkedAt=0;save.onclick=()=>{clicks++;setTimeout(()=>{const modal=document.createElement('div');modal.className='ant-modal';modal.textContent='产品已提交发布';app.append(modal);},1200);};
      const row={...record,status:'待执行',checkpoint:'offline',history:[]},job={rows:[row],logs:[],options:{modelNameFromNumber:true}};
      const listing={id:row.productId,source:row.source,title:row.title,text:`「${row.targetShop}」${row.site}`};
      const io={save:async()=>{},sleep:ms=>new Promise(r=>setTimeout(r,ms)),open:async()=>{},waitEditor:async()=>{},closeEditor:async()=>{},call:async(action,args={})=>{
        if(action==='snapshot')return {rows:[listing],hasNext:false};if(action==='editProduct')return {url:location.href};
        if(['searchTitle','firstPage'].includes(action))return {};
        if(action==='preflight'){checkedAt=performance.now();setTimeout(()=>{save.disabled=false;},800);}
        const result=await DXMAdapter.commands[action](args);if(action==='fill')filledAt=performance.now();return result;
      }};
      await new DXMWorkflow(job,io).run();return {state:job.state,row,logs:job.logs,clicks,waited:checkedAt-filledAt};
    });assert.equal(flow.state,'done');assert.equal(flow.row.status,'已发布');assert.equal(flow.clicks,1);assert.ok(flow.waited>=1950);assert.ok(flow.row.warnings.some(e=>e.stage==='填写'));assert.ok(flow.row.warnings.some(e=>e.stage==='提交前检查'));
    // A success popup wins over stale error nodes; genuine platform errors still fail.
    let status=await page.evaluate(()=>DXMAdapter.commands.publishStatus());assert.equal(status.submitted,true);
    status=await page.evaluate(async()=>{document.querySelectorAll('.ant-modal').forEach(e=>e.remove());return DXMAdapter.commands.publishStatus();});assert.equal(status.failed,true);assert.match(status.text,/含税价目表/);
    const identity=await page.evaluate(async()=>{
      try{await DXMAdapter.commands.publish({record:{...record,source:'https://www.amazon.com/dp/B0WRONG000'}});return {};}catch(e){return {message:e.message,notSubmitted:e.notSubmitted};}
    });assert.equal(identity.notSubmitted,true);assert.match(identity.message,/来源链接不匹配/);
    console.log('PASS：真实表单DOM中品牌/型号补填、节点重绘、2秒后校验、字段失败继续填写、预检失败仍点击发布、延迟成功弹窗优先、真实平台报错和产品身份检查；全程离线。');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
function recordPrice(){return JSON.parse(fs.readFileSync(path.join(workspace,'tests/fixture-data.json'),'utf8')).data.Price;}
