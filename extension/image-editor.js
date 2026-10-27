/* Small DOM-only driver for the public 小秘美图 iframe. */
(function(root){
  'use strict';
  let stopped=false,cropped=false,saving=false,running=false;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const all=(selector,scope=document)=>[...scope.querySelectorAll(selector)];
  const text=e=>(e?.textContent||'').replace(/\s+/g,'');
  function one(nodes,label){if(nodes.length!==1)throw new Error(`${label}：找到${nodes.length}个控件`);return nodes[0];}
  function click(e){if(stopped)throw new Error('已停止');if(!e||e.disabled||e.getAttribute('aria-disabled')==='true')throw new Error('图片控件不可点击');e.click();}
  async function until(fn,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(stopped)throw new Error('已停止');const value=fn();if(value)return value;await sleep(200);}throw new Error(`等待超时：${label}`);}
  function field(axis){return one(all('.crop_module .link_input .el-input').filter(e=>text(e.querySelector('.el-input__suffix-inner'))===axis).map(e=>e.querySelector('input')).filter(Boolean),`裁剪${axis}`);}
  function input(e,value){
    if(stopped)throw new Error('已停止');if(e.disabled||e.readOnly)throw new Error('裁剪尺寸不可填写');
    e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();
  }
  const commands={
    async ready(){
      const image=document.querySelector('img.selected');
      return {ready:!!document.querySelector('.crop_module .open')&&!!image&&image.complete&&image.naturalWidth>0};
    },
    async crop(){
      if(cropped)return {cropped:true};
      const skip=all('button').filter(e=>visible(e)&&text(e)==='跳过');if(skip.length)click(one(skip,'引导跳过'));
      const panel=()=>all('.crop_module .parameter').find(visible);
      if(!panel())click(one(all('.crop_module .open').filter(visible),'裁剪/旋转'));
      await until(panel,'裁剪面板');
      // W and H are found by their suffix, never by the editor's dynamic IDs.
      for(const axis of ['W','H']){input(field(axis),'400');await sleep(200);}
      await until(()=>field('W').value==='400'&&field('H').value==='400','确认裁剪尺寸400×400');
      click(one(all('.footer_btns button',panel()).filter(e=>visible(e)&&text(e)==='应用'),'应用裁剪'));
      await until(()=>!panel(),'裁剪应用完成');cropped=true;return {cropped:true};
    },
    async save(){
      if(!cropped)throw new Error('裁剪尚未应用，禁止保存');
      if(saving)throw new Error('图片已提交保存，禁止重复提交');
      const save=one(all('button.save').filter(visible),'图片保存菜单');click(save);
      const item=await until(()=>{const nodes=all('[role="menuitem"]').filter(e=>visible(e)&&text(e)==='保存并应用');return nodes.length?one(nodes,'保存并应用'):null;},'保存并应用菜单');
      saving=true;click(item);
      // Some editor versions expose a final floating Save button; current live
      // menu applies immediately and closes its tab. Never choose local/library.
      await sleep(200);
      const buttons=all('.save_box button').filter(e=>visible(e)&&text(e)==='保存');
      if(buttons.length)click(one(buttons,'保存并应用确认'));
      return {saving:true};
    },
    async stop(){stopped=true;return {};}
  };
  root.DXMImageEditor={commands};
  if(typeof chrome!=='undefined'&&chrome.runtime?.onMessage)chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(m.kind!=='DXM_IMAGE_ACTION')return;
    if(!commands[m.action]){reply({ok:false,error:'未知图片操作'});return;}
    if(running&&!['ready','stop'].includes(m.action)){reply({ok:false,error:'图片操作正在执行'});return;}
    const mutating=['crop','save'].includes(m.action);if(mutating)running=true;
    Promise.resolve().then(()=>commands[m.action]()).then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message})).finally(()=>{if(mutating)running=false;});return true;
  });
})(typeof globalThis==='object'?globalThis:this);
