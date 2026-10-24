const fs=require('node:fs'),X=require('../extension/vendor/xlsx.full.min.js'),C=require('../extension/core.js');
require('./build-panel.cjs');
for(const name of ['fixture.html','move-fixture.html']){
  const file='tests/'+name;let source=fs.readFileSync(file,'utf8');
  for(const dependency of ['work-target.js','batch-state.js'])if(!source.includes('/extension/'+dependency))source=source.replace('<script src="/extension/adapter.js">',`<script src="/extension/${dependency}"></script><script src="/extension/adapter.js">`);
  fs.writeFileSync(file,source);
}
const r=C.parseWorkbook(X.read(fs.readFileSync('迁移数据.xls')),X,{mergeSplit:true}).rows[0];r.title='10 PCS Gold S Hooks, Brass S Hooks for Hanging, 3.54 Inch';
fs.writeFileSync('tests/fixture-data.json',JSON.stringify(r));
const items=JSON.parse(fs.readFileSync('docs/evidence/editor-required-items.json','utf8'));
fs.writeFileSync('docs/evidence/editor-form.html','<!-- Verified required fields, captured separately to avoid truncation. -->\n<form>'+items.map(x=>x.html).join('\n')+'</form>');
const html=fs.readFileSync('extension/popup.html','utf8').replace('href="popup.css"','href="/extension/popup.css"').replace(/src="/g,'src="/extension/').replace('<script src="/extension/vendor','<script src="/tests/mock-chrome.js"></script><script src="/extension/vendor');
fs.writeFileSync('tests/popup-preview.html',html.replace(/src="([^"?]+\.js)"/g,(_,url)=>`src="${url}?v=${Math.trunc(fs.statSync('.'+url).mtimeMs)}"`));
const page=fs.readFileSync('tests/in-page.html','utf8').replace(/src="([^"?]+\.js)(?:\?[^"\s]*)?"/g,(_,url)=>`src="${url}?v=${Math.trunc(fs.statSync('.'+url).mtimeMs)}"`);fs.writeFileSync('tests/in-page.html',page);
