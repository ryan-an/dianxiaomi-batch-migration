/* DOM-only adapter. No private APIs, framework internals or credentials. */
(function(root){
  'use strict';
  const C=root.DXMCore;
  let stopped=false;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const visible=e=>!!e && !!(e.getClientRects().length) && getComputedStyle(e).visibility!=='hidden';
  const all=(s,scope=document)=>[...scope.querySelectorAll(s)];
  const shown=(s,scope=document)=>all(s,scope).filter(visible);
  const clean=v=>C.text(v).replace(/\s+/g,'');
  function exact(value,selector='button,a,span,div',scope=document){
    return shown(selector,scope).filter(e=>clean(e.textContent)===clean(value));
  }
  function one(es,label){if(es.length!==1)throw new Error(`${label}：找到 ${es.length} 个控件，请核对页面`);return es[0];}
  function click(e){if(stopped)throw new Error('已停止');if(!e||e.disabled)throw new Error('控件不可点击');e.scrollIntoView({block:'center'});e.click();}
  function button(name,scope=document){return one(exact(name,'button',scope),name);}
  function input(e,value){
    if(!e)throw new Error('未找到输入框');
    if(stopped)throw new Error('已停止');
    if(e.disabled)throw new Error('输入框被禁用');
    const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(e,C.text(value));
    e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new FocusEvent('blur',{bubbles:true}));
  }
  function checked(e,want){if(!e||e.disabled)throw new Error('勾选框不可用');if(e.checked!==want)click(e);}
  async function until(fn,label,timeout=20000){
    const end=Date.now()+timeout;
    while(Date.now()<end){if(stopped)throw new Error('已停止');const value=fn();if(value)return value;await sleep(200);}
    throw new Error(`等待超时：${label}`);
  }
  function modal(){return shown('.ant-modal').at(-1);}
  function itemLabel(e){return clean(e.querySelector('.ant-form-item-label')?.textContent).replace(/[＊*：:]/g,'');}
  function formItem(label){return one(all('.ant-form-item').filter(e=>itemLabel(e)===clean(label)),label);}
  async function select(e,wanted,unit=false){
    const box=e?.closest('.ant-select');if(!box)throw new Error(`下拉控件结构变化：${wanted}`);
    const label=itemLabel(box.closest('.ant-form-item'))||'下拉框',same=v=>unit?C.unitKey(v)===C.unitKey(wanted):clean(v)===clean(wanted);
    const selected=()=>box.querySelector('.ant-select-selection-item')?.textContent;
    if(same(selected()))return;
    const controls=e.getAttribute('aria-controls')||e.getAttribute('aria-owns');
    if(e.getAttribute('aria-expanded')!=='true'){
      const target=box.querySelector('.ant-select-selector')||e;target.scrollIntoView({block:'center'});
      for(const type of ['mousedown','mouseup'])target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0,view:window}));
      click(target);
    }
    const dropdown=await until(()=>{
      if(controls){const portal=id(controls)?.closest('.ant-select-dropdown');return visible(portal)?portal:null;}
      const found=shown('.ant-select-dropdown');return found.length===1?found[0]:null;
    },`展开【${label}】选择 ${wanted}`);
    const option=await until(()=>{
      const matches=shown('.ant-select-item-option',dropdown).filter(o=>same(o.querySelector('.ant-select-item-option-content')?.textContent||o.textContent));
      if(matches.length>1&&!unit)throw new Error(`【${label}】存在多个同名选项，请核对`);
      return matches[0];
    },`【${label}】的选项 ${wanted}`);
    click(option);await until(()=>same(selected()),`确认【${label}】已选中 ${wanted}`);
  }
  function id(value){return document.getElementById(value);}
  const productFields={
    '制造商':{ids:['form_item_manufacturer','form_item_manufacturer.0.value'],labels:['制造商','Manufacturer','Manufacturer(制造商)'],selectors:'input[placeholder="请输入制造商"],input[name="manufacturer"]'},
    'Model Number':{ids:['form_item_model_number.0.value'],labels:['Model Number','Model Number(型号)','型号'],selectors:'input[placeholder="请输入型号"]'},
    'Model Name':{ids:['form_item_model_name.0.value'],labels:['Model Name','Model Name(型号名称)','型号名称'],selectors:'input[placeholder="请输入型号名称"]'}
  };
  function productField(key){
    const spec=productFields[key],labelKey=value=>clean(C.norm(value));
    const items=all('.ant-form-item').filter(e=>spec.labels.some(label=>labelKey(itemLabel(e))===labelKey(label)));
    const candidates=[...new Set([...spec.ids.map(id).filter(Boolean),...all(spec.selectors),...items.flatMap(e=>all('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([role="combobox"]),textarea',e))])];
    const found=candidates.filter(visible),matches=found.length?found:candidates;
    if(matches.length)return one(matches,key);
    if(items.length)throw new Error(`${key}字段存在，但未找到可填写的文本框`);
    return null;
  }
  function brandItem(){return all('.ant-form-item').find(e=>['品牌','Brand','Brand(品牌)'].some(label=>clean(C.norm(itemLabel(e)))===clean(C.norm(label))));}
  function pageBrand(){const item=brandItem(),selected=item?.querySelector('.ant-select-selection-item');return C.text(selected?.getAttribute('title')||selected?.textContent)||C.text(item?.querySelector('.ant-select-auto-complete input,input:not([role="combobox"])')?.value);}
  async function ensureBrand(value){
    const item=brandItem();if(!item)return {absent:true};
    if(!C.text(value)||pageBrand()===C.text(value))return {value:pageBrand()};
    for(let attempt=0;attempt<3;attempt++){
      const field=brandItem()?.querySelector('input');if(!field)throw new Error('品牌字段存在，但未找到输入框');
      field.focus({preventScroll:true});input(field,value);
      if(field.getAttribute('role')==='combobox')for(const type of ['keydown','keyup'])field.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
      field.blur();await sleep(200);if(pageBrand()===C.text(value))return {value:C.text(value)};
    }
    throw new Error('品牌写入后未保留，无法保证制造商与品牌一致');
  }
  function productValues(record,modelName){
    const brand=C.text(record.data['品牌'])||pageBrand();
    return {'制造商':brand,'Model Number':C.text(record.data['Model Number']),'Model Name':C.text(record.data['Model Name'])||C.text(record.data['Model Number'])||C.text(modelName)};
  }
  function checkIdentity(record){
    if(record.productId&&!root.DXMTarget.samePage(location.href,`https://www.dianxiaomi.com/web/amazon/edit?id=${encodeURIComponent(record.productId)}`))throw new Error('编辑页产品ID不匹配，禁止写入');
    if(!sameSource(document.querySelector('input[name="sourceUrl"]')?.value,record.source))throw new Error('编辑页来源链接不匹配，禁止写入');
    if(C.norm(formItem('产品标题').querySelector('input')?.value)!==C.norm(record.title))throw new Error('编辑页标题不匹配，禁止写入');
    const shop=formItem('店铺账号').querySelector('.ant-select-selection-item')?.textContent,site=formItem('站点选择').querySelector('.ant-select-selection-item')?.textContent;
    if(clean(shop)!==clean(record.targetShop)||!C.sameSite(site,record.site))throw new Error('编辑页店铺或站点不匹配');
  }
  async function ensureProductField(key,value){
    if(!productField(key))return {absent:true};
    for(let attempt=0;attempt<3;attempt++){
      const field=productField(key);if(!field)throw new Error(`${key}字段在填写时消失`);
      const wanted=C.text(value)||C.text(field.value);
      if(!wanted)throw new Error(`${key}为空，${key==='制造商'?'品牌':'原表型号数据'}缺失，无法补填`);
      if(field.disabled||field.readOnly)throw new Error(`${key}输入框被禁用或只读`);
      if(C.text(field.value)!==wanted){field.focus({preventScroll:true});input(field,wanted);field.blur();}
      await sleep(200);
      if(C.text(productField(key)?.value)===wanted)return {value:wanted};
    }
    throw new Error(`${key}写入后未保留`);
  }
  async function ensureTitleQuantity(record){
    const update=C.planProductTitle(record);
    if(!update.changed)return update;
    for(let attempt=0;attempt<3;attempt++){
      const field=formItem('产品标题').querySelector('input,textarea');
      if(!field||field.disabled||field.readOnly)throw new Error('产品标题输入框不可编辑');
      if(field.value!==update.title)input(field,update.title);
      await sleep(200);
      if(formItem('产品标题').querySelector('input,textarea')?.value===update.title)return update;
    }
    throw new Error('产品标题数量写入后未保留');
  }
  function editorRequest(record,field,action,html){
    if(stopped)return Promise.reject(new Error('已停止'));
    const source=document.querySelector('input[name="sourceUrl"]')?.value;
    if(!sameSource(source,record.source))return Promise.reject(new Error('产品描述的来源链接不匹配'));
    return new Promise((resolve,reject)=>{
      const requestId=root.crypto?.randomUUID?.()||Date.now()+'-'+Math.random();
      const finish=(error,data)=>{clearTimeout(timer);document.removeEventListener('DXM_EDITOR_RESPONSE',receive);error?reject(error):resolve(data);};
      const receive=event=>{let response;try{response=JSON.parse(event.detail);}catch{return;}if(response.id===requestId)finish(response.ok?null:new Error(response.error),response.data);};
      const timer=setTimeout(()=>finish(new Error('产品描述编辑器连接超时，请重新加载扩展并刷新页面')),10000);
      document.addEventListener('DXM_EDITOR_RESPONSE',receive);
      document.dispatchEvent(new CustomEvent('DXM_EDITOR_REQUEST',{detail:JSON.stringify({id:requestId,action,elementId:field.id,html,productId:record.productId||'',source})}));
    });
  }
  function descriptionField(){
    const row=document.querySelector('[data-path="product_description.0.value"]');
    if(!row)return null;
    return one(all('textarea[id^="ckeditor"]',row),'产品描述编辑器');
  }
  async function ensureGermanDescription(record){
    const title=C.planProductTitle(record).title;
    if(!descriptionField())return {absent:true};
    const html='<p>'+title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</p>';
    let changed=false,lastError;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const field=descriptionField();if(!field)throw new Error('产品描述字段在填写时消失');
        const before=await editorRequest(record,field,'read');
        if(before.text!==title||before.fieldText!==title){await editorRequest(record,field,'set',html);changed=true;}
        await sleep(200);
        const actual=await editorRequest(record,descriptionField(),'read');
        if(actual.text===title&&actual.fieldText===title)return {changed};
        lastError=new Error('产品描述写入后未保留');
      }catch(error){lastError=error;if(stopped)throw error;}
      await sleep(200);
    }
    throw lastError;
  }
  function bulletFields(){return all('textarea[id^="form_item_bulletPoints_"]').sort((a,b)=>Number(a.id.match(/_(\d+)$/)?.[1])-Number(b.id.match(/_(\d+)$/)?.[1]));}
  async function ensureGermanBullets(record){
    const title=C.planProductTitle(record).title;
    if(!bulletFields().length)return {absent:true};
    let changed=false;
    for(let attempt=0;attempt<3;attempt++){
      const ids=bulletFields().map(field=>field.id);
      for(let i=0;i<ids.length;i++){
        const field=id(ids[i]),value=i===0?title:'';
        if(!field)break;
        if(field.value!==value){if(field.readOnly)throw new Error('Bullet Point输入框只读');input(field,value);changed=true;}
      }
      await sleep(200);
      const fields=bulletFields();
      if(fields.length&&fields[0].value===title&&fields.slice(1).every(field=>field.value===''))return {changed,count:fields.length};
    }
    throw new Error('Bullet Point写入或清空后未保留');
  }
  function requiredFieldErrors(){
    const errors=[];
    for(const item of shown('.ant-form-item')){
      if(!item.querySelector('.ant-form-item-required,input[required],textarea[required],select[required],[aria-required="true"]'))continue;
      const label=C.text(item.querySelector('.ant-form-item-label')?.textContent)||'必填字段';
      const selects=shown('.ant-select',item).filter(e=>!e.classList.contains('ant-select-disabled'));
      if(selects.some(e=>e.classList.contains('ant-select-auto-complete')?!C.text(e.querySelector('input')?.value):!e.querySelector('.ant-select-selection-item')))errors.push(`${label}未选择`);
      const inputs=shown('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea,select',item).filter(e=>!e.disabled&&!e.closest('.ant-select'));
      if(inputs.some(e=>!C.text(e.value)))errors.push(`${label}未填写`);
      const checks=shown('input[type="checkbox"],input[type="radio"]',item).filter(e=>!e.disabled);
      if(checks.length&&!checks.some(e=>e.checked))errors.push(`${label}未选择`);
    }
    return [...new Set([...errors,...shown('.ant-form-item-explain-error').map(e=>C.text(e.textContent)).filter(Boolean)])];
  }
  function sameSource(a,b){try{return C.sourceKey(a)===C.sourceKey(b);}catch{return false;}}
  function rows(){
    const map=new Map();
    for(const row of all('.vxe-table--main-wrapper tr.vxe-body--row')){
      const links=all('a[href]',row),edit=links.find(a=>/\/web\/(productCrawl|amazon)\/edit\?id=/.test(a.getAttribute('href')));
      const src=links.find(a=>{try{const u=new URL(a.href);return /^https?:$/.test(u.protocol)&&u.hostname!=='www.dianxiaomi.com'&&!/\/dp\/(null|undefined)/.test(u.pathname);}catch{return false;}});
      const rowId=row.getAttribute('rowid');if(!src||!rowId)continue;
      // List grouping rows have ASIN links but no source cell / title; never process those.
      const titleEl=row.querySelector('.no-new-line4[title]')||all('[title]',row).find(e=>e.getAttribute('title')&&e.querySelector('span'));
      if(!titleEl&&!location.pathname.includes('productCrawl'))continue;
      let persistentId=edit?new URL(edit.getAttribute('href'),location.origin).searchParams.get('id'):location.pathname.includes('productCrawl')?`source:${C.sourceKey(src.href)}`:rowId;
      if(map.has(persistentId)){
        if(map.get(persistentId).rowId===rowId)continue;
        persistentId+=`|duplicate:${rowId}`;
      }
      map.set(persistentId,{id:persistentId,rowId,source:src.href,title:C.text(titleEl?.getAttribute('title')),text:row.innerText,editUrl:edit?new URL(edit.getAttribute('href'),location.origin).href:'',fba:!!row.querySelector('.amazonFBA'),links:links.map(a=>({text:C.text(a.textContent),href:a.href}))});
    }
    return [...map.values()];
  }
  const pagerButton=title=>shown(`button[title="${title}"]`)[0];
  const disabled=e=>!e||e.disabled||e.classList.contains('is--disabled');
  function signature(){return rows().map(r=>r.id).join(',')+'|'+shown('.vxe-pager--jump-number')[0]?.value;}
  async function settled(){
    await until(()=>!shown('.vxe-loading.is--visible,.ant-spin-spinning,#dPageLoading').length,'列表加载');
    await sleep(300);
  }
  async function selectRows(ids){
    const current=rows();
    ids.forEach(value=>one(current.filter(r=>r.id===value),`本页产品 ${value}`));
    // Clear previous selection in all rendered copies, then select only requested rows.
    const heads=shown('.vxe-header--row input[type="checkbox"]');
    if(heads[0]?.checked){checked(heads[0],false);await sleep(100);}
    for(const check of shown('.vxe-body--row input[type="checkbox"]'))if(check.checked){checked(check,false);await sleep(30);}
    for(const value of ids){
      const r=current.find(x=>x.id===value);
      const checks=shown(`tr[rowid="${CSS.escape(r.rowId)}"] input[type="checkbox"]`);
      const fixed=checks.find(e=>e.closest('.vxe-table--fixed-left-wrapper'));
      checked(fixed||checks[0],true);await sleep(30);
    }
    for(const row of rows()){
      const check=shown(`tr[rowid="${CSS.escape(row.rowId)}"] input[type="checkbox"]`)[0];
      if(check?.checked!==ids.includes(row.id))throw new Error('勾选结果与本批次不一致，已阻止批量操作');
    }
  }
  async function closeProgress(){const m=modal();if(m){const b=exact('关闭','button',m);if(b.length===1)click(b[0]);await sleep(250);}}
  async function batchMenu(name){
    const trigger=one(shown('button').filter(e=>clean(e.textContent).startsWith('批量操作')),'批量操作');
    click(trigger);
    // This menu also listens for hover. HTMLElement.click() alone can leave it hidden.
    for(const target of [trigger,trigger.parentElement]){
      target.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,view:window}));
      target.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false,view:window}));
    }
    const item=await until(()=>oneOrNull(exact(name,'.ant-dropdown .menu-item,[role="menuitem"],li')),
      `展开批量菜单中的“${name}”（尚未提交）`);
    click(item);
  }
  function oneOrNull(es){if(es.length>1)throw new Error('批量菜单存在多个同名操作，请人工核对');return es[0];}
  function moveState(expected){
    if(!Number.isInteger(expected)||expected<1)throw new Error('移入产品数量无效');
    const m=modal();
    return root.DXMBatchState.move({
      title:C.text(m?.querySelector('.ant-modal-title')?.textContent),text:C.text(m?.innerText),
      state:C.text(m?.querySelector('#commonProgressBarStatus')?.textContent),
      loading:!!m&&shown('.ant-spin-spinning,.ant-progress-status-active',m).length>0
    },expected);
  }
  async function clearGuides(){
    for(const e of shown('.notice-list-modal__header-close'))click(e);
    for(const name of ['跳过','暂不考虑']){
      const es=exact(name,'div,span');
      for(const e of es)if(e.closest('[id*="guide"],[class*="guide"],[class*="Guide"]'))click(e);
    }
  }
  const commands={
    async preflight({record,modelName}={}){
      const checked=[],repaired=[],skipped=[];let field='核对当前产品';
      try{
        checkIdentity(record);await settled();
        field='品牌';await ensureBrand(record.data['品牌']);
        const values=productValues(record,modelName);
        for(const key of Object.keys(productFields)){
          field=key;const before=productField(key)?.value,result=await ensureProductField(key,values[key]);
          if(result.absent){skipped.push(key);continue;}
          checked.push(key);if(before!==result.value)repaired.push(key);
        }
        // Re-read all three after asynchronous form updates; never trust old nodes.
        await sleep(2000);
        for(const key of checked){field=key;const actual=C.text(productField(key)?.value);if(!actual||(values[key]&&actual!==values[key]))throw new Error(`${key}为空或与应填值不一致`);}
        field='制造商';if(brandItem()&&checked.includes('制造商')&&pageBrand()!==C.text(productField('制造商')?.value))throw new Error('制造商与页面品牌不一致');
        if(C.sameSite(record.site,'德国')){
          for(const [key,ensure] of [['产品描述（德国翻译）',ensureGermanDescription],['Bullet Point（德国翻译）',ensureGermanBullets]]){
            field=key;const result=await ensure(record);if(result.absent)skipped.push(key);else{checked.push(key);if(result.changed)repaired.push(key);}
          }
        }
        field='页面必填项';const errors=requiredFieldErrors();if(errors.length)throw new Error(errors.join('；'));
        return {checked,repaired,skipped};
      }catch(e){e.field=field;e.completedFields=checked;e.message=`提交前检查【${field}】失败：${e.message}`;throw e;}
    },
    async ensurePartNumber(){
      const field=id('form_item_part_number.0.value');
      if(!field)return {changed:false,absent:true};
      const item=field.closest('.ant-form-item');
      if(!item?.querySelector('.ant-form-item-required')&&field.getAttribute('aria-required')!=='true'&&!field.required)return {changed:false};
      input(field,'01');
      await until(()=>id('form_item_part_number.0.value')?.value==='01','确认零件编号已填写01');
      return {changed:true,value:'01'};
    },
    async ensureCondition(){
      const matches=all('.ant-form-item').filter(e=>itemLabel(e)==='物品状况');
      if(!matches.length)return {changed:false,absent:true};
      const item=one(matches,'物品状况'),combo=item.querySelector('[role="combobox"]');
      if(!item.querySelector('.ant-form-item-required')&&combo?.getAttribute('aria-required')!=='true')return {changed:false};
      await select(combo,'New(新的)');return {changed:true,value:'New(新的)'};
    },
    async ensureCategory(){
      const selected=()=>C.text(id('form_item_category')?.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent);
      if(!id('form_item_category'))return {changed:false,absent:true};
      if(selected())return {changed:false,category:selected()};
      click(button('自动识别产品类型'));
      const result=await until(()=>{
        if(selected())return {category:selected()};
        const m=shown('.ant-modal').find(e=>e.textContent.includes('Amazon推荐产品类型'));
        return m?.querySelector('input[type="radio"]')?{modal:m}:null;
      },'自动识别产品分类结果',45000);
      let recommendedPath='',recommendedType='';
      if(result.modal){
        const choices=all('input[type="radio"]',result.modal).filter(e=>!e.disabled);
        const choice=choices.find(e=>e.checked)||choices[0];
        if(!choice)throw new Error('平台未返回可选择的推荐分类');
        recommendedPath=C.text(choice.closest('label')?.textContent);
        recommendedType=/推荐产品类型[：:]\s*([A-Z_]+)/.exec(result.modal.innerText)?.[1]||'';
        checked(choice,true);click(button('确定',result.modal));
      }
      await until(()=>selected(),'分类已填入',45000);await settled();await sleep(800);
      return {changed:true,category:selected(),recommendedPath,recommendedType};
    },
    async ready({expectedUrl,record}={}){
      stopped=false;
      if(/login/i.test(location.pathname)||document.querySelector('input[type="password"]'))throw new Error('请先登录店小秘');
      await until(()=>{
        if(expectedUrl&&!root.DXMTarget.samePage(location.href,expectedUrl))return false;
        if(record){
          const title=all('.ant-form-item').find(e=>itemLabel(e)==='产品标题')?.querySelector('input')?.value;
          if(!sameSource(document.querySelector('input[name="sourceUrl"]')?.value,record.source)||C.norm(title)!==C.norm(record.title))return false;
        }
        if(record||location.pathname.includes('/amazon/edit'))return document.querySelector('input[name="sourceUrl"]')&&all('.ant-form-item').some(e=>itemLabel(e)==='产品标题'&&e.querySelector('input'));
        return document.querySelector('.vxe-table--main-wrapper')&&(document.querySelector('button[title="下一页"]')||document.body.innerText.includes('暂无数据'));
      },record?`目标产品 ${record.productId} 的编辑页和来源链接加载`:'页面表单或列表加载',30000);
      await clearGuides();await sleep(800);await settled();return {url:location.href,source:document.querySelector('input[name="sourceUrl"]')?.value};
    },
    async editProduct({record}){
      if(location.pathname!=='/web/amazon/pageList/offline')throw new Error('请先进入待发布列表');
      await settled();
      const item=one(rows().filter(r=>r.id===record.productId&&sameSource(r.source,record.source)&&C.norm(r.title)===C.norm(record.title)&&r.text.includes(`「${record.targetShop}」`)&&C.siteInText(r.text,record.site)),'待发布对应标题的产品');
      const row=one(all('.vxe-table--main-wrapper tr.vxe-body--row').filter(r=>r.getAttribute('rowid')===item.rowId),'对应产品行');
      const edit=one(exact('编辑','a',row),'该行编辑按钮');
      if(new URL(edit.href).searchParams.get('id')!==record.productId)throw new Error('编辑按钮产品ID不一致');
      // Preserve the site's new-tab edit behavior and keep the list available.
      click(edit);
      return {url:item.editUrl};
    },
    async snapshot(){await settled();return {rows:rows(),hasNext:!disabled(pagerButton('下一页')),signature:signature()};},
    async firstPage(){const b=pagerButton('首页');if(!disabled(b)){click(b);await sleep(500);await settled();}return {};},
    async nextPage(){const b=pagerButton('下一页'),before=signature();if(disabled(b))return {end:true};click(b);await until(()=>signature()!==before,'下一页');await settled();return {};},
    async acquisitionTab({name}){
      const tab=one(shown('[role="tab"]').filter(e=>C.text(e.textContent).startsWith(name)),`列表标签 ${name}`);
      click(tab);await until(()=>tab.getAttribute('aria-selected')==='true','标签切换');
      const search=id('c-searchValue');if(search?.value){input(search,'');click(button('搜索'));}
      await sleep(500);await settled();return {};
    },
    async collect({sources}){
      const area=one(shown('textarea').filter(e=>e.placeholder.startsWith('请填写产品详情页的链接地址')),'链接采集输入框');
      const scope=area.closest('.gatherBox')||area.parentElement.parentElement;
      const auto=all('label',scope).find(e=>clean(e.textContent)==='自动认领')?.querySelector('input');if(auto?.checked)checked(auto,false);
      const agreement=all('label',scope).find(e=>e.textContent.includes('软件服务及许可协议'))?.querySelector('input');
      if(!agreement?.checked)throw new Error('请先在页面确认采集协议；插件不会代为接受协议');
      input(area,sources.join('\n'));click(button('开始采集'));await until(()=>modal()?.textContent.includes('自动采集'),'采集进度弹窗');return {};
    },
    async progress(){
      const m=modal();if(!m)throw new Error('没有采集进度弹窗，请人工核对是否已提交，避免重复采集');
      const state=C.text(m.querySelector('#commonProgressBarStatus')?.textContent)||m.innerText;
      const detail=C.text(m.querySelector('#commonProgressBarDetail')?.textContent)||m.innerText;
      if(/采集完成|已完成|执行完成/.test(state)){
        const failed=/失败\s*[：:]?\s*(\d+)/.exec(detail);
        return {done:true,text:detail,...(failed?{failed:Number(failed[1])}:{})};
      }
      if(/异常|终止/.test(state))throw new Error(detail);
      return {done:false,text:detail};
    },
    async closeProgress(){await closeProgress();return {};},
    async retry({ids}){
      await selectRows(ids);await batchMenu('批量重试');
      await until(()=>modal(),'重试提示');
      const m=modal();if(!m.querySelector('#commonProgressBarStatus')){
        const yes=exact('确定','button',m);if(yes.length===1)click(yes[0]);else throw new Error('重试弹窗结构变化，请人工核对');
      }
      await until(()=>modal()?.querySelector('#commonProgressBarStatus'),'重试进度');return {};
    },
    async claim({ids,shop,site}){
      await selectRows(ids);click(button('批量认领'));
      const m=await until(()=>{const e=modal();return e?.textContent.includes('选择店铺-认领到采集箱')?e:null;},'认领店铺弹窗');
      await until(()=>all('.shop-div[name="amazon"] label',m).length,'店铺加载');
      const labels=all('.shop-div[name="amazon"] label',m),target=one(labels.filter(e=>{const parts=/^\[([^\]]+)\](.*)$/.exec(clean(e.textContent));return parts&&C.sameSite(parts[1],site)&&clean(parts[2])===clean(shop);}),`店铺 [${site}]${shop}`);
      for(const e of all('.shop-div input[type="checkbox"]',m))if(e.checked)checked(e,false);
      checked(target.querySelector('input'),true);click(button('确定',m));
      await until(()=>{const x=modal();return x?.textContent.includes('认领到采集箱')&&x.querySelector('#commonProgressBarStatus');},'认领进度');
      return {};
    },
    async move({ids,waitMode}){
      if(waitMode!=='poll')throw new Error('扩展文件版本不一致，请重新加载扩展并刷新页面后再执行');
      await selectRows(ids);await batchMenu('批量移入待发布');
      const m=await until(()=>modal(),'移入提示');if(!m.textContent.includes('移入待发布'))throw new Error('移入提示内容变化');click(button('确定',m));
      return {submitted:true};
    },
    async moveProgress({expected}){return moveState(expected);},
    async closeMoveProgress({expected}){
      const result=moveState(expected);
      if(!result.done||result.failed||result.success!==expected)throw new Error('移入结果尚未全部成功，保留当前弹窗');
      const m=one(shown('.ant-modal').filter(e=>e.querySelector('.ant-modal-title')?.textContent.includes('执行结果')),'移入最终结果');
      click(button('关闭',m));await until(()=>!visible(m),'关闭移入最终结果');return result;
    },
    async fill({record,modelName,runId,continueOnError=false}){
      let currentField='核对当前产品';const written=[],skipped=[],warnings=[];
      const warning=e=>{if(!continueOnError||stopped)throw e;warnings.push({field:currentField,message:e.message,completedFields:[...written]});return false;};
      const skip=key=>{if(!skipped.includes(key))skipped.push(key);return false;};
      const optionalItem=label=>{const found=all('.ant-form-item').filter(e=>itemLabel(e)===clean(label));return found.length?one(found,label):null;};
      const choose=async(key,element,value,unit=false)=>{currentField=key;if(!element)return skip(key);try{await select(element,value,unit);return true;}catch(e){return warning(e);}};
      const report=async field=>{
        currentField=field;
        if(runId&&typeof chrome!=='undefined'&&chrome.runtime?.sendMessage){
          const response=await chrome.runtime.sendMessage({kind:'DXM_FIELD_PROGRESS',runId,productId:record.productId,source:record.source,field});
          if(!response?.ok)throw new Error(response?.error||'字段日志未获后台确认，已停止填写');
        }
      };
      const attempt=async(field,fn)=>{await report(field);try{return await fn();}catch(e){return warning(e);}};
      try{
      checkIdentity(record);
      await attempt('产品分类（为空时自动识别）',async()=>{const category=await commands.ensureCategory();if(category.changed)written.push(`按平台推荐识别分类：${category.recommendedType?category.recommendedType+' / ':''}${category.recommendedPath||category.category}`);});
      const put=(key,element,value=record.data[key])=>{if(value!==undefined&&C.text(value)!==''){currentField=key;if(!element)return skip(key);try{input(element,value);written.push(key);return true;}catch(e){return warning(e);}}return false;};
      await attempt('展开更多属性',async()=>{const more=exact('更多属性','div,span').sort((a,b)=>a.children.length-b.children.length)[0];if(more){click(more);await sleep(200);}});
      const delivery=()=>optionalItem('配送渠道')?.querySelector('[role="combobox"]');
      await attempt('配送渠道（清空库存数量后选择FBA）',async()=>{
      if(delivery()){
        await select(delivery(),'FBM');await sleep(200);const quantity=document.querySelector('input[placeholder="请输入产品数量"]');
        if(quantity){input(quantity,'');written.push('库存数量清空');}else skip('库存数量');
        await select(delivery(),'FBA');written.push('配送渠道FBA');
      }else skip('配送渠道');});
      await report('Parent SKU、UPC、制造商和品牌');
      put('Parent SKU',document.querySelector('input[placeholder^="示例：华为P60"]'));put('UPC',document.querySelector('input[placeholder="必填项，Prodcut ID"]'));
      if(record.data['品牌'])await attempt('品牌',async()=>{const brand=await ensureBrand(record.data['品牌']);if(brand.absent)skip('品牌');else written.push('品牌');});
      const values=productValues(record,modelName);
      for(const key of Object.keys(productFields))await attempt(key,async()=>{const result=await ensureProductField(key,values[key]);if(result.absent)skip(key);else written.push(key);});
      await report('价格');
      put('Price',document.querySelector('input[name="price"]'));
      const priceCurrency=C.sameSite(record.site,'英国')?'GBP(英镑)':C.sameSite(record.site,'德国')?'EUR(欧元)':'';
      if(priceCurrency){
        await report('List Price Currency（按站点选择'+priceCurrency+'）');
        if(await choose('List Price Currency',id('form_item_list_price.0.currency'),priceCurrency))written.push('List Price Currency：'+priceCurrency);
      }
      const priceField=id('form_item_list_price.0.value_with_tax')||id('form_item_list_price.0.value');put('List Price',priceField);
      put('Color',id('form_item_color.0.value'));
      await attempt('容量',async()=>{if(record.data['容量']){
        const attributes=all('.ant-form-item');
        const candidates=attributes.filter(e=>/容量|Capacity|Item Volume/i.test(itemLabel(e))&&!/单位|Unit/i.test(itemLabel(e)));
        const primary=candidates.filter(e=>/^Capacity\(|^容量$/.test(itemLabel(e)));
        const matches=primary.length?primary:candidates;
        if(!matches.length)skip('容量');else{
        const capacity=one(matches,'容量属性'),value=capacity.querySelector('input:not([role="combobox"])');
        if(!value)throw new Error('容量属性不是文本或数字输入框，需要人工核对');
        const unitItems=attributes.filter(e=>/容量单位|Capacity Unit|Item Volume Unit/i.test(itemLabel(e)));
        const parsed=/^([+-]?\d+(?:\.\d+)?)\s*(.*)$/.exec(record.data['容量']);
        if(unitItems.length&&parsed?.[2]){input(value,parsed[1]);await choose('容量单位',one(unitItems,'容量单位').querySelector('[role="combobox"]'),parsed[2],true);written.push('容量及单位');}
        else put('容量',value);
        }
      }});
      for(const [axis,cn] of [['length','长'],['width','宽'],['height','高']]){
        const key=`商品尺寸:${cn}（cm）`;if(put(key,id(`form_item_item_dimensions.0.${axis}.value`)))await choose(`${key}单位`,id(`form_item_item_dimensions.0.${axis}.unit`),'厘米',true);
        const wrote=put(`包装${cn}度`,id(`form_item_item_package_dimensions.0.${axis}.value`));
        const u=record.data[`包装${cn}度单位`];if(wrote&&u)await choose(`包装${cn}度单位`,id(`form_item_item_package_dimensions.0.${axis}.unit`),u,true);
      }
      if(put('包装重量',id('form_item_item_package_weight.0.value'))&&record.data['包装重量单位'])await choose('包装重量单位',id('form_item_item_package_weight.0.unit'),record.data['包装重量单位'],true);
      await report('原产地、电池和危险商品规管');if(await choose('原产地',id('form_item_country_of_origin.0.value'),'China(中国)'))written.push('原产地China');if(await choose('电池',id('form_item_batteries_required.0.value'),'No(不)'))written.push('电池No');
      await attempt('危险商品规管',async()=>{
      const danger=()=>id('form_item_dangerous_goods_regulations.0.value')?.closest('.ant-form-item')||all('.ant-form-item').find(e=>/Dangerous Goods Regulations|危险商品规管/.test(itemLabel(e)));
      if(!danger())skip('危险商品规管');else{
      for(const value of all('input[type="checkbox"]',danger()).map(e=>e.value)){
        const e=all('input[type="checkbox"]',danger()).find(e=>e.value===value);if(!e.disabled)checked(e,e.value==='not_applicable');await sleep(50);
      }
      const dangerChecks=all('input:checked',danger());
      if(dangerChecks.length!==1||dangerChecks[0].value!=='not_applicable')throw new Error('危险商品规管未能设为仅不适用');
      written.push('危险商品规管不适用');}});
      await attempt('零件编号（必填时填写01）',async()=>{const partNumber=await commands.ensurePartNumber();if(partNumber.changed)written.push('Part Number（零件编号）：01');});
      await attempt('物品状况（必填时选择New）',async()=>{const condition=await commands.ensureCondition();if(condition.changed)written.push('物品状况：New(新的)');});
      await attempt('促销信息',async()=>{const promo=document.querySelector('input[placeholder="请输入促销价"]');
      const dates=['请选择开始时间','请选择结束时间'].map(p=>document.querySelector(`input[placeholder="${p}"]`)?.value);
      // Observed collector sets a discount price without dates, blocking publication.
      if(promo?.value&&dates.every(x=>!x)){input(promo,'');written.push('清除无起止时间的采集促销价');}});
      let titleUpdate;
      await attempt(C.sameSite(record.site,'德国')?'产品标题（德国翻译）':'产品标题数量',async()=>{
        titleUpdate=await ensureTitleQuantity(record);
        if(titleUpdate.changed)written.push(titleUpdate.mode==='german_translation'?'产品标题（德国翻译）':'产品标题数量');
      });
      if(C.sameSite(record.site,'德国')){
        for(const [key,ensure] of [['产品描述（德国翻译）',ensureGermanDescription],['Bullet Point（德国翻译）',ensureGermanBullets]])await attempt(key,async()=>{
          const result=await ensure(record);if(result.absent)skip(key);else written.push(key);
        });
      }
      const title=C.text(formItem('产品标题').querySelector('input,textarea')?.value);
      return {written,skipped,warnings,title,titleUpdate};
      }catch(e){e.field=currentField;e.completedFields=[...written];e.message=`填写【${currentField}】失败：${e.message}`;throw e;}
    },
    async publish({record}={}){
      try{
        checkIdentity(record);
        const target=await until(()=>shown('button').find(e=>clean(e.textContent)==='保存并发布'&&!e.disabled&&!e.classList.contains('ant-btn-loading')),'保存并发布按钮就绪',10000);
        checkIdentity(record);click(target);
      }catch(e){e.notSubmitted=true;throw e;}
      await sleep(2000);return {clicked:true};
    },
    async publishStatus(){
      const errors=shown('.ant-form-item-explain-error').map(e=>C.text(e.textContent));
      const messages=shown('.ant-message-notice-content').map(e=>C.text(e.textContent));
      const m=modal();if(m?.textContent.includes('产品已提交发布'))return {done:true,submitted:true,text:m.innerText};
      if(errors.length) return {done:true,failed:true,text:[...new Set(errors)].join('；')};
      if(messages.some(e=>/请完善|失败|错误|不能为空/.test(e)))return {done:true,failed:true,text:[...new Set(messages)].join('；')};
      return {done:false};
    },
    async listState({name}){
      const es=shown('.sidebarBox li > div').filter(e=>C.text(e.textContent).startsWith(name));
      click(one(es,name));await sleep(400);await settled();return {url:location.href};
    },
    async searchTitle({title}){input(document.querySelector('input[name="tableSearchInput"]'),title);click(button('搜索'));await sleep(400);await settled();return {};},
    async stop(){stopped=true;return {};}
  };
  root.DXMAdapter={commands,rows,visible,reset:()=>{stopped=false;}};
  if(typeof chrome!=='undefined'&&chrome.runtime?.onMessage){
    chrome.runtime.onMessage.addListener((m,s,reply)=>{
      if(m.kind!=='DXM_ACTION')return;
      if(!commands[m.action]){reply({ok:false,error:'未知页面操作'});return;}
      commands[m.action]({...m.args,runId:m.runId}).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message,field:e.field,completedFields:e.completedFields,notSubmitted:e.notSubmitted}));return true;
    });
  }
})(globalThis);
