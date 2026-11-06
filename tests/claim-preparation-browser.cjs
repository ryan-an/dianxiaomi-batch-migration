// Replay the real shop modal, with delayed and replaced render containers. Offline only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),modalHtml=fs.readFileSync(path.join(root,'docs/evidence/claim-dialog.html'),'utf8');
(async()=>{
  const browser=await chromium.launch({...(process.env.DXM_TEST_CHROMIUM?{executablePath:process.env.DXM_TEST_CHROMIUM}:{channel:'msedge'}),headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:850}});
    await page.route('**/*',route=>route.fulfill({body:'<!doctype html><html><body></body></html>',contentType:'text/html'}));
    const setup=async mode=>{
      await page.goto('https://www.dianxiaomi.com/web/productCrawl/dataAcquisition');
      await page.setContent('<style>body{font:15px/1.6 system-ui;margin:0;background:#f3f6fb;color:#273c54}header{padding:16px 28px;background:#fff7dc}main{margin:24px}#result{padding:18px;background:white;border:1px solid #dce4ef;border-radius:10px;color:#237246;margin:16px 0}.ant-modal{margin:18px 26px;background:white;border:1px solid #cbd8ea;padding:20px}.ant-modal-header{font-size:20px;font-weight:600}.ant-modal-close,.ant-select,.checked-shop-box{display:none}.ant-modal-footer{padding-top:18px}.ant-modal button,button{padding:8px 16px;margin:6px;cursor:pointer}.shop-box{width:650px;height:240px;overflow:auto}.shop-box .overflow-auto{height:180px;overflow:auto}.shop-title{font-weight:600;margin:8px}.shop-label-box{display:inline-block;padding:8px}.platform-btn{padding:6px 16px;cursor:pointer}.platform-btn.active{background:#e3efff;color:#2267b7}.render-skeleton{height:80px;background:#d9e2ed}.shop-div[name="amazon"] input{accent-color:#2563d6}.no-new-line{display:inline-block}svg{display:none}</style><header>离线验证：不连接店小秘，不提交真实认领或发布。</header><main><h1>店铺加载与提交阶段修复验证</h1><div id="result">正在验证…</div><button id="bulk">批量认领</button><div class="vxe-table--main-wrapper"><table><tbody><tr class="vxe-body--row" rowid="c1"><td><input type="checkbox" checked></td><td><a href="https://www.amazon.com/dp/B0TEST0001">来源</a></td><td><div class="no-new-line4" title="Offline product">Offline product</div></td></tr></tbody></table></div></main><div id="host"></div>');
      for(const name of ['core.js','batch-state.js','adapter.js'])await page.addScriptTag({path:path.join(root,'extension',name)});
      await page.evaluate(({html,mode})=>{
        const template=document.createElement('template');template.innerHTML=html;const base=template.content.querySelector('.ant-modal');
        for(const e of base.querySelectorAll('[getcontent]'))e.removeAttribute('getcontent');
        const group=base.querySelector('.shop-div[name="amazon"]'),container=group.querySelector('.shop-list-div > .render-container'),example=container.querySelector('.shop-label-box').cloneNode(true);
        container.replaceChildren();
        for(const site of ['美国','加拿大','墨西哥']){const label=example.cloneNode(true);label.querySelector('.no-new-line').innerHTML='<span>['+site+']</span><span>烁瑞达US</span>';label.querySelector('input').checked=false;if(mode==='missing'&&site==='美国')continue;if(mode==='disabled'&&site==='美国')label.querySelector('input').disabled=true;container.append(label);if(mode==='duplicate'&&site==='美国')container.append(label.cloneNode(true));}
        if(!base.querySelector('.platform-btn[name="amazon"]')){const channel=document.createElement('span');channel.className='platform-btn';channel.setAttribute('name','amazon');channel.textContent='Amazon';base.querySelector('.ant-modal-body').prepend(channel);}
        const loaded=container.innerHTML;window.claimMetrics={opened:0,confirmed:0,closed:0,redraws:0,lazyLoads:0};
        const attach=m=>{
          m.querySelector('.platform-btn[name="amazon"]').onclick=event=>{for(const button of m.querySelectorAll('.platform-btn'))button.classList.remove('active');event.currentTarget.classList.add('active');};
          for(const button of m.querySelectorAll('button')){
            const text=button.textContent.replace(/\s/g,'');
            if(text==='关闭')button.onclick=()=>{claimMetrics.closed++;m.remove();};
            if(text==='确定')button.onclick=()=>{
              claimMetrics.confirmed++;const selected=[...m.querySelectorAll('.shop-div input')].filter(e=>e.checked);claimMetrics.selected=selected.map(e=>e.closest('label').textContent.trim());m.remove();
              if(mode!=='post_timeout'){const progress=document.createElement('div');progress.className='ant-modal';progress.innerHTML='<div class="ant-modal-title">认领到采集箱</div><div id="commonProgressBarStatus">进行中...</div>';document.getElementById('host').append(progress);}
            };
          }
        };
        const open=()=>{
          claimMetrics.opened++;const m=base.cloneNode(true);attach(m);document.getElementById('host').replaceChildren(m);
          const render=m.querySelector('.shop-div[name="amazon"] .shop-list-div > .render-container');
          if(['delay_redraw','lazy','never','stop'].includes(mode)){
            render.innerHTML='<div class="render-skeleton"></div>';
            if(mode==='delay_redraw')setTimeout(()=>{if(!m.isConnected)return;const fresh=m.cloneNode(true);fresh.querySelector('.shop-div[name="amazon"] .shop-list-div > .render-container').innerHTML=loaded;attach(fresh);m.replaceWith(fresh);claimMetrics.redraws++;},1100);
            if(mode==='lazy'){
              m.querySelector('.shop-div[name="amazon"]').style.marginTop='550px';const scroll=m.querySelector('.shop-box .overflow-auto')||m.querySelector('.shop-box');
              const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();render.innerHTML=loaded;claimMetrics.lazyLoads++;}},{root:scroll});observer.observe(render.querySelector('.render-skeleton'));
            }
          }
        };
        document.getElementById('bulk').onclick=open;
        if(mode==='reuse'){open();claimMetrics.opened=0;}
      },{html:modalHtml,mode});
    };
    for(const mode of ['reuse','delay_redraw','lazy']){
      await setup(mode);
      const prepared=await page.evaluate(async mode=>{const original=Date.now,start=performance.now();if(mode==='delay_redraw')Date.now=()=>original()+Math.floor((performance.now()-start)*30);try{const args={ids:DXMAdapter.rows().map(r=>r.id),shop:'烁瑞达US',site:'US'};await DXMAdapter.commands.prepareClaim(args);return {args,metrics:{...claimMetrics},selected:[...document.querySelectorAll('.shop-div input')].filter(e=>e.checked).map(e=>e.closest('label').textContent.trim())};}finally{Date.now=original;}},mode);
      assert.equal(prepared.metrics.confirmed,0);assert.deepEqual(prepared.selected,['[美国]烁瑞达US']);if(mode==='reuse')assert.equal(prepared.metrics.opened,0);if(mode==='delay_redraw')assert.equal(prepared.metrics.redraws,1);if(mode==='lazy')assert.equal(prepared.metrics.lazyLoads,1);
      if(mode==='reuse'&&process.env.DXM_CLAIM_SCREENSHOT){await page.locator('#result').evaluate(e=>{e.textContent='验证通过：已准备好目标店铺 [美国]烁瑞达US；准备阶段提交0次。店铺等待、重绘及加载重试与最终提交分开记录。';});const output=path.resolve(process.env.DXM_CLAIM_SCREENSHOT);fs.mkdirSync(path.dirname(output),{recursive:true});await page.screenshot({path:output,fullPage:true});}
      await page.evaluate(args=>DXMAdapter.commands.claim({...args,prepared:true}),prepared.args);const metrics=await page.evaluate(()=>claimMetrics);assert.equal(metrics.confirmed,1);assert.deepEqual(metrics.selected,['[美国]烁瑞达US']);
    }
    for(const mode of ['missing','duplicate','disabled','never','stop']){
      await setup(mode);
      const error=await page.evaluate(async mode=>{const original=Date.now,start=performance.now();if(mode==='never')Date.now=()=>original()+Math.floor((performance.now()-start)*100);if(mode==='stop')setTimeout(()=>DXMAdapter.commands.stop(),400);try{await DXMAdapter.commands.prepareClaim({ids:DXMAdapter.rows().map(r=>r.id),shop:'烁瑞达US',site:'美国'});return {};}catch(error){return {message:error.message,notSubmitted:error.notSubmitted,retryable:error.retryable,confirmed:claimMetrics.confirmed};}finally{Date.now=original;}},mode);
      assert.equal(error.notSubmitted,true,JSON.stringify({mode,error}));assert.equal(error.confirmed,0);if(['missing','duplicate','disabled'].includes(mode))assert.equal(error.retryable,false);
    }
    await setup('reuse');
    const changed=await page.evaluate(async()=>{const args={ids:DXMAdapter.rows().map(r=>r.id),shop:'烁瑞达US',site:'美国'};await DXMAdapter.commands.prepareClaim(args);document.querySelector('.shop-div[name="amazon"] input').checked=false;try{await DXMAdapter.commands.claim({...args,prepared:true});return {};}catch(error){return {notSubmitted:error.notSubmitted,retryable:error.retryable,confirmed:claimMetrics.confirmed};}});assert.deepEqual(changed,{notSubmitted:true,retryable:true,confirmed:0});
    await setup('post_timeout');
    const after=await page.evaluate(async()=>{const args={ids:DXMAdapter.rows().map(r=>r.id),shop:'烁瑞达US',site:'美国'};await DXMAdapter.commands.prepareClaim(args);const original=Date.now,start=performance.now();Date.now=()=>original()+Math.floor((performance.now()-start)*100);try{await DXMAdapter.commands.claim({...args,prepared:true});return {};}catch(error){return {notSubmitted:error.notSubmitted===true,confirmed:claimMetrics.confirmed};}finally{Date.now=original;}});assert.deepEqual(after,{notSubmitted:false,confirmed:1});
    console.log('PASS: real shop-modal structure, existing dialog reuse, delay beyond old 20s, complete modal redraw, lazy shop rendering, missing/duplicate/disabled targets, pre-submit changes, stop and post-click timeout verified. Preparation never confirms; successful submission confirms once. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
