// Offline DOM replay using the actual product/menu/crop markup captured in IAB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'docs/evidence',name),'utf8');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    const editorHtml=read('german-new-image-crop.html');
    async function editor({floating=false,stop=false,disabled=false}={}){
      await page.setContent(editorHtml);await page.addScriptTag({path:path.join(root,'extension/image-editor.js')});
      await page.evaluate(({floating,stop,disabled})=>{
        window.events=[];const panel=document.querySelector('.crop_module .parameter');panel.style.display='none';
        document.querySelector('.crop_module .open').onclick=()=>{panel.style.display='block';events.push('open');};
        for(const input of panel.querySelectorAll('input')){input.id='dynamic-'+Math.random();input.value='1500';input.addEventListener('change',()=>events.push(input.closest('.el-input').textContent.trim()+'='+input.value));}
        if(disabled)panel.querySelector('input').disabled=true;
        if(stop)panel.querySelector('input').addEventListener('input',()=>DXMImageEditor.commands.stop(),{once:true});
        panel.querySelector('.footer_btns button').onclick=()=>{events.push('crop-applied');panel.style.display='none';};
        for(const button of panel.querySelectorAll('.icon_btns span'))button.onclick=()=>events.push('ROTATE');
        const menu=document.querySelector('.el-dropdown__popper');menu.style.display='none';document.querySelector('button.save').onclick=()=>{events.push('save-menu');menu.style.display='block';};
        for(const item of menu.querySelectorAll('[role="menuitem"]'))item.onclick=()=>{events.push(item.textContent.trim());if(floating){const box=document.querySelector('.save_box');box.style.display='block';box.insertAdjacentHTML('beforeend','<button>保存</button>');box.querySelector('button').onclick=()=>events.push('final-save');}};
      },{floating,stop,disabled});
    }
    for(const floating of [false,true]){
      await editor({floating});assert.equal((await page.evaluate(()=>DXMImageEditor.commands.crop())).cropped,true);
      await page.evaluate(()=>DXMImageEditor.commands.save());
      const events=await page.evaluate(()=>events);assert.deepEqual(events,['open','W=300','H=300','crop-applied','save-menu','保存并应用',...(floating?['final-save']:[])]);
      await assert.rejects(()=>page.evaluate(()=>DXMImageEditor.commands.save()),/禁止重复提交/);
    }
    for(const options of [{stop:true},{disabled:true}]){
      await editor(options);await assert.rejects(()=>page.evaluate(()=>DXMImageEditor.commands.crop()),options.stop?/已停止/:/不可填写/);
      assert.equal(await page.evaluate(()=>events.includes('crop-applied')),false);
    }
    // Replay the product form and the captured per-image menu. Event handlers
    // model Vue replacing nodes while the driver must preserve the first image.
    const productHtml=read('german-new-image-product.html'),menu=JSON.parse(read('german-new-image-menu.json')).join('');
    await page.setContent('<input name="sourceUrl" value="https://amazon.com/dp/B0TEST0001"><div class="ant-form-item"><div class="ant-form-item-label">产品标题</div><input value="Korb"></div><div class="ant-form-item"><div class="ant-form-item-label">店铺账号</div><span class="ant-select-selection-item">Shop</span></div><div class="ant-form-item"><div class="ant-form-item-label">站点选择</div><span class="ant-select-selection-item">德国</span></div>'+productHtml+menu);
    for(const name of ['core.js','work-target.js','adapter.js'])await page.addScriptTag({path:path.join(root,'extension',name)});
    await page.evaluate(()=>{
      window.record={title:'Korb',source:'https://amazon.com/dp/B0TEST0001',targetShop:'Shop',site:'DE',data:{'新品':'是'}};
      window.opened=0;window.editClicks=0;window.hoverEvents=[];const first=document.querySelector('#imageInfo .img-item');first.querySelector('.img-size').textContent='1500 X 1493';
      for(let i=0;i<5;i++){const clone=first.cloneNode(true);clone.querySelector('img').src='https://fixture.test/extra'+i;first.parentElement.append(clone);}
      const menu=document.querySelector('.ant-dropdown');menu.style.display='none';document.querySelector('#imageInfo').onclick=event=>{
        if(event.target.closest('a.icon_delete')){const card=event.target.closest('.img-item');card.remove();const main=document.querySelector('#imageInfo .img-item');main.replaceWith(main.cloneNode(true));}
        if(event.target.closest('a.icon-operate')){editClicks++;menu.style.display='none';}
      };
      // Reproduce the real hover-only, delayed Ant Dropdown behavior. A click
      // neither opens the menu nor replaces the required pointer entry.
      document.querySelector('#imageInfo').onmouseover=event=>{if(event.target.closest('a.icon-operate')){hoverEvents.push('mouseover');setTimeout(()=>menu.style.display='block',80);}};
      menu.querySelector('[title="小秘美图"]').onclick=()=>{hoverEvents.push('choose');opened++;};
    });
    const clickOnly=await page.evaluate(()=>{document.querySelector('#imageInfo a.icon-operate').click();return {hidden:document.querySelector('.ant-dropdown').style.display==='none',clicks:editClicks};});assert.equal(clickOnly.hidden,true);assert.equal(clickOnly.clicks,1);await page.evaluate(()=>editClicks=0);
    const prepared=await page.evaluate(()=>DXMAdapter.commands.prepareGermanNewImages({record}));assert.equal(prepared.removed,5);assert.equal(prepared.openRequested,true);assert.equal(await page.evaluate(()=>opened),1);
    assert.equal(await page.evaluate(()=>editClicks),0);assert.deepEqual(await page.evaluate(()=>hoverEvents),['mouseover','choose']);
    assert.equal(await page.locator('#imageInfo .img-item').count(),1);
    await assert.rejects(()=>page.evaluate(()=>DXMAdapter.commands.publish({record})),/300×300/);
    const failed=await page.evaluate(async()=>{try{await DXMAdapter.commands.publish({record});}catch(e){return e.notSubmitted;}});assert.equal(failed,true);
    await page.evaluate(()=>document.querySelector('#imageInfo .img-size').textContent='300 X 300');
    const complete=await page.evaluate(()=>DXMAdapter.commands.prepareGermanNewImages({record}));assert.equal(complete.done,true);assert.equal(complete.alreadySized,true);assert.equal(await page.evaluate(()=>opened),1);
    await page.evaluate(()=>record.site='英国');await assert.rejects(()=>page.evaluate(()=>DXMAdapter.commands.prepareGermanNewImages({record})),/站点不匹配|仅德国/);
    console.log('PASS: actual captured image DOM, hover-only delayed menu (click cannot open it), five attachments removed with node replacement, first image preserved, dynamic W/H IDs, 300×300 crop/apply, no rotation, save-and-apply menu and floating Save, stop/disabled controls, no duplicate save, already-sized resume, publish guard, UK isolation. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
