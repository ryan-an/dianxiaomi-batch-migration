const test=require('node:test'),assert=require('node:assert/strict'),T=require('../extension/work-target.js');
const tab=(id,path='amazon/pageList/draft',extra={})=>({id,url:'https://www.dianxiaomi.com/web/'+path,...extra});
test('自动匹配当前窗口的店小秘页面，排除扩展页和伪造域名',()=>{
  const tabs=[tab(1),tab(2,'productCrawl/dataAcquisition',{lastAccessed:100}),{id:3,url:'chrome-extension://local/popup.html'},{id:4,url:'https://www.dianxiaomi.com.example.org/web/amazon/'}];
  assert.equal(T.chooseTab(tabs,[tab(1)]).id,1);assert.equal(T.chooseTab(tabs,[tabs[2]]).id,2);assert.equal(T.allowedTab(tabs[3]),false);
});
test('其他窗口最近使用的店小秘页面可自动接管',async()=>{
  const tabs=[tab(1,'amazon/pageList/draft',{lastAccessed:9}),tab(2,'amazon/pageList/offline',{lastAccessed:20})],api={tabs:{query:async filter=>filter.url?tabs:[]}};
  assert.equal((await T.resolve(api)).id,2);
});
test('没有店小秘页面时给出可直接处理的提示',async()=>{
  await assert.rejects(T.resolve({tabs:{query:async()=>[]}}),/打开并登录店小秘/);
});
test('网页面板优先绑定发送消息的标签，不抢占其他窗口',async()=>{
  const source=tab(8),api={tabs:{get:async id=>{assert.equal(id,8);return source;},query:async()=>{throw new Error('不应该查询其他标签');}}};assert.equal((await T.resolve(api,source)).id,8);
});
test('编辑页面就绪必须匹配18位产品ID，不能只比较路径或转为Number',()=>{
  const a='https://www.dianxiaomi.com/web/amazon/edit?id=184807703384602947',b='https://www.dianxiaomi.com/web/amazon/edit?id=184807703384602948';
  assert.equal(T.samePage(a,b),false);assert.equal(T.samePage(a,a),true);assert.equal(T.samePage(a,a.replace(/\?id=.*/,'')),false);
  assert.equal(T.samePage(a.replace('www.dianxiaomi.com','example.com'),a),false);
});
test('页面匹配保留目标查询参数，允许不影响产品身份的额外参数及锚点',()=>{
  const url='https://www.dianxiaomi.com/web/amazon/edit?id=184807703384602947';
  assert.equal(T.samePage(url+'&from=offline#priceInfo',url),true);assert.equal(T.samePage(url,url+'&mode=edit'),false);
  assert.equal(T.samePage('https://www.dianxiaomi.com/web/amazon/pageList/draft','https://www.dianxiaomi.com/web/amazon/pageList/offline'),false);
});
