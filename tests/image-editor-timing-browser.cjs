// Exercise the production driver against captured editor DOM with delayed UI.
// Every network request is blocked; no live product or editor is accessed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({...(process.env.DXM_TEST_CHROMIUM?{executablePath:process.env.DXM_TEST_CHROMIUM}:{channel:'msedge'}),headless:true});
  try{
    const page=await browser.newPage(),html=fs.readFileSync(path.join(root,'docs/evidence/german-new-image-crop.html'),'utf8');
    const editorUrl='https://www.dianxiaomi.com/api/meituv2/editor.htm';
    await page.route('**/*',route=>route.request().url()===editorUrl?route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}):route.abort());
    async function setup(){
      await page.goto(editorUrl);await page.setContent(html);await page.addScriptTag({path:path.join(root,'extension/image-editor.js')});
      await page.waitForFunction(()=>{const image=document.querySelector('img.selected');return image?.complete&&image.naturalWidth>0;});
      await page.evaluate(()=>{
        window.events=[];window.bindCrop=()=>{
          const panel=document.querySelector('.crop_module .parameter');panel.style.display='none';
          document.querySelector('.crop_module .open').onclick=()=>{events.push('open');panel.style.display='block';};
          for(const input of panel.querySelectorAll('input')){input.value='1500';input.onchange=()=>events.push(input.closest('.el-input').textContent.trim()+'='+input.value);}
          panel.querySelector('.footer_btns button').onclick=()=>{events.push('apply');panel.style.display='none';};
        };bindCrop();
      });
    }
    const crop=()=>page.evaluate(()=>DXMImageEditor.commands.crop());
    const ready=()=>page.evaluate(()=>DXMImageEditor.commands.ready());
    const counts=()=>page.evaluate(()=>({opens:events.filter(e=>e==='open').length,applies:events.filter(e=>e==='apply').length,skips:events.filter(e=>e==='skip').length}));

    await setup();assert.equal((await ready()).ready,true);
    assert.equal((await crop()).cropped,true);assert.deepEqual(await counts(),{opens:1,applies:1,skips:0});
    await page.addScriptTag({path:path.join(root,'extension/image-editor.js')});
    assert.equal((await crop()).cropped,true);assert.deepEqual(await counts(),{opens:1,applies:1,skips:0});

    // Live 2026-11-05 UI: the legacy module is hidden behind an adjust card.
    for(const autoOpen of [false,true]){
      await setup();await page.evaluate(autoOpen=>{
        const module=document.querySelector('.crop_module'),feature=document.createElement('div');feature.className='adjust_feature_panel';feature.dataset.subTool='CropRotate';feature.style.display='none';module.before(feature);feature.append(module);
        const card=document.createElement('button');card.className='adjust_card tool_card';card.type='button';
        card.innerHTML='<span class="adjust_card_content"><span class="adjust_card_name">裁剪/旋转</span><span class="adjust_card_desc">裁掉多余画面，调整图片方向</span></span>';
        feature.before(card);card.onclick=()=>{events.push('card');setTimeout(()=>{feature.style.display='';if(autoOpen)module.querySelector('.parameter').style.display='block';},250);};
      },autoOpen);
      assert.equal(await page.locator('.crop_module .open').isVisible(),false);assert.equal((await ready()).ready,true);
      assert.equal((await crop()).cropped,true);
      assert.equal(await page.evaluate(()=>events.filter(e=>e==='card').length),1);assert.equal((await counts()).opens,autoOpen?0:1);assert.equal((await counts()).applies,1);
    }

    // The image is loaded and the node exists, but its ancestor is still hidden.
    await setup();await page.evaluate(()=>document.querySelector('.crop_module').style.display='none');
    assert.equal((await ready()).ready,false);
    await page.evaluate(()=>setTimeout(()=>document.querySelector('.crop_module').style.display='',350));
    assert.equal((await crop()).cropped,true);assert.deepEqual(await counts(),{opens:1,applies:1,skips:0});

    // Ready can become stale before Crop arrives; replace the entire module.
    await setup();assert.equal((await ready()).ready,true);
    await page.evaluate(()=>{
      const old=document.querySelector('.crop_module'),parent=old.parentNode,next=old.nextSibling,fresh=old.cloneNode(true);old.remove();
      setTimeout(()=>{parent.insertBefore(fresh,next);bindCrop();},350);
    });
    assert.equal((await crop()).cropped,true);assert.deepEqual(await counts(),{opens:1,applies:1,skips:0});

    // Dismissing a guide can hide/rebuild tools asynchronously. Click it once.
    for(const initiallyHidden of [false,true]){
      await setup();await page.evaluate(initiallyHidden=>{
        const box=document.querySelector('.crop_module'),skip=document.createElement('button');skip.textContent='跳过';document.body.append(skip);
        if(initiallyHidden)box.style.display='none';
        skip.onclick=()=>{events.push('skip');box.style.display='none';setTimeout(()=>{skip.remove();box.style.display='';},450);};
      },initiallyHidden);
      assert.equal((await ready()).ready,true);assert.equal((await crop()).cropped,true);
      assert.deepEqual(await counts(),{opens:1,applies:1,skips:1});
    }

    await setup();await page.evaluate(()=>{
      const box=document.querySelector('.crop_module'),skip=document.createElement('button');box.style.display='none';skip.textContent='跳过';skip.disabled=true;document.body.append(skip);
      skip.onclick=()=>{events.push('skip');skip.remove();box.style.display='';};setTimeout(()=>skip.disabled=false,350);
    });
    assert.equal((await ready()).ready,false);assert.equal((await crop()).cropped,true);assert.equal((await counts()).skips,1);

    // A newly rendered node must settle before clicking; do not use old nodes.
    await setup();await page.evaluate(()=>setTimeout(()=>{
      const old=document.querySelector('.crop_module');old.replaceWith(old.cloneNode(true));bindCrop();
    },100));
    assert.equal((await crop()).cropped,true);assert.deepEqual(await counts(),{opens:1,applies:1,skips:0});

    // A click can trigger a rerender that discards the opening panel.
    await setup();await page.evaluate(()=>{
      document.querySelector('.crop_module .open').onclick=()=>{
        events.push('open');const old=document.querySelector('.crop_module'),fresh=old.cloneNode(true);old.replaceWith(fresh);bindCrop();
      };
    });
    assert.equal((await crop()).cropped,true);assert.deepEqual(await counts(),{opens:2,applies:1,skips:0});

    // An opening animation must not cause repeated clicks that toggle it shut.
    await setup();await page.evaluate(()=>{
      document.querySelector('.crop_module .open').onclick=()=>{events.push('open');setTimeout(()=>document.querySelector('.crop_module .parameter').style.display='block',750);};
    });
    assert.equal((await crop()).cropped,true);assert.deepEqual(await counts(),{opens:1,applies:1,skips:0});

    await setup();await page.evaluate(()=>{
      const open=document.querySelector('.crop_module .open');open.setAttribute('aria-disabled','true');
    });
    assert.equal((await ready()).ready,false);
    await page.evaluate(()=>setTimeout(()=>document.querySelector('.crop_module .open').setAttribute('aria-disabled','false'),350));
    assert.equal((await crop()).cropped,true);

    await setup();await page.evaluate(()=>{document.querySelector('.crop_module .open').style.display='none';document.querySelector('.crop_module .parameter').style.display='block';});
    assert.equal((await ready()).ready,true);assert.equal((await crop()).cropped,true);assert.equal((await counts()).opens,0);

    await setup();await page.evaluate(()=>{
      document.querySelector('.crop_module').style.display='none';setTimeout(()=>DXMImageEditor.commands.stop(),50);
    });
    await assert.rejects(crop,/已停止/);assert.equal((await counts()).applies,0);

    await setup();await page.evaluate(()=>{
      const old=document.querySelector('.crop_module .open');old.after(old.cloneNode(true));
    });
    await assert.rejects(crop,/裁剪\/旋转：找到2个控件/);assert.equal((await counts()).applies,0);

    // Speed up only the deadline clock, preserving the production timeout path.
    await setup();await page.evaluate(()=>{
      document.querySelector('.crop_module').style.display='none';window.realDateNow=Date.now;let advance=0;Date.now=()=>realDateNow()+(advance+=10000);
    });
    try{await assert.rejects(crop,/等待超时：裁剪\/旋转/);}finally{await page.evaluate(()=>Date.now=realDateNow);}
    assert.deepEqual(await counts(),{opens:0,applies:0,skips:0});
    await assert.rejects(()=>page.evaluate(()=>DXMImageEditor.commands.save()),/裁剪尚未应用/);
    await page.goto(editorUrl);await page.setContent(html);await page.addScriptTag({path:path.join(root,'extension/image-editor.js')});
    await page.evaluate(()=>DXMImageEditor.commands.stop());await page.addScriptTag({path:path.join(root,'extension/image-editor.js')});
    await assert.rejects(crop,/已停止/);
    await page.goto('about:blank');await page.addScriptTag({path:path.join(root,'extension/image-editor.js')});
    assert.equal(await page.evaluate(()=>typeof DXMImageEditor),'undefined');
    console.log('PASS: delayed visibility, stale readiness, guide transitions, node replacement before/after click, delayed panel without repeated toggles, temporary disabled state, already-open panel, stop, ambiguity and bounded timeout. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
