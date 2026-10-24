(function(root){
  'use strict';
  function allowedTab(tab){try{const u=new URL(tab?.url);return Number.isInteger(tab.id)&&u.origin==='https://www.dianxiaomi.com'&&/^\/web\/(amazon\/|productCrawl\/)/.test(u.pathname);}catch{return false;}}
  function samePage(actual,expected){
    try{
      const a=new URL(actual),b=new URL(expected);
      if(a.origin!==b.origin||a.pathname!==b.pathname)return false;
      if(/\/edit$/.test(b.pathname)&&!b.searchParams.get('id'))return false;
      for(const key of new Set(b.searchParams.keys()))if(JSON.stringify(a.searchParams.getAll(key))!==JSON.stringify(b.searchParams.getAll(key)))return false;
      return true;
    }catch{return false;}
  }
  function chooseTab(tabs,active=[]){
    const candidates=tabs.filter(allowedTab),current=active.find(allowedTab);
    if(current&&candidates.some(t=>t.id===current.id))return candidates.find(t=>t.id===current.id);
    return candidates.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0)||Number(!!b.active)-Number(!!a.active)||a.id-b.id)[0]||null;
  }
  async function resolve(api,senderTab){
    if(allowedTab(senderTab)){
      const current=await api.tabs.get(senderTab.id);
      if(!allowedTab(current))throw new Error('当前店小秘页面已关闭或跳转，请重新打开页面。');
      return current;
    }
    const tabs=await api.tabs.query({url:['https://www.dianxiaomi.com/web/*']});
    const active=await api.tabs.query({active:true,lastFocusedWindow:true});
    const tab=chooseTab(tabs,active);if(!tab)throw new Error('请先在这个浏览器中打开并登录店小秘，再点击开始执行。');return tab;
  }
  const api={allowedTab,chooseTab,resolve,samePage};root.DXMTarget=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
