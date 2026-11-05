const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const allowed=new Set(['tests/retry-fixture.html','tests/retry-fixture.js','docs/evidence/retry-menu.html','extension/core.js','extension/batch-state.js','extension/ui-model.js','extension/adapter.js','extension/workflow.js']);
http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname,name=pathname==='/web/productCrawl/dataAcquisition'?'tests/retry-fixture.html':pathname.slice(1);
  if(!allowed.has(name)){response.writeHead(404).end();return;}
  response.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(fs.readFileSync(path.join(root,name)));
}).listen(0,'127.0.0.1',function(){console.log('http://127.0.0.1:'+this.address().port+'/web/productCrawl/dataAcquisition');});
