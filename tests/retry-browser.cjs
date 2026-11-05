const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright'),root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({...(process.env.DXM_TEST_CHROMIUM?{executablePath:process.env.DXM_TEST_CHROMIUM}:{channel:'msedge'}),headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>{
      const url=new URL(route.request().url()),name=url.pathname==='/web/productCrawl/dataAcquisition'?'tests/retry-fixture.html':url.pathname.slice(1),file=path.resolve(root,name);
      if(url.hostname!=='retry.test'||!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.abort();
      return route.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});
    });
    await page.goto('http://retry.test/web/productCrawl/dataAcquisition');
    for(const mode of ['modal','popover','popconfirm','direct','list','isolation']){const result=await page.evaluate(mode=>runRetryFixture(mode),mode);assert.equal(result.passed,true,JSON.stringify({mode,result}));}
    if(process.env.DXM_RETRY_SCREENSHOT){const screenshot=path.resolve(process.env.DXM_RETRY_SCREENSHOT);fs.mkdirSync(path.dirname(screenshot),{recursive:true});await page.screenshot({path:screenshot,fullPage:true});}
    const rejected=await page.evaluate(()=>runRetryFixture('reject'));assert.equal(rejected.passed,false);assert.equal(rejected.notSubmitted,true);assert.equal(rejected.retryClicks,1);
    const skip=await page.evaluate(()=>runRetryFixture('skip'));assert.equal(skip.notSubmitted,true);assert.equal(skip.retryClicks,0);
    console.log('PASS: production retry adapter handles modal, popconfirm, direct acknowledgement and stable list transitions; 21-row workflow isolates one timeout and continues 20; rejection and skipped-record guard do not resubmit. Offline only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
