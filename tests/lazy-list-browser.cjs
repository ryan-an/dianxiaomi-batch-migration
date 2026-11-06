// Reproduce the site's per-cell dxm-skeleton rendering, entirely offline.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),realRows=JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/us-variants-offline.json'),'utf8'));
(async()=>{
  const browser=await chromium.launch({...(process.env.DXM_TEST_CHROMIUM?{executablePath:process.env.DXM_TEST_CHROMIUM}:{channel:'msedge'}),headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    await page.route('**/*',route=>route.fulfill({body:'<!doctype html><html><body></body></html>',contentType:'text/html'}));
    const setup=async options=>{
      await page.setViewportSize({width:options.narrow?826:1280,height:800});
      await page.goto('https://www.dianxiaomi.com/web/amazon/pageList/offline');
      await page.setContent('<style>body{font:15px/1.6 system-ui;background:#f4f7fb;color:#23354c;margin:0}header,section{padding:20px 32px}header{background:#fff7dd}h1{margin:8px 0}#result{background:white;border:1px solid #d8e2ef;border-radius:12px;margin:16px 28px;padding:20px;color:#246b4b;font-size:19px}.vxe-body--row{height:100px}td{max-width:340px;padding:8px;border-bottom:1px solid #d8e2ef}.dxm-skeleton{height:24px;width:90px;background:#dce3ec}.ant-checkbox{display:inline-block}table{width:100%;background:white}.vxe-table--fixed-left-wrapper{display:none}</style><header>离线验证：不连接店小秘，不提交真实采集、认领、移入或发布。</header><section><h1>列表滚动加载修复验证</h1><div>真实四组父产品及28个子变体DOM，延迟到滚动进入视口后再显示内容。</div></section><div id="result">正在验证完整扫描…</div><div class="vxe-table--main-wrapper"><table><tbody>'+realRows.join('')+'</tbody></table></div>');
      for(const name of ['core.js','batch-state.js','adapter.js'])await page.addScriptTag({path:path.join(root,'extension',name)});
      await page.evaluate(options=>{
        const wrapper=document.querySelector('.vxe-table--main-wrapper');
        if(options.narrow){document.body.style.width='1350px';wrapper.style.marginLeft='248px';wrapper.style.width=options.inner?'580px':'1065px';const style=document.createElement('style');style.textContent='.vxe-table--main-wrapper table{width:1065px;table-layout:fixed;border-collapse:collapse}.vxe-table--main-wrapper td{box-sizing:border-box;max-width:none;padding:0}.vxe-table--main-wrapper td:nth-child(1){width:40px}.vxe-table--main-wrapper td:nth-child(2){width:90px}.vxe-table--main-wrapper td:nth-child(3){width:280px}.vxe-table--main-wrapper td:nth-child(4){width:160px}.vxe-table--main-wrapper td:nth-child(5){width:80px}.vxe-table--main-wrapper td:nth-child(6){width:115px}.vxe-table--main-wrapper td:nth-child(7){width:80px}.vxe-table--main-wrapper td:nth-child(8){width:120px}.vxe-table--main-wrapper td:nth-child(9){width:100px}';document.head.append(style);}
        if(options.inner){wrapper.style.height='380px';wrapper.style.overflow='auto';}
        const originals=new Map(),rows=[...wrapper.querySelectorAll('tr')],loaded=new Set(),redrawn=new Set();window.fixtureLoads=0;window.fixtureExpectedCells=rows.reduce((count,row)=>count+row.cells.length,0);
        const observer=new IntersectionObserver(entries=>{
          for(const entry of entries){
            if(!entry.isIntersecting)continue;
            const cell=entry.target.closest('td'),row=cell.closest('tr'),rowId=row.getAttribute('rowid'),index=rows.findIndex(r=>r.getAttribute('rowid')===rowId),column=cell.cellIndex,key=rowId+'|'+column;
            if(loaded.has(key)||(options.never&&index===rows.length-1&&column===row.cells.length-1))continue;
            observer.unobserve(entry.target);setTimeout(()=>{
              if(loaded.has(key))return;
              const current=[...wrapper.querySelectorAll('tr')].find(r=>r.getAttribute('rowid')===rowId);if(!current)return;
              current.cells[column].innerHTML=originals.get(key);loaded.add(key);window.fixtureLoads++;
              if(options.redraw&&index%3===0&&!redrawn.has(rowId)){redrawn.add(rowId);const fresh=current.cloneNode(true);current.replaceWith(fresh);for(const skeleton of fresh.querySelectorAll('.dxm-skeleton'))observer.observe(skeleton);}
            },45);
          }
        },{root:options.inner?wrapper:null});
        rows.forEach(row=>{for(const td of row.cells){originals.set(row.getAttribute('rowid')+'|'+td.cellIndex,td.innerHTML);td.innerHTML='<div class="vxe-cell"><div class="dxm-skeleton"></div></div>';observer.observe(td.querySelector('.dxm-skeleton'));}});
        if(options.hidden){const hidden=document.createElement('tr');hidden.className='vxe-body--row';hidden.setAttribute('rowid','hidden');hidden.style.display='none';hidden.innerHTML='<td><div class="dxm-skeleton"></div></td>';wrapper.querySelector('tbody').append(hidden);}
      },options);
    };
    if(process.env.DXM_BASELINE_ADAPTER){
      await setup({narrow:true});await page.addScriptTag({path:path.resolve(process.env.DXM_BASELINE_ADAPTER)});
      const oldError=await page.evaluate(async()=>{const original=Date.now,start=performance.now();Date.now=()=>original()+Math.floor((performance.now()-start)*20);try{await DXMAdapter.commands.snapshot();return '';}catch(error){return error.message;}finally{Date.now=original;}});
      assert.match(oldError,/等待超时：加载完整列表行/);console.log('REPRODUCED: released v0.4.45 adapter times out in the same independently lazy-loaded 826px table.');
    }
    for(const options of [{},{inner:true,redraw:true,hidden:true},{narrow:true},{narrow:true,inner:true,redraw:true,hidden:true}]){
      await setup(options);
      const before=await page.evaluate(()=>DXMAdapter.rows());assert.ok(before.length<4);
      const expected=await page.evaluate(()=>fixtureExpectedCells);
      const snapshot=await page.evaluate(()=>DXMAdapter.commands.snapshot());
      assert.equal(snapshot.rows.length,4);assert.deepEqual(snapshot.rows.map(r=>r.variantIds.length),[2,2,12,12]);assert.equal(new Set(snapshot.rows.flatMap(r=>[r.id,...r.variantIds])).size,32);
      assert.equal(await page.evaluate(()=>window.scrollY),0);assert.equal(await page.evaluate(()=>window.scrollX),0);assert.equal(await page.locator('.vxe-table--main-wrapper').evaluate(e=>e.scrollTop),0);assert.equal(await page.locator('.vxe-table--main-wrapper').evaluate(e=>e.scrollLeft),0);
      assert.equal(await page.evaluate(()=>fixtureLoads),expected);assert.equal(await page.locator('.vxe-table--main-wrapper .dxm-skeleton').filter({visible:true}).count(),0);
      await page.locator('#result').evaluate(e=>{e.style.maxWidth='720px';e.textContent='验证通过：826像素窄窗口 · 4 个父产品 · 28 个子变体 · 32 个ID全部齐全。每个单元格单独按视口加载；横向与纵向滚动、内层滚动和重绘均通过，扫描后恢复原位置。';});
    }
    if(process.env.DXM_LAZY_SCREENSHOT){const output=path.resolve(process.env.DXM_LAZY_SCREENSHOT);fs.mkdirSync(path.dirname(output),{recursive:true});await page.screenshot({path:output});}
    await setup({never:true});
    const timedOut=await page.evaluate(async()=>{const original=Date.now,start=performance.now();Date.now=()=>original()+Math.floor((performance.now()-start)*20);try{await DXMAdapter.commands.snapshot();return {};}catch(error){return {message:error.message,listIncomplete:error.listIncomplete};}finally{Date.now=original;}});
    assert.match(timedOut.message,/加载完整列表行.*禁止使用部分列表/);assert.equal(timedOut.listIncomplete,true);assert.equal(await page.evaluate(()=>window.scrollY),0);
    await setup({never:true});
    const stopped=await page.evaluate(async()=>{setTimeout(()=>DXMAdapter.commands.stop(),400);try{await DXMAdapter.commands.snapshot();return '';}catch(error){return error.message;}});assert.match(stopped,/已停止/);
    console.log('PASS: 4 real parents + 28 children; each cell renders independently. Verified 826px viewport, offscreen operation column, document/nested horizontal and vertical scrolling, redraw, hidden rows, scroll restoration, explicit incomplete-list error and stop. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
