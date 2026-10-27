const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const C=require('../extension/core.js'),X=require('../extension/vendor/xlsx.full.min.js');
test('新品=是触发图片处理，不区分站点',()=>{
  for(const site of ['DE','德国',' de ','ＤＥ','英国','UK','美国','US',''])assert.equal(C.isNewProduct({site,data:{'新品':' 是 '}}),true);
  for(const record of [{site:'DE',data:{'新品':''}},{site:'DE',data:{'新品':'否'}},{site:'DE',data:{}},{}])assert.equal(C.isNewProduct(record),false);
  // Use a fixed fixture: the user edits 新品 in the real input workbook between runs.
  const book=X.utils.book_new();X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([
    ['链接','店铺','站点','德国标题翻译','新品'],['https://amazon.com/dp/B0TEST0001','Shop','DE','Korb','是'],['https://amazon.com/dp/B0TEST0002','Shop','DE','Schale','']
  ]),'输入');
  const rows=C.parseWorkbook(book,X).rows;assert.deepEqual(rows.map(C.isNewProduct),[true,false]);assert.deepEqual(rows.map(row=>row.data['新品']),['是','']);
});
test('Germany: DE/德国 aliases work in both directions without matching store names or other sites',()=>{
  for(const value of ['DE','de',' De ','ＤＥ','德国']){assert.equal(C.normalizeSite(value),'德国');assert.ok(C.sameSite(value,'德国'));assert.ok(C.sameSite('DE',value));}
  assert.equal(C.sameSite('DE','英国'),false);assert.equal(C.sameSite('DE','美国'),false);
  assert.ok(C.siteInText('产品「万万欣DE」DE','德国'));assert.ok(C.siteInText('产品「万万欣DE」德国','de'));
  assert.equal(C.siteInText('产品「万万欣DE」美国','DE'),false);assert.equal(C.siteInText('DEMO「Shop」英国','DE'),false);
});
test('Germany: both supplied XLS rows have translated titles and normalize DE to Germany',()=>{
  const book=X.read(fs.readFileSync('移德国.xls')),parsed=C.parseWorkbook(book,X,{mergeSplit:true});
  assert.equal(parsed.rows.length,2);assert.ok(parsed.rows.every(row=>row.site==='德国'&&!row.error&&row.targetShop==='万万欣DE'));
  assert.deepEqual(parsed.rows.map(row=>C.planProductTitle(row).title),['4 Stück Edelstahl Gewürzschalen','3 Stück Aufbewahrungskorb']);
  const rows=X.utils.sheet_to_json(book.Sheets.Sheet1,{header:1,raw:false,defval:''});
  rows[1][2]='DE';rows[1][9]='not used';const changed=X.utils.book_new();X.utils.book_append_sheet(changed,X.utils.aoa_to_sheet(rows),'Sheet1');
  const result=C.parseWorkbook(changed,X).rows[0];assert.equal(result.site,'德国');assert.equal(result.error,'');assert.equal(result.targetQuantity,'');
});
test('Germany: translated title fully replaces collected title and ignores quantity; UK retains quantity rule',()=>{
  const record={site:'DE',title:'12 Pack Cups, 24 Pcs Brushes',data:{'德国标题翻译':'4 Stück Gewürzschalen','产品数量':'invalid'}};
  const plan=C.planProductTitle(record);assert.equal(plan.title,'4 Stück Gewürzschalen');assert.equal(plan.mode,'german_translation');assert.equal(plan.targetQuantity,'');
  record.site='UK';record.data['产品数量']='5';assert.equal(C.planProductTitle(record).title,'5 Pack Cups, 24 Pcs Brushes');
});
test('Germany: missing translation is a per-row data error, without clearing the product title',()=>{
  const book=X.utils.book_new();X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([
    ['链接','店铺','站点','德国标题翻译','产品数量'],['https://amazon.com/dp/B0TEST0001','Shop','DE','','invalid'],['https://amazon.com/dp/B0TEST0002','Shop','德国','3 Stück Korb','invalid']
  ]),'输入');
  const rows=C.parseWorkbook(book,X).rows;assert.equal(rows[0].status,'数据错误');assert.match(rows[0].error,/德国标题翻译.*不能为空/);assert.equal(rows[1].error,'');
});

