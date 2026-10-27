// Real MV3 worker + isolated content scripts + nested iframe, all HTTP fulfilled
// locally. No requests or changes are made to the actual Dianxiaomi service.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..'),origin='https://www.dianxiaomi.com';
const read=name=>fs.readFileSync(path.join(root,'docs/evidence',name),'utf8');
(async()=>{
  const installed=path.join(process.env.LOCALAPPDATA,'ms-playwright');
  const executablePath=process.env.DXM_TEST_CHROMIUM||fs.readdirSync(installed).filter(name=>/^chromium-/.test(name)).map(name=>path.join(installed,name,'chrome-win64/chrome.exe')).find(name=>fs.existsSync(name));
  if(!executablePath)throw new Error('No extension-capable local Chromium installed');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dxm-new-images-'));
  const extension=process.env.DXM_TEST_EXTENSION_DIR?path.resolve(process.env.DXM_TEST_EXTENSION_DIR):path.join(root,'extension');
  const popupBlocked=process.argv.includes('--popup-blocked');
  const context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,ignoreDefaultArgs:popupBlocked?['--disable-popup-blocking']:[],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try{
    const menu=JSON.parse(read('german-new-image-menu.json')).join('');
    const image=read('german-new-image-product.html');
    const product='<input name="sourceUrl" value="https://amazon.com/dp/B0TEST0001"><div class="ant-form-item"><div class="ant-form-item-label">产品标题</div><input value="Korb"></div><div class="ant-form-item"><div class="ant-form-item-label">店铺账号</div><span class="ant-select-selection-item">Shop</span></div><div class="ant-form-item"><div class="ant-form-item-label">站点选择</div><span class="ant-select-selection-item">德国</span></div>'+image+menu+`<script>
      const first=document.querySelector('#imageInfo .img-item');first.querySelector('.img-size').textContent='1500 X 1493';first.querySelector('img').src='${origin}/fixture-original.jpg';
      for(let i=0;i<5;i++){const copy=first.cloneNode(true);copy.querySelector('img').src='${origin}/fixture-extra'+i+'.jpg';first.parentElement.append(copy);}
      window.hoverCount=0;window.editClicks=0;const menu=document.querySelector('.ant-dropdown');menu.style.display='none';document.querySelector('#imageInfo').onclick=event=>{if(event.target.closest('a.icon_delete'))event.target.closest('.img-item').remove();if(event.target.closest('a.icon-operate')){editClicks++;menu.style.display='none';}};
      document.querySelector('#imageInfo').onmouseover=event=>{if(event.target.closest('a.icon-operate')){hoverCount++;setTimeout(()=>menu.style.display='block',80);}};
      menu.querySelector('[title="小秘美图"]').onclick=()=>{menu.style.display='none';window.open('/web/newImageEditor','_blank');};
      addEventListener('message',event=>{if(event.origin==='${origin}'&&event.data==='fixture-apply'){const card=document.querySelector('#imageInfo .img-item');card.querySelector('img').src='${origin}/fixture-applied.jpg';card.querySelector('.img-size').textContent='300 X 300';}});
    </script>`;
    const editor=read('german-new-image-crop.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
      window.fixtureEvents=[];const panel=document.querySelector('.crop_module .parameter');panel.style.display='none';
      document.querySelector('.crop_module .open').onclick=()=>{panel.style.display='block';fixtureEvents.push('crop-open');};
      for(const input of panel.querySelectorAll('input')){input.value='1500';input.onchange=()=>fixtureEvents.push(input.value);}
      panel.querySelector('.footer_btns button').onclick=()=>{panel.style.display='none';fixtureEvents.push('apply');};
      const menu=document.querySelector('.el-dropdown__popper');menu.style.display='none';document.querySelector('button.save').onclick=()=>menu.style.display='block';
      menu.querySelector('[role="menuitem"]').onclick=()=>{if(!fixtureEvents.includes('apply'))throw Error('crop not applied');parent.opener.postMessage('fixture-apply','${origin}');parent.close();};
    </script>`;
    const remote=[];await context.route('**/*',route=>{
      const url=new URL(route.request().url());let body;
      if(url.origin===origin&&url.pathname==='/web/amazon/edit')body=product;
      else if(url.origin===origin&&url.pathname==='/web/newImageEditor')body='<iframe src="/api/meituv2/editor.htm"></iframe>';
      else if(url.origin===origin&&url.pathname==='/api/meituv2/editor.htm')body=editor;
      if(body!==undefined)return route.fulfill({body,contentType:'text/html; charset=utf-8'});
      remote.push(url.href);return route.abort();
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const page=await context.newPage();await page.goto(origin+'/web/amazon/edit?id=p1');
    await worker.evaluate(()=>load());
    const result=await worker.evaluate(async()=>{
      const product=(await chrome.tabs.query({})).find(tab=>tab.url==='https://www.dianxiaomi.com/web/amazon/edit?id=p1');
      const record={productId:'p1',source:'https://amazon.com/dp/B0TEST0001',title:'Korb',site:'DE',targetShop:'Shop',data:{'新品':'是'}};
      job={id:'offline-extension-test',state:'running',stop:false,tabId:product.id,rows:[record],logs:[]};await save();
      try{return await io.call('germanNewImages',{record});}catch(error){return {error:error.message};}
    });
    if(popupBlocked){assert.match(result.error,/未检测到新标签.*拦截弹窗/);assert.equal(context.pages().filter(page=>page.url()===origin+'/web/newImageEditor').length,0);console.log('PASS: popup-blocking enabled, synthetic click blocked, error distinguishes missing new tab. Offline only.');return;}
    assert.equal(result.done,true);assert.equal(result.count,1);assert.equal(result.removed,5);assert.equal(result.size,'300 X 300');assert.equal(result.src,origin+'/fixture-applied.jpg');
    assert.equal((await page.locator('#imageInfo .img-item').all()).length,1);
    assert.equal(await page.evaluate(()=>hoverCount),1);assert.equal(await page.evaluate(()=>editClicks),0);
    assert.equal(context.pages().filter(page=>page.url()===origin+'/web/newImageEditor').length,0);
    console.log('PASS: actual MV3 extension on a fully intercepted offline site: hover-only main-image menu, product adapter, new-tab ownership, iframe manifest injection, crop W/H, save closing before response, applied product result, worker storage and cleanup. No live service requests.');
  }finally{
    await context.close();
    const target=fs.realpathSync(profile),temporaryRoot=fs.realpathSync(os.tmpdir());
    if(!target.startsWith(temporaryRoot+path.sep)||!path.basename(target).startsWith('dxm-new-images-'))throw new Error('Unexpected test profile path: '+target);
    fs.rmSync(target,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
