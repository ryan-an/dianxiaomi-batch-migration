const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../extension/core.js'),X=require('../extension/vendor/xlsx.full.min.js');
const workbook=rows=>{const book=X.utils.book_new();X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([
  ['美国链接','店铺','站点','德国标题翻译','产品数量','新品'],...rows
]),'输入');return book;};

test('美国与US双向等价，支持大小写、空格和全角，保留其他站点区分',()=>{
  for(const site of ['美国','US','us',' Us ','ＵＳ']){
    assert.equal(C.normalizeSite(site),'美国');assert.ok(C.sameSite(site,'美国'));assert.ok(C.sameSite('US',site));
    assert.ok(C.siteInText('商品「琛迅通US」美国',site));assert.ok(C.siteInText('商品「琛迅通US」US',site));
    assert.ok(C.usesTranslatedContent(site));
  }
  for(const site of ['DE','德国','UK','英国'])assert.equal(C.sameSite(site,'US'),false);
  for(const value of ['商品「琛迅通US」德国','USAGE「Shop」英国','Bonus「Shop」DE'])assert.equal(C.siteInText(value,'US'),false);
  assert.equal(C.shopForSite('琛迅通US','US'),'琛迅通US');
});

test('美国所有商品均处理图片，其他站点继续仅处理新品',()=>{
  for(const site of ['US','美国',' us ','ＵＳ'])for(const value of ['是','否','',undefined]){
    const record={site,data:{'新品':value}};
    assert.equal(C.shouldProcessImages(record),true);assert.equal(C.isNewProduct(record),value==='是');
  }
  assert.ok(C.shouldProcessImages({site:'US'}));
  for(const site of ['DE','德国','UK','英国','法国','']){
    assert.ok(C.shouldProcessImages({site,data:{'新品':'是'}}));
    for(const value of ['否','',undefined])assert.equal(C.shouldProcessImages({site,data:{'新品':value}}),false);
  }
  assert.equal(C.shouldProcessImages(),false);
});

test('美国表格合并站点别名，使用德国标题翻译，忽略产品数量且保留原始数据',()=>{
  const rows=C.parseWorkbook(workbook([
    ['https://amazon.com/dp/B0D676FPDV','琛迅通US','美国','2 Pcs Mommy and Me Bonnet Set, Coffee','invalid','是'],
    ['https://amazon.com/dp/B0D5CZB7W8','琛迅通US','US','2 PCS Mommy Baby Bonnet Set, Pink','0','否']
  ]),X);
  assert.deepEqual(rows.groups,['琛迅通US|美国']);assert.equal(rows.rows.length,2);
  for(const row of rows.rows){assert.equal(row.error,'');assert.equal(row.targetQuantity,'');assert.equal(row.site,'美国');assert.equal(row.targetShop,'琛迅通US');assert.ok(C.shouldProcessImages(row));}
  assert.equal(rows.rows[1].data['站点'],'US');
  const record={...rows.rows[0],title:'12 Pack Original Product'};
  assert.deepEqual(C.planProductTitle(record),{mode:'german_translation',title:'2 Pcs Mommy and Me Bonnet Set, Coffee',changed:true,status:'translated',originalQuantity:12,targetQuantity:''});
});

test('美国翻译留空时逐行报错，不能回退到原标题或其他标题列',()=>{
  const parsed=C.parseWorkbook(workbook([
    ['https://amazon.com/dp/B0D676FPDV','琛迅通US','US','','2',''],
    ['https://amazon.com/dp/B0D5CZB7W8','琛迅通US','美国','Valid title','invalid','否']
  ]),X);
  assert.equal(parsed.rows[0].status,'数据错误');assert.match(parsed.rows[0].error,/美国站.*德国标题翻译.*不能为空/);
  assert.equal(parsed.rows[1].status,'待执行');assert.equal(parsed.rows[1].error,'');
  assert.throws(()=>C.planProductTitle({site:'US',title:'Old title',data:{'美国标题翻译':'Other title'}}),/德国标题翻译/);
});
