// Local browser regression. Uses a mock backend and never contacts Dianxiaomi.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const workspace=path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.xls':'application/vnd.ms-excel'};
const server=http.createServer((req,res)=>{
  const file=path.resolve(workspace,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(workspace+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(bytes);});
});
(async()=>{
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const url=`http://127.0.0.1:${server.address().port}/tests/in-page.html?state=ready`;
    await page.goto(url);
    const panel=page.locator('#surface'),close=page.locator('#closePanel'),shade=page.locator('#shade');
    await page.locator('#start:enabled').waitFor();
    await page.locator('#under').click();assert.equal(await page.locator('#count').textContent(),'页面点击次数：1');
    await close.click();assert.equal(await panel.isVisible(),false);assert.equal(await page.locator('#launcher').count(),0);
    await page.locator('#simulateIcon').click();await panel.waitFor({state:'visible'});
    await page.locator('#start').click();await shade.waitFor({state:'visible'});
    assert.equal(await close.isDisabled(),true);assert.equal(await page.locator('#runNotice').isVisible(),true);
    assert.equal(await page.evaluate(()=>DXMPanel.close()),false);
    const button=await page.locator('#under').boundingBox();await page.mouse.click(button.x+10,button.y+10);
    assert.equal(await page.locator('#count').textContent(),'页面点击次数：1');
    await page.mouse.wheel(0,500);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>scrollY),0);
    await page.evaluate(()=>{const field=document.createElement('input');field.id='manual';document.querySelector('.card').append(field);field.focus();});
    await page.keyboard.type('manual change');assert.equal(await page.locator('#manual').inputValue(),'');
    // Synthetic DOM operations used by the adapter must continue through the lock.
    await page.evaluate(()=>document.getElementById('under').click());assert.equal(await page.locator('#count').textContent(),'页面点击次数：2');
    await page.screenshot({path:path.join(workspace,'outputs/panel-running-v0.4.16.png')});
    await page.evaluate(()=>{window.savedSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=async message=>{if(message.kind==='DXM_STATUS')throw new Error('模拟后台失联');return savedSend(message);};});
    await page.waitForFunction(()=>DXMPanel.root.getElementById('status').textContent==='后台连接失败');
    assert.equal(await shade.isVisible(),true);assert.equal(await close.isDisabled(),true);
    await page.evaluate(()=>{chrome.runtime.sendMessage=savedSend;});
    await page.locator('#stop').click();
    assert.equal(await close.isDisabled(),true);assert.equal(await shade.isVisible(),true);
    await shade.waitFor({state:'hidden'});assert.equal(await close.isEnabled(),true);
    await page.locator('#under').click();assert.equal(await page.locator('#count').textContent(),'页面点击次数：3');
    await close.click();await page.waitForFunction(()=>mockData.dxmPanelClosed===true);
    await page.reload();await page.locator('#start:enabled').waitFor({state:'attached'});assert.equal(await panel.isVisible(),false);
    await page.locator('#simulateIcon').click();await panel.waitFor({state:'visible'});
    assert.equal(await page.locator('#launcher').count(),0);assert.deepEqual(errors,[]);
    // A running job must reopen a previously closed panel and retain the stop control.
    await close.click();await page.waitForFunction(()=>mockData.dxmPanelClosed===true);
    await page.goto(url.replace('state=ready','state=running'));await shade.waitFor({state:'visible'});
    assert.equal(await panel.isVisible(),true);assert.equal(await close.isDisabled(),true);assert.equal(await page.locator('#stop').isVisible(),true);
    await page.screenshot({path:path.join(workspace,'outputs/panel-running-v0.4.16.png')});
    console.log('PASS：执行提示、点击/输入/滚动拦截、自动填写不受阻、执行及停止等待期间禁止关闭、失联保留锁定、停止后解锁、关闭/重新打开/刷新恢复、无悬浮小按钮、运行时自动展开。');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
