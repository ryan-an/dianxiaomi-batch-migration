/* Page-world bridge for the public CKEditor API; no private framework state. */
(function(root){
  'use strict';
  if(root.__DXMEditorBridgeInstalled)return;root.__DXMEditorBridgeInstalled=true;
  const REQUEST='DXM_EDITOR_REQUEST',RESPONSE='DXM_EDITOR_RESPONSE';
  const plain=html=>{const template=document.createElement('template');template.innerHTML=html;return template.content.textContent.replace(/\u00a0/g,' ').trim();};
  function editorFor(request){
    if(location.pathname!=='/web/amazon/edit')throw new Error('产品描述只能在产品编辑页修改');
    if(request.productId&&new URL(location.href).searchParams.get('id')!==request.productId)throw new Error('产品描述的产品ID不匹配');
    if(document.querySelector('input[name="sourceUrl"]')?.value!==request.source)throw new Error('产品描述的来源链接不匹配');
    const field=document.getElementById(request.elementId);
    if(!field||field.tagName!=='TEXTAREA'||!field.closest('[data-path="product_description.0.value"]'))throw new Error('没有找到对应产品描述字段');
    const editor=root.CKEDITOR?.instances?.[field.id];
    if(!editor||editor.status!=='ready')throw new Error('产品描述编辑器尚未就绪');
    return {field,editor};
  }
  document.addEventListener(REQUEST,event=>{
    let request;
    try{if(typeof event.detail!=='string'||event.detail.length>100000)return;request=JSON.parse(event.detail);if(!request.id||!['read','set'].includes(request.action))return;}catch{return;}
    const reply=result=>document.dispatchEvent(new CustomEvent(RESPONSE,{detail:JSON.stringify({id:request.id,...result})}));
    (async()=>{
      let {field,editor}=editorFor(request);
      if(request.action==='set'){
        if(typeof request.html!=='string'||request.html.length>20000)throw new Error('产品描述内容无效');
        if(editor.readOnly||field.disabled||field.readOnly)throw new Error('产品描述不可编辑');
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('产品描述编辑器写入超时')),8000);
          try{editor.setData(request.html,function(){clearTimeout(timer);resolve();});}catch(error){clearTimeout(timer);reject(error);}
        });
        editor.updateElement();editor.fire('change');
        field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
        ({field,editor}=editorFor(request));editor.updateElement();
      }
      return {text:plain(editor.getData()),fieldText:plain(field.value)};
    })().then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message||String(error)}));
  });
})(globalThis);

