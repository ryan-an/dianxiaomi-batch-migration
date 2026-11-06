// Exercise the production move-result adapter against visible, offline modals.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({...(process.env.DXM_TEST_CHROMIUM?{executablePath:process.env.DXM_TEST_CHROMIUM}:{channel:'msedge'}),headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));
    await page.goto('https://www.dianxiaomi.com/web/amazon/pageList/draft');
    for(const file of ['core.js','work-target.js','batch-state.js','adapter.js'])await page.addScriptTag({path:path.join(__dirname,'../extension',file)});
    const modal=async({success=1,failed=0,ids=[],active=false}={})=>page.setContent(`<div class="ant-modal"><div class="ant-modal-title">执行结果</div><div id="commonProgressBarStatus">${active?'进行中...':''}</div><div>执行成功：${success}个</div><div>执行失败：${failed}</div>${ids.map(id=>`<div>产品：${id}　失败原因：属性异常</div>`).join('')}<button onclick="this.closest('.ant-modal').remove()">关闭</button></div>`);
    const poll=()=>page.evaluate(()=>DXMAdapter.commands.moveProgress({parentIds:['100']}));
    const close=()=>page.evaluate(()=>DXMAdapter.commands.closeMoveProgress({parentIds:['100']}));
    await modal({success:1,failed:2,ids:['901','902']});
    const result=await poll();assert.equal(result.done,true);assert.deepEqual(result.failures.map(x=>x.id),['901','902']);await close();assert.equal(await page.locator('.ant-modal').count(),0);
    await modal({success:29});assert.equal((await poll()).done,true);await close();
    await modal({success:1,failed:1,ids:['100']});await assert.rejects(close(),/父产品移入结果尚未确认成功/);assert.equal(await page.locator('.ant-modal').count(),1);
    await modal({success:1,failed:2,ids:['901']});await assert.rejects(close(),/父产品移入结果尚未确认成功/);
    await modal({success:1,active:true});assert.equal((await poll()).done,false);
    await modal({success:0,failed:0});assert.equal((await poll()).done,false);
    console.log('PASS: production move adapter confirms selected parents only; unseen child IDs and different child counts do not block; parent failures, incomplete failure details and active/empty results remain unconfirmed. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
