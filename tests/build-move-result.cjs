const fs=require('node:fs'),assert=require('node:assert/strict'),X=require('../extension/vendor/xlsx.full.min.js'),C=require('../extension/core.js');
const rows=C.parseWorkbook(X.read(fs.readFileSync('迁移数据.xls')),X,{mergeSplit:true}).rows;
for(const r of rows){r.status='本次未操作';r.step='本次回归未操作';r.history=[];}
const r=rows[2];assert.equal(r.source,'https://www.amazon.com/dp/B0FQBPY8G1');
Object.assign(r,{status:'已移入待发布（未发布）',step:'单条移动回归完成',title:'12 Pack Gingham Tablecloth, 54x108 in Plastic Tablecloth, Red White',collectorId:'184527809329324769',productId:'184807703384260069',targetUrl:'https://www.dianxiaomi.com/web/amazon/pageList/offline',history:[
  {time:'2026/10/23 15:46:56',message:'插件发现来源历史记录，跳过重复采集。'},
  {time:'2026/10/23 15:48:12',message:'人工仅重新认领此商品到[英国]万万欣DE，成功1条，失败0条。'},
  {time:'2026/10/23 15:52:49',message:'按用户确认，提交1个商品及联动ASIN分组行的批量移入。'},
  {time:'2026/10/23 15:52:55',message:'执行结果：成功1个，失败0；确认最终结果后才关闭弹窗并进入待发布。'},
  {time:'2026/10/23 15:53:00',message:'待发布核对同产品ID、来源、标题、英国店铺；没有继续填写或发布。'}
]});
const table=C.resultTable(rows),book=X.utils.book_new(),sheet=X.utils.aoa_to_sheet(table);
sheet['!cols']=[{wch:26},{wch:48},{wch:65},{wch:18},{wch:10},{wch:28},{wch:35},{wch:28},{wch:18},{wch:25},{wch:25},{wch:25},{wch:60},{wch:95}];
X.utils.book_append_sheet(book,sheet,'本次移动回归');
fs.writeFileSync('outputs/批量移入回归结果.xlsx',X.write(book,{type:'buffer',bookType:'xlsx'}));
fs.writeFileSync('outputs/批量移入回归结果.json',JSON.stringify(rows,null,2));
const verify=X.read(fs.readFileSync('outputs/批量移入回归结果.xlsx')).Sheets['本次移动回归'];
assert.equal(verify.K4.v,r.productId);assert.equal(verify.K4.t,'s');assert.equal(verify.J4.t,'s');assert.equal(rows.filter(r=>r.status==='本次未操作').length,9);
console.log('本次回归：1条移入待发布且未发布；9条本次未操作；长ID保持文本。');
