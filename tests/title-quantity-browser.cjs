// Replay captured editor DOM locally; external network requests are aborted.
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
    await setup();
    let result=await page.evaluate(async()=>{
      const title='Set of 12 Paint Sets, 24 Pcs Brushes, 7 Inch';
      record.title=title;record.data['产品数量']='3';
      const field=[...document.querySelectorAll('.ant-form-item')].find(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()==='产品标题').querySelector('input');field.value=title;
      const events=[];for(const type of ['input','change','blur'])field.addEventListener(type,()=>events.push(type));
      const filled=await DXMAdapter.commands.fill({record,continueOnError:true});
      record.title=filled.title;
      document.querySelectorAll('.ant-form-item-explain-error').forEach(e=>e.remove());
      const checked=await DXMAdapter.commands.preflight({record});
      return {filled,checked,events,title:field.value,quantity:lastQuantity};
    });
    assert.equal(result.title,'Set of 3 Paint Sets, 24 Pcs Brushes, 7 Inch');
    assert.equal(result.filled.titleUpdate.originalQuantity,12);assert.equal(result.filled.titleUpdate.targetQuantity,3);
    assert.ok(result.filled.written.includes('产品标题数量'));assert.deepEqual(result.events,['input','change','blur']);assert.equal(result.quantity,'');
    assert.ok(result.checked.checked.includes('Model Number'));
    // Replaced input nodes must be reacquired before verifying the new title.
    await setup();
    result=await page.evaluate(async()=>{
      record.data['产品数量']='40';let replaced=false;
      const field=[...document.querySelectorAll('.ant-form-item')].find(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()==='产品标题').querySelector('input');
      field.addEventListener('input',()=>{if(replaced)return;replaced=true;const fresh=field.cloneNode(true);fresh.value=record.title;field.replaceWith(fresh);});
      const filled=await DXMAdapter.commands.fill({record,continueOnError:true});return {filled,replaced};
    });
    assert.equal(result.replaced,true);assert.equal(result.filled.title,'40 PCS Gold S Hooks, Brass S Hooks for Hanging, 3.54 Inch');
    // A title rejected by the form remains the actual exported title, with a warning.
    await setup();
    result=await page.evaluate(async()=>{
      record.data['产品数量']='40';
      const field=[...document.querySelectorAll('.ant-form-item')].find(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()==='产品标题').querySelector('input');
      field.addEventListener('input',()=>{field.value=record.title;});
      const filled=await DXMAdapter.commands.fill({record,continueOnError:true});return {filled,original:record.title};
    });
    assert.equal(result.filled.title,result.original);assert.ok(result.filled.warnings.some(e=>e.field==='产品标题数量'&&/未保留/.test(e.message)));
    // Exercise workflow -> real form -> preflight -> publish confirmation -> XLSX.
    await setup();await page.addScriptTag({url:'http://migration.test/extension/vendor/xlsx.full.min.js'});await page.addScriptTag({url:'http://migration.test/extension/workflow.js'});
    result=await page.evaluate(async()=>{
      record.data['产品数量']='40';
      const original=record.title,row={...record,status:'待执行',checkpoint:'offline',history:[]},job={rows:[row],logs:[],options:{modelNameFromNumber:true}};
      const listing={id:row.productId,source:row.source,title:original,text:'「'+row.targetShop+'」'+row.site};
      let clicks=0;const save=document.createElement('button');save.textContent='保存并发布';save.onclick=()=>{clicks++;const modal=document.createElement('div');modal.className='ant-modal';modal.textContent='产品已提交发布';document.getElementById('app').append(modal);};document.getElementById('app').append(save);
      const io={save:async()=>{},sleep:ms=>new Promise(r=>setTimeout(r,ms)),open:async()=>{},waitEditor:async()=>{},closeEditor:async()=>{},call:async(action,args={})=>{
        if(action==='snapshot')return {rows:[listing],hasNext:false};if(action==='editProduct')return {url:location.href};
        if(['searchTitle','firstPage'].includes(action))return {};
        const response=await DXMAdapter.commands[action](args);
        if(action==='fill')document.querySelectorAll('.ant-form-item-explain-error').forEach(e=>e.remove());
        return response;
      }};
      await new DXMWorkflow(job,io).run();
      const table=DXMCore.resultTable(job.rows),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(table),'迁移结果');
      const sheet=XLSX.read(XLSX.write(book,{type:'array',bookType:'xlsx'})).Sheets['迁移结果'];
      return {row,state:job.state,clicks,headers:table[0],title:sheet.C2.v,originalQuantity:sheet.D2.v,targetQuantity:sheet.E2.v,range:sheet['!ref']};
    });
    assert.equal(result.state,'done');assert.equal(result.row.status,'已发布');assert.equal(result.clicks,1);
    assert.equal(result.row.collectedQuantity,10);assert.equal(result.row.targetQuantity,40);
    assert.equal(result.title,'40 PCS Gold S Hooks, Brass S Hooks for Hanging, 3.54 Inch');assert.equal(result.originalQuantity,10);assert.equal(result.targetQuantity,40);
    assert.equal(result.headers.length,8);assert.equal(result.range,'A1:H2');
    console.log('PASS: offline captured DOM validates first-number replacement, unchanged accessory/size values, input events, node replacement/retry, rejected title warning, identity checks after title change, publish confirmation and eight-column XLSX round-trip.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

