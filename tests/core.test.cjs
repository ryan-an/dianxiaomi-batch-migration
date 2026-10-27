const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const X=require('../extension/vendor/xlsx.full.min.js'),C=require('../extension/core.js');
const workbook=()=>X.read(fs.readFileSync('店小秘自动采集迁移产品-英国数据.xls'));

test('英国和UK双向等价，识别大小写及首尾空格，其他站点保持区分',()=>{
  for(const value of ['英国','UK','uk',' Uk ','ＵＫ']){assert.equal(C.normalizeSite(value),'英国');assert.ok(C.sameSite(value,'英国'));assert.ok(C.sameSite('UK',value));assert.equal(C.shopForSite('万万欣UK',value),'万万欣DE');}
  assert.equal(C.sameSite('UK','美国'),false);assert.equal(C.normalizeSite('德国'),'德国');
  assert.ok(C.siteInText('标题「万万欣DE」UK','英国'));assert.ok(C.siteInText('标题「万万欣DE」英国','UK'));
  assert.equal(C.siteInText('标题「万万欣UK」美国','英国'),false);assert.equal(C.siteInText('DUKE「万万欣DE」美国','UK'),false);
});

test('表格混用UK和英国时合为同一站点组，保留原始单元格并正确映射店铺',()=>{
  const w=X.utils.book_new();X.utils.book_append_sheet(w,X.utils.aoa_to_sheet([['链接','店铺','站点'],['https://amazon.com/dp/B0TEST0001','万万欣UK','UK'],['https://amazon.com/dp/B0TEST0002','万万欣UK','英国']]),'输入');
  const p=C.parseWorkbook(w,X);assert.deepEqual(p.groups,['万万欣DE|英国']);assert.ok(p.rows.every(r=>!r.error&&r.site==='英国'&&r.targetShop==='万万欣DE'));assert.equal(p.rows[0].data['站点'],'UK');
});
test('真实xls：10条完整产品，后4条按用户授权跨表补齐',()=>{
  const p=C.parseWorkbook(workbook(),X,{mergeSplit:true});assert.equal(p.rows.length,10);assert.equal(p.rows.filter(r=>r.error).length,0);
  assert.equal(p.rows[6].data['Parent SKU'],'FTY-15F-FIDF');assert.equal(p.rows[9].data['Parent SKU'],'FBS-97B-PODW');
  assert.match(p.rows[6].provenance,/Sheet1!8 \+ Sheet2!1/);assert.equal(p.rows[0].data.UPC,'780715899310');assert.equal(p.rows[0].data['商品尺寸:长（cm）'],'0');assert.equal(p.rows[0].targetShop,'万万欣DE');
});
test('未授权跨表合并时，缺店铺的4条明确报错',()=>{const p=C.parseWorkbook(workbook(),X,{mergeSplit:false});assert.equal(p.rows.filter(r=>r.status==='数据错误').length,4);});
test('Amazon来源去跟踪参数，但不把英国新ASIN混成原来源',()=>{assert.equal(C.sourceKey('https://www.amazon.com/dp/B0FMXZ1XHX?tag=xx'),C.sourceKey('https://amazon.com/gp/product/B0FMXZ1XHX'));assert.notEqual(C.sourceKey('https://amazon.co.uk/dp/B0HNZQLFMP'),C.sourceKey('https://amazon.com/dp/B0FMXZ1XHX'));assert.throws(()=>C.sourceKey('javascript:alert(1)'));});
test('重复链接、模糊匹配均阻止写错行',()=>{
  const w=X.utils.book_new();X.utils.book_append_sheet(w,X.utils.aoa_to_sheet([['链接','店铺','站点'],['https://amazon.com/dp/B0FMXZ1XHX','A','英国'],['https://amazon.com/dp/B0FMXZ1XHX?ref=1','A','英国']]),'输入');
  const p=C.parseWorkbook(w,X);assert.equal(p.rows[1].status,'数据错误');assert.throws(()=>C.uniqueMatch([{id:1},{id:1}],x=>x.id===1,'产品'),/2 条/);
});
test('单位等价识别，CSV防止公式注入并保留换行与引号',()=>{
  assert.equal(C.unitKey('Zentimeter(厘米)'),C.unitKey('Centimetres(厘米)'));assert.equal(C.unitKey('Kilograms(公斤)'),'kg');
  const c=C.csv([{source:'=HYPERLINK("x")',title:'a,b\n"c"',history:[]}]);assert.ok(c.startsWith('\ufeff'));assert.ok(c.includes("'=HYPERLINK"));assert.ok(c.includes('"a,b\n""c"""'));
});
