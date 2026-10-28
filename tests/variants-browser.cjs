// Replay the four real product groups and sale-type DOM entirely offline.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));
    await page.goto('https://www.dianxiaomi.com/web/amazon/pageList/offline');
    const rows=JSON.parse(fs.readFileSync('docs/evidence/us-variants-offline.json','utf8'));
    await page.setContent('<div class="vxe-table--main-wrapper"><table><tbody>'+rows.join('')+'</tbody></table></div>');
    for(const name of ['core.js','work-target.js','batch-state.js','adapter.js'])await page.addScriptTag({path:path.join(__dirname,'../extension',name)});
    const parsed=await page.evaluate(()=>DXMAdapter.rows());
    assert.equal(parsed.length,4);assert.deepEqual(parsed.map(r=>r.variantIds.length),[2,2,12,12]);
    assert.equal(parsed[0].title,parsed[1].title);assert.notEqual(parsed[0].source,parsed[1].source);
    assert.equal(new Set(parsed.flatMap(r=>[r.id,...r.variantIds])).size,32);
    assert.ok(parsed.every(r=>new URL(r.editUrl).searchParams.get('id')===r.id));
    const actual=JSON.parse(fs.readFileSync('docs/evidence/us-sale-type-after.json','utf8'));
    const before=JSON.parse(fs.readFileSync('docs/evidence/us-sale-type-before.json','utf8'));
    await page.goto('https://www.dianxiaomi.com/web/amazon/edit?id='+parsed[0].id);
    await page.setContent(actual.basic+actual.source);
    for(const name of ['core.js','work-target.js','batch-state.js','adapter.js'])await page.addScriptTag({path:path.join(__dirname,'../extension',name)});
    const record={productId:parsed[0].id,source:parsed[0].source,title:parsed[0].title,targetShop:'烁宇US',site:'美国',sellingMode:'single',data:{}};
    const restore=async()=>page.evaluate(html=>{document.getElementById('form_item_saleType').closest('.ant-form-item').outerHTML=html;},before);
    await restore();
    let result=await page.evaluate(record=>DXMAdapter.commands.ensureSellingMode({record}),record);
    assert.equal(result.value,'单品');assert.equal(result.changed,true);
    assert.equal(await page.locator('#form_item_saleType input[value="0"]').isChecked(),true);
    result=await page.evaluate(record=>DXMAdapter.commands.ensureSellingMode({record}),record);assert.equal(result.changed,false);
    // Re-read after a reactive replacement resets the selection on the first click.
    await restore();await page.evaluate(()=>{let once=false;document.getElementById('form_item_saleType').addEventListener('change',e=>{if(once)return;once=true;const item=e.target.closest('.ant-form-item'),fresh=item.cloneNode(true);fresh.querySelector('input[value="0"]').checked=false;fresh.querySelector('input[value="1"]').checked=true;item.replaceWith(fresh);});});
    result=await page.evaluate(record=>DXMAdapter.commands.ensureSellingMode({record}),record);assert.equal(result.value,'单品');
    await restore();await page.locator('#form_item_saleType input[value="0"]').evaluate(e=>{e.disabled=true;});
    await assert.rejects(page.evaluate(record=>DXMAdapter.commands.ensureSellingMode({record}),record),/被禁用/);
    await restore();await assert.rejects(page.evaluate(record=>DXMAdapter.commands.ensureSellingMode({record:{...record,source:'https://amazon.com/dp/B0WRONG000'}}),record),/来源链接不匹配/);
    assert.equal(await page.locator('#form_item_saleType input[value="1"]').isChecked(),true);
    console.log('真实四组父产品与28个变体、同标题不同来源、单品切换、重复执行、节点重绘、禁用及身份保护全部通过（离线）。');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
