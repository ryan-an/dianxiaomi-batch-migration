const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {extractProductQuantity:quantity}=require('../extension/core.js');

test('quantity: supported units, capitalization, spacing and hyphens',()=>{
  for(const [title,expected] of [
    ['4 Pcs Kitchen Towel Holder',4],['9PCS Knife Set',9],['4Pack Aprons',4],
    ['30-Pack Plant Labels',30],['24 Piece Dinner Forks',24],['4 Pieces Timers',4],
    ['2 Pc Boards',2],['5 Packs Boxes',5],['Set of 12 Paint Sets',12],
    ['SET OF 6 Cups',6],['３ＰＣＳ Cups',3],['30–Pack Labels',30]
  ]) assert.equal(quantity(title),expected,title);
});

test('quantity: earliest supported expression wins across all rule types',()=>{
  for(const [title,expected] of [
    ['13 Pieces Clay Tools and 4 Pieces Dotting Tools',13],
    ['Set of 12 Paint Sets, 24 Pcs Paintbrushes',12],
    ['16 Pcs Tablecloth Set | 8 Pcs Tablecloths, 8 Pcs Runners',16],
    ['6 Pack Cups, Set of 12 Brushes',6],
    ['1 Piece Cup, Set of 4 Brushes',1],
    ['2PCS Boards | 2PCS Boards',2],
    ['100 Hard Bristle Pipe Cleaners | 2Pcs Tools, Set of 5 Brushes',2]
  ]) assert.equal(quantity(title),expected,title);
});

test('quantity: scan parentheses and title end; ignore size and function numbers',()=>{
  for(const [title,expected] of [
    ['7 Inch Tongs (Blue, Green, Red, Purple, Black, 5 Pieces)',5],
    ['Compressed Wipes (200 Pack with 20 Carrying Cases)',200],
    ['2 in 1 Pumice Stone, 6 Pack Foot Scrubber',6],
    ['Sponge 4PCS(2 Yellow,2 Blue)',4],
    ['Brand | Accessories, 3 Pcs Clips',3],
    ['50 Pack Crayons, 8 Colors | 400 Count Bulk',50]
  ]) assert.equal(quantity(title),expected,title);
});

test('quantity: absent or unsupported quantities remain empty',()=>{
  for(const title of [undefined,null,'',100,'Garden Flag','15 Colors Eyeliner Set',
    '7-In-1 Drain Tool','100 Digital Board','Wipes, 100, Daily Use',
    '5 Rolls Tape','3 Bundles Flowers','3 Pairs Sleeves','14 Pads Notes',
    '3 Pockets Apron','2 Hanger Hooks','50 Packing Boxes','12 Packages','24 Packaged Items',
    'Asset of 12','0 Pack Cups','-2 Pcs Cups','1.5 Pcs Cups','5-10 Pcs Clips',
    '2 x 3 Pcs Clips','1,234 Pcs Clips','Set of 1.5','Set of 5-10',
    'Set of 2 x 3','ModelX12Pcs','9007199254740993 Pcs Clips']) {
    assert.equal(quantity(title),'',String(title));
  }
});

test('quantity: repeated calls do not retain regex position',()=>{
  assert.equal(quantity('4Pack Cups'),4);
  assert.equal(quantity('4Pack Cups'),4);
  assert.equal(quantity('Plain Cup'),'');
  assert.equal(quantity('Set of 12 Cups'),12);
});

test('quantity: all 115 supplied titles follow the first supported match rule',()=>{
  const corpus=JSON.parse(fs.readFileSync(path.join(__dirname,'../outputs/标题数量提取分析.json'),'utf8').replace(/^\uFEFF/,'')).titles;
  const expected=[
    4,'',4,50,9,2,6,12,100,'',
    '',200,36,'','','',60,12,40,2,
    24,50,45,4,'',50,'','',4,30,
    9,24,100,2,4,'','',13,8,9,
    '',12,'',16,30,2,10,100,'',12,
    8,12,6,24,50,6,50,6,8,600,
    12,24,'',100,50,200,50,2,12,6,
    6,4,16,30,8,10,2,12,'',50,
    6,2,'',50,24,60,12,36,50,50,
    50,2,100,100,100,6,48,14,50,5,
    12,8,16,100,50,100,4,'',10,60,
    12,9,'',3,60
  ];
  assert.equal(corpus.length,115);
  assert.equal(expected.length,115);
  for(let i=0;i<corpus.length;i++) assert.equal(quantity(corpus[i].title),expected[i],`title ${i+1}: ${corpus[i].title}`);
});


test('quantity replacement: change only the first matched digits and retain all other title text',()=>{
  const {updateProductTitleQuantity:update}=require('../extension/core.js');
  for(const [title,target,expected] of [
    ['Set of 12 Paint Sets, 24 Pcs Brushes',3,'Set of 3 Paint Sets, 24 Pcs Brushes'],
    ['13 Pieces Tools and 4 Pieces Brushes',8,'8 Pieces Tools and 4 Pieces Brushes'],
    ['Extrapins 30-Pack Labels (Silver)',12,'Extrapins 12-Pack Labels (Silver)'],
    ['7 Inch Tongs (5 Pieces)',2,'7 Inch Tongs (2 Pieces)'],
    ['6 PCS Cups | 6 PCS Cups',10,'10 PCS Cups | 6 PCS Cups'],
    ['😀 Café ４ＰＣＳ Cups, 2 Colors',12,'😀 Café 12ＰＣＳ Cups, 2 Colors'],
    ['ﬃ 𝟒Pcs Cups, 3.5 Inch',6,'ﬃ 6Pcs Cups, 3.5 Inch']
  ]){
    const result=update(title,target);
    assert.equal(result.title,expected);assert.equal(result.targetQuantity,target);assert.equal(result.changed,true);
  }
});

test('quantity replacement: blank input, no match and unchanged quantity retain the title',()=>{
  const {updateProductTitleQuantity:update}=require('../extension/core.js');
  assert.deepEqual(update('4 Pcs Cups',''),{title:'4 Pcs Cups',originalQuantity:4,targetQuantity:'',changed:false,status:'missing_target'});
  assert.equal(update('Garden Flag',5).title,'Garden Flag');assert.equal(update('Garden Flag',5).status,'no_match');
  assert.equal(update('4 Pcs Cups',4).status,'unchanged');
});

test('spreadsheet product quantity: validate positive integers separately from inventory',()=>{
  const C=require('../extension/core.js'),X=require('../extension/vendor/xlsx.full.min.js');
  for(const [input,expected] of [['', ''],[undefined,''],['１２',12],['12.00',12],['02',2],[4,4]])assert.equal(C.parseTargetProductQuantity(input),expected);
  for(const input of [0,'-1','1.5','3 Pack','1e2','NaN','9007199254740993'])assert.throws(()=>C.parseTargetProductQuantity(input),/正整数/);
  const book=X.utils.book_new();X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([
    ['链接','店铺','站点','产品数量'],['https://amazon.com/dp/B0TEST0001','Shop','UK','0'],['https://amazon.com/dp/B0TEST0002','Shop','UK','8']
  ]),'输入');
  const rows=C.parseWorkbook(book,X).rows;
  assert.equal(rows[0].status,'数据错误');assert.match(rows[0].error,/产品数量/);assert.equal(rows[1].targetQuantity,8);
});

test('download results: exactly eight columns, actual final title and numeric quantities survive XLSX export',()=>{
  const C=require('../extension/core.js'),X=require('../extension/vendor/xlsx.full.min.js');
  const table=C.resultTable([{status:'已发布',source:'https://amazon.com/dp/B0TEST0001',collectedTitle:'12 Pack Cups, 8 Colors',title:'3 Pack Cups, 8 Colors',data:{'产品数量':'3'},targetShop:'Shop',site:'英国',error:'',productId:'184807703383437685',history:[{message:'internal'}]}]);
  assert.deepEqual(table[0],['执行状态','原表链接','最终标题','原标题数量','表格产品数量','实际店铺','站点','失败原因']);
  assert.deepEqual(table[1],['已发布','https://amazon.com/dp/B0TEST0001','3 Pack Cups, 8 Colors',12,3,'Shop','英国','']);
  const book=X.utils.book_new();X.utils.book_append_sheet(book,X.utils.aoa_to_sheet(table),'迁移结果');
  const sheet=X.read(X.write(book,{type:'buffer',bookType:'xlsx'})).Sheets['迁移结果'];
  assert.equal(sheet.C2.v,'3 Pack Cups, 8 Colors');assert.equal(sheet.D2.t,'n');assert.equal(sheet.D2.v,12);assert.equal(sheet.E2.v,3);assert.equal(sheet['!ref'],'A1:H2');
  assert.equal(C.resultColumns.length,8);
  assert.doesNotThrow(()=>C.resultTable([{status:'数据错误',data:{'产品数量':'invalid'}}]));
});
