(function(root){
  'use strict';
  const C=root.DXMCore;
  class Workflow {
    constructor(job,io){this.job=job;this.io=io;}
    async log(message,records=[]){
      const entry={time:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),message};
      this.job.logs.push(entry);if(this.job.logs.length>1000)this.job.logs.shift();
      for(const r of records)r.history.push(entry);
      await this.io.save();
    }
    guard(){if(this.job.stop)throw new Error('用户已停止');}
    async step(name,rs){this.guard();this.job.step=name;for(const r of rs)r.step=name;await this.log(name,rs);}
    async scan(){
      await this.io.call('firstPage');const collected=new Map(),seen=new Set();
      for(let page=0;page<500;page++){
        this.guard();const s=await this.io.call('snapshot');
        if(seen.has(s.signature)&&s.hasNext)throw new Error('分页没有前进，已停止扫描');seen.add(s.signature);
        for(const r of s.rows)collected.set(r.id,r);
        if(!s.hasNext)return [...collected.values()];
        await this.io.call('nextPage');
      }
      throw new Error('列表超过500页，请缩小筛选范围');
    }
    async progress(rs,operation='common'){
      const moving=operation==='move',args=moving?{expected:rs.length}:{},end=Date.now()+15*60*1000;let previous='';
      try{
        while(Date.now()<end){
          this.guard();const p=await this.io.call(moving?'moveProgress':'progress',args);
          if(p.text&&p.text!==previous){await this.log(p.text,rs);previous=p.text;}
          if(p.done){
            if(moving&&(p.failed||p.success!==rs.length))throw new Error(`移入结果需要核对：成功 ${p.success}，失败 ${p.failed}；已保留当前页面，不自动重试`);
            await this.io.call(moving?'closeMoveProgress':'closeProgress',args);return p;
          }
          await this.io.sleep(1500);
        }
        throw new Error(moving?'移入待发布15分钟仍未收到完整结果；已保留当前页面，请勿重复提交':'操作15分钟未完成，请检查店小秘进度');
      }catch(e){if(moving&&!this.job.stop)e.uncertain=true;throw e;}
    }
    async pageBatches(records,idField,command,extra={}){
      const pending=new Set(records.map(r=>r[idField]));
      while(pending.size){
        this.guard();await this.io.call('firstPage');let found=false;
        for(let n=0;n<500;n++){
          const snap=await this.io.call('snapshot'),ids=snap.rows.map(r=>r.id).filter(k=>pending.has(k));
          if(ids.length){
            const members=records.filter(r=>ids.includes(r[idField]));
            await this.log(`本页处理 ${members.length} 个本批次产品`,members);
            if(command==='move'){this.job.pendingMove={ids,startedAt:new Date().toISOString()};await this.io.save();}
            const result=await this.io.call(command,{ids,...extra,...(command==='move'?{waitMode:'poll'}:{})},true);
            if(command==='claim'||command==='retry')await this.progress(members);
            else if(command==='move'){
              await this.log(`已提交 ${members.length} 个产品移入，等待店小秘处理完成，请勿刷新页面`,members);
              await this.progress(members,'move');this.job.pendingMove=null;await this.io.save();
            }
            else if(result.text)await this.log(result.text,members);
            for(const value of ids)pending.delete(value);
            found=true;break;
          }
          if(!snap.hasNext)break;await this.io.call('nextPage');
        }
        if(!found)throw new Error(`本批次还有 ${pending.size} 条在当前列表无法定位，请核对状态`);
      }
    }
    fail(r,e){r.status='失败';r.error=e.message||String(e);if(e.field)r.failedField=e.field;if(e.completedFields)r.completedFields=e.completedFields;}
    async warn(r,stage,e){
      this.guard();
      const warning={stage,field:e.field||'',message:e.message||String(e),completedFields:e.completedFields||[]};
      r.warnings.push(warning);await this.log(`${stage}警告（继续执行）：${warning.message}`,[r]);
    }
    same(a,b){try{return C.sourceKey(a)===C.sourceKey(b);}catch{return false;}}
    sameTitle(title,r){return [r.title,r.collectedTitle].some(value=>C.text(value)&&C.norm(title)===C.norm(value));}
    matchProduct(list,r,byId=false){
      return C.uniqueMatch(list,x=>(!byId||x.id===r.productId)&&this.same(x.source,r.source)&&this.sameTitle(x.title,r)&&x.text.includes(`「${r.targetShop}」`)&&C.siteInText(x.text,r.site),`产品 ${r.source}`);
    }
    async runGroup(group){
      const pending=group.filter(r=>r.status==='待执行');if(!pending.length)return;
      // Older saved batches already have product IDs but no explicit checkpoint.
      const legacy=pending.filter(r=>r.productId&&!r.checkpoint);
      if(legacy.length){
        await this.io.open('https://www.dianxiaomi.com/web/amazon/pageList/offline');const list=await this.scan();
        for(const r of legacy)r.checkpoint=list.some(x=>x.id===r.productId&&this.same(x.source,r.source))?'offline':'claimed';
        await this.io.save();
      }
      const work=pending.filter(r=>!r.checkpoint);
      if(work.length){
      await this.step(`开始采集 ${work.length} 条链接`,work);
      await this.io.open('https://www.dianxiaomi.com/web/productCrawl/dataAcquisition');
      this.job.pendingStage='采集';await this.io.save();
      await this.io.call('collect',{sources:work.map(r=>r.source)},true);const collected=await this.progress(work);
      if(!Number.isInteger(collected.failed)||collected.failed<0)throw new Error('无法读取本次采集失败数量，已停止，不自动重试');
      if(collected.failed>0){
      await this.io.call('acquisitionTab',{name:'未认领'});const successful=await this.scan();
      await this.io.call('acquisitionTab',{name:'采集失败'});
      const failed=await this.scan(),retry=[];
      for(const r of work.filter(r=>!successful.some(x=>this.same(x.source,r.source)))){
        const matches=failed.filter(x=>this.same(x.source,r.source));
        if(matches.length===1){r.collectorId=matches[0].id;r.retryCount=1;retry.push(r);}
        else if(matches.length>1)this.fail(r,new Error('采集失败列表中来源重复，不能确定要重试的条目'));
      }
      if(retry.length!==collected.failed)throw new Error('本批次失败数量与可定位记录不一致，已停止，不重试历史记录');
      if(retry.length){await this.step(`批量重试 ${retry.length} 条，每条只重试一次`,retry);await this.pageBatches(retry,'collectorId','retry');}
      }else await this.log('本次采集失败 0 条，直接进入认领',work);
      await this.io.call('acquisitionTab',{name:'未认领'});const crawled=await this.scan();
      for(const r of work.filter(r=>r.status!=='失败')){
        try{
          const m=C.uniqueMatch(crawled,x=>this.same(x.source,r.source),'采集链接和标题映射');
          if(!m.title)throw new Error('采集产品标题为空');r.collectorId=m.id;r.title=m.title;r.collectedTitle=m.title;r.collectedQuantity=C.extractProductQuantity(m.title);r.status='采集完成';r.checkpoint='collected';
          await this.log(`已对应标题：${r.title}；原标题数量：${r.collectedQuantity||'空'}；表格产品数量：${r.targetQuantity||'空'}`,[r]);
        }catch(e){this.fail(r,e);}
      }
      this.job.pendingStage=null;await this.io.save();
      }
      const good=pending.filter(r=>r.checkpoint==='collected'&&r.status!=='失败');
      if(good.length){
      await this.step(`批量认领到 [${good[0].site}]${good[0].targetShop}`,good);
      await this.io.open('https://www.dianxiaomi.com/web/productCrawl/dataAcquisition');
      await this.io.call('acquisitionTab',{name:'未认领'});
      this.job.pendingStage='认领';await this.io.save();
      await this.pageBatches(good,'collectorId','claim',{shop:good[0].targetShop,site:good[0].site});
      await this.io.open('https://www.dianxiaomi.com/web/amazon/pageList/draft');const draft=await this.scan();
      for(const r of good){try{const m=this.matchProduct(draft,r);r.productId=m.id;r.status='已认领';r.checkpoint='claimed';}catch(e){this.fail(r,e);}}
      this.job.pendingStage=null;await this.io.save();
      }
      const claimed=pending.filter(r=>r.checkpoint==='claimed'&&r.status!=='失败');
      if(claimed.length){
      if(!good.length)await this.io.open('https://www.dianxiaomi.com/web/amazon/pageList/draft');
      this.job.pendingStage='移入待发布';await this.io.save();
      await this.step('将本批次产品批量移入待发布',claimed);await this.pageBatches(claimed,'productId','move');
      for(const r of claimed)r.checkpoint='offline';this.job.pendingStage=null;await this.io.save();
      }
      const editable=pending.filter(r=>r.checkpoint==='offline'&&r.status!=='失败');if(!editable.length)return;
      for(const r of editable){
        this.guard();
        r.warnings=[];r.checkedFields=[];
        try{
          await this.step(`在待发布列表查找：${r.title}`, [r]);
          await this.io.open('https://www.dianxiaomi.com/web/amazon/pageList/offline');
          let found=false;
          const titles=[...new Set([r.title,r.collectedTitle].filter(Boolean))];
          for(const title of titles){
            await this.io.call('searchTitle',{title});await this.io.call('firstPage');
            for(let page=0;page<500;page++){
              this.guard();const snap=await this.io.call('snapshot');
              const matches=snap.rows.filter(x=>x.id===r.productId&&this.same(x.source,r.source)&&this.sameTitle(x.title,r));
              if(matches.length){r.listingTitle=this.matchProduct(snap.rows,r,true).title;found=true;break;}
              if(!snap.hasNext)break;await this.io.call('nextPage');
            }
            if(found)break;
          }
          if(!found)throw new Error('待发布列表未找到对应标题和产品ID');
          const editorRecord={...r,title:r.listingTitle};
          await this.log(`点击对应产品的编辑：${editorRecord.title}`,[r]);
          const clicked=await this.io.call('editProduct',{record:editorRecord});await this.io.waitEditor(clicked.url,editorRecord,clicked.beforeTabs);
          await this.step(`填写：${r.title}`, [r]);
          try{
            const filled=await this.io.call('fill',{record:editorRecord,modelName:this.job.options.modelNameFromNumber?r.data['Model Number']:'',continueOnError:true});r.skippedFields=filled.skipped||[];
            if(typeof filled.title==='string'&&filled.title){r.title=filled.title;r.titleQuantity=C.extractProductQuantity(r.title);}
            if(filled.titleUpdate){
              r.titleUpdate=filled.titleUpdate;
              const message=filled.titleUpdate.mode==='german_translation'?'德国标题使用表格中的德国标题翻译':filled.titleUpdate.status==='updated'?`标题数量已修改：${filled.titleUpdate.originalQuantity} → ${filled.titleUpdate.targetQuantity}`:filled.titleUpdate.status==='no_match'?'标题未识别数量，保留原标题':filled.titleUpdate.status==='missing_target'?'表格产品数量为空，保留原标题':'标题数量与表格一致';
              await this.log(message,[r]);
            }
            if(r.skippedFields.length)await this.log(`页面没有这些字段，已跳过：${r.skippedFields.join('、')}`,[r]);
            await this.log(`已填写：${filled.written.join('、')}`,[r]);
            for(const warning of filled.warnings||[])await this.warn(r,'填写',warning);
          }catch(e){await this.warn(r,'填写',e);}
          if(C.isNewProduct(r)){
            await this.step('新品：保留主图并裁剪为300×300，保存并应用',[r]);
            r.imageResult=await this.io.call('germanNewImages',{record:r});
            if(!r.imageResult?.done)throw new Error('新品图片未确认应用成功');
            await this.log('新品图片已确认：仅一张300×300主图',[r]);
          }
          await this.step('等待页面更新 2 秒后检查',[r]);await this.io.sleep(2000);this.guard();
          await this.step('提交前检查并补齐制造商、型号和型号名称',[r]);
          try{
            const checked=await this.io.call('preflight',{record:r,modelName:this.job.options.modelNameFromNumber?r.data['Model Number']:''});
            r.checkedFields=checked.checked||[];
            if(checked.repaired?.length)await this.log(`提交前已补填：${checked.repaired.join('、')}`,[r]);
            await this.log(`提交前检查通过：${r.checkedFields.join('、')||'页面现有必填项'}`,[r]);
          }catch(e){r.checkedFields=e.completedFields||[];await this.warn(r,'提交前检查',e);}
          await this.step('保存并发布',[r]);this.job.pendingStage=`发布 ${r.productId}`;await this.io.save();await this.io.call('publish',{record:r},true);
          let result;const end=Date.now()+60000;
          do{this.guard();result=await this.io.call('publishStatus');if(result.done)break;await this.io.sleep(1000);}while(Date.now()<end);
          if(!result.done){const e=new Error('提交发布后的结果无法确认，请核对平台，禁止自动重复提交');e.uncertain=true;throw e;}
          if(result.failed){this.job.pendingStage=null;await this.io.save();throw new Error(result.text);}
          if(!result.submitted){const e=new Error('没有收到产品已提交发布的确认');e.uncertain=true;throw e;}
          r.status='已发布';r.checkpoint='published';r.step='完成';r.error='';delete r.failedField;delete r.completedFields;delete r.publishUncertain;this.job.pendingStage=null;r.publishedAt=new Date().toISOString();await this.log('已出现发布成功弹窗，本条完成',[r]);
          try{await this.io.closeEditor(r);}catch(e){await this.log(`本条已发布，关闭编辑标签未完成：${e.message}`,[r]);}
        }catch(e){
          if(this.job.stop)throw e;
          if(!e.notSubmitted&&(e.uncertain||this.job.pendingStage===`发布 ${r.productId}`)){
            r.status='待人工核对';r.publishUncertain=true;r.error=e.message||String(e);
            this.job.pendingStage=null;this.job.intent=null;
            await this.log(`本条发布结果待核对，保留编辑页并继续下一条：${r.error}`,[r]);
          }else{
            this.job.pendingStage=null;if(e.notSubmitted)this.job.intent=null;
            this.fail(r,e);await this.log(`本条失败，继续下一条：${r.error}`,[r]);
          }
        }
      }
    }
    async run(){
      try{
        for(const r of this.job.rows){
          r.site=C.normalizeSite(r.site);
          if(r.title&&!r.collectedTitle)r.collectedTitle=r.title;
          r.collectedQuantity=C.extractProductQuantity(r.collectedTitle);
          if(r.status==='待执行'){try{if(C.sameSite(r.site,'德国')){C.planProductTitle(r);r.targetQuantity='';}else r.targetQuantity=C.parseTargetProductQuantity(r.data?.['产品数量']);}catch(e){this.fail(r,e);}}
        }
        for(const r of this.job.rows)if(r.status==='已提交待确认'){r.status='已发布';r.checkpoint='published';r.step='完成';r.error='';}
        const groups=new Map();for(const r of this.job.rows.filter(r=>r.status==='待执行')){const k=`${r.targetShop}|${r.site}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
        for(const group of groups.values()){
          try{await this.runGroup(group);}catch(e){if(e.uncertain||this.job.stop)throw e;for(const r of group)if(!['失败','已跳过','已提交待确认','已上线','已发布'].includes(r.status))this.fail(r,e);await this.log(`本店铺批次中止：${e.message}`,group);}
        }
        this.job.state='done';await this.log('本批次结束，可以下载结果表');
      }catch(e){
        this.job.state=e.uncertain?'review':this.job.stop?'stopped':'error';this.job.error=e.message;
        for(const r of this.job.rows)if(!['未执行','数据错误','失败','已跳过','已上线','已发布','已提交待确认','发布失败'].includes(r.status)){r.status=e.uncertain?'待人工核对':'已停止';r.error=e.message;}
        await this.log(e.uncertain?`提交状态不确定，已停止：${e.message}`:`已停止：${e.message}`);
      }finally{await this.io.save();}
    }
  }
  root.DXMWorkflow=Workflow;if(typeof module!=='undefined')module.exports=Workflow;
})(globalThis);
