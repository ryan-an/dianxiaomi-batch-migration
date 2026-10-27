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
  function imageEditorTab(tab){
    return [tab?.url,tab?.pendingUrl].some(value=>{try{const url=new URL(value);return url.origin==='https://www.dianxiaomi.com'&&url.pathname.replace(/\/$/,'')==='/web/newImageEditor';}catch{return false;}});
  }
  function imageEditorOpenError(tabs,beforeIds,productTabId){
    const before=new Set(beforeIds),fresh=tabs.filter(tab=>!before.has(tab.id)),editors=fresh.filter(imageEditorTab);
    if(editors.some(tab=>tab.openerTabId&&tab.openerTabId!==productTabId))return '小秘美图标签已打开，但来源标签与当前商品不匹配，未接管；请核对是否由当前商品打开';
    if(!fresh.length)return '点击小秘美图后未检测到新标签：可能被浏览器拦截弹窗，或页面未响应点击；请检查地址栏弹窗拦截提示，并手动点击小秘美图验证';
    const paths=[...new Set(fresh.map(tab=>{try{const url=new URL(tab.url||tab.pendingUrl);return url.origin==='https://www.dianxiaomi.com'?url.pathname:'其他站点或空白页';}catch{return '地址不可读取';}}))].slice(0,3);
    return `检测到${fresh.length}个新标签，但未找到可接管的小秘美图（${paths.join('、')}）；请核对新页面地址或是否在其他浏览器中打开`;
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
  const api={allowedTab,chooseTab,resolve,samePage,imageEditorTab,imageEditorOpenError};root.DXMTarget=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
