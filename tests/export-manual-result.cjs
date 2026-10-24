const fs=require('node:fs'),X=require('../extension/vendor/xlsx.full.min.js'),C=require('../extension/core.js');
const rows=C.parseWorkbook(X.read(fs.readFileSync('迁移数据.xls')),X,{mergeSplit:true}).rows;
for(const r of rows){r.status='未执行';r.step='保留用于插件测试';r.history=[{time:'2026-10-23',message:'按用户要求，仅手动实测第1条，其余保持未操作'}];}
Object.assign(rows[0],{title:'10 PCS Gold S Hooks, Brass S Hooks for Hanging, 3.54 Inch',collectorId:'184527809328870833',productId:'184807703383437685',status:'已上线',step:'在线列表确认',publishedAt:'2026-10-23 11:15:10（北京时间，列表更新时间）',targetUrl:'https://www.amazon.co.uk/dp/B0HNZQLFMP',history:[
  {time:'2026-10-23',message:'采集成功1条；对应原链接和采集标题'},
  {time:'2026-10-23',message:'认领到[英国]万万欣DE，成功1条失败0条'},
  {time:'2026-10-23',message:'批量移入待发布，成功1个失败0个'},
  {time:'2026-10-23',message:'按原表填写；型号名称按用户确认沿用/01；先清空数量再选FBA'},
  {time:'2026-10-23',message:'原产地中国、无电池、危险规管仅不适用；清除无日期的采集促销价'},
  {time:'2026-10-23',message:'店小秘确认产品已提交发布；在线列表同产品ID确认，新ASIN B0HNZQLFMP，23.99 GBP，FBA，库存--'}
]});
fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/单条实测结果.csv',C.csv(rows));fs.writeFileSync('outputs/单条实测结果.json',JSON.stringify(rows,null,2));
