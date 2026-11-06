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
    async readPage(){
      for(let attempt=0;attempt<3;attempt++){
        this.guard();
        try{return await this.io.call('snapshot');}
        catch(error){
          this.guard();
          if(!error.listIncomplete&&!/^等待超时：加载完整列表行/.test(error.message))throw error;
          error.listIncomplete=true;if(attempt===2)throw error;
          await this.log(`列表内容仍在加载，自动滚动重试 ${attempt+2}/3，保留已完成步骤：${error.message}`);await this.io.sleep(600*(attempt+1));
        }
      }
    }
    async scan(){
      await this.io.call('firstPage');const collected=new Map(),seen=new Set();
      for(let page=0;page<500;page++){
        this.guard();const s=await this.readPage();
        if(seen.has(s.signature)&&s.hasNext)throw new Error('分页没有前进，已停止扫描');seen.add(s.signature);
        for(const r of s.rows)if(!collected.has(r.id))collected.set(r.id,r);
        if(!s.hasNext)return [...collected.values()];
        await this.io.call('nextPage');
      }
      throw new Error('列表超过500页，请缩小筛选范围');
    }
    async progress(rs,operation='common',parentIds=[]){
      const moving=operation==='move',args=moving?{parentIds}:{},end=Date.now()+15*60*1000;let previous='';
      try{
        while(Date.now()<end){
          this.guard();const p=await this.io.call(moving?'moveProgress':'progress',args);
          if(p.text&&p.text!==previous){await this.log(p.text,rs);previous=p.text;}
          if(p.done){
            if(moving&&!root.DXMBatchState.movedParents(p,parentIds))throw new Error(`父产品移入结果需要核对：成功 ${p.success}，失败 ${p.failed}；已保留当前页面，不自动重试`);
            await this.io.call(moving?'closeMoveProgress':'closeProgress',args);return p;
          }
          await this.io.sleep(1500);
        }
        throw new Error(moving?'移入待发布15分钟仍未收到完整结果；已保留当前页面，请勿重复提交':'操作15分钟未完成，请检查店小秘进度');
      }catch(e){if(moving&&!this.job.stop)e.uncertain=true;throw e;}
    }
    async pageBatches(records,idField,command,extra={}){
      const idsFor=r=>command==='move'?[this.firstProduct(r)]:r[idField+'s']?.length?r[idField+'s']:[r[idField]];
      const pending=new Set(records.flatMap(r=>idsFor(r).filter(id=>(command!=='move'||!r.movedProductIds?.includes(id))&&(command!=='claim'||!r.claimedCollectorIds?.includes(id)))).filter(Boolean));
      while(pending.size){
        this.guard();await this.io.call('firstPage');let found=false;
        for(let n=0;n<500;n++){
          const snap=await this.readPage(),ids=snap.rows.map(r=>r.id).filter(k=>pending.has(k));
          if(ids.length){
            const members=records.filter(r=>idsFor(r).some(id=>ids.includes(id)));
            const expected=ids.length;
            await this.log(`本页处理 ${ids.length} 行${command==='move'?'，每条来源仅移入首个父产品':''}`,members);
            if(command==='move'){this.job.pendingStage='移入待发布';this.job.pendingMove={ids,startedAt:new Date().toISOString()};await this.io.save();}
            if(command==='retry'){
              for(const r of members){r.retryUncertain=true;r.checkpoint='retry_review';}
              await this.io.save();
              try{
                const result=await this.io.call(command,{ids,...extra},true);
                const progress=result.mode==='list'?result:await this.progress(members);
                await this.verifyRetry(members,progress);
              }catch(error){this.guard();await this.retryProblem(members.filter(r=>r.checkpoint==='retry_review'),error);}
              if(this.job.intent?.action==='retry')this.job.intent=null;
              await this.io.save();await this.io.call('acquisitionTab',{name:'采集失败'});
              for(const value of ids)pending.delete(value);found=true;break;
            }
            if(command==='claim'){
              const completed=await this.claimPage(members,ids,extra);
              for(const value of completed?ids:members.flatMap(idsFor))pending.delete(value);found=true;break;
            }
            const result=await this.io.call(command,{ids,...extra,...(command==='move'?{waitMode:'poll'}:{})},true);
            if(command==='move'){
              await this.log(`已提交 ${expected} 个父产品移入，等待店小秘处理完成，请勿刷新页面`,members);
              await this.progress(members,'move',ids);
              this.markMoved(members,ids);
              this.job.pendingMove=null;this.job.pendingStage=null;await this.io.save();
            }
            else if(result.text)await this.log(result.text,members);
            for(const value of ids)pending.delete(value);
            found=true;break;
          }
          if(!snap.hasNext)break;await this.io.call('nextPage');
        }
        if(!found){
          const error=new Error(`本批次还有 ${pending.size} 条在当前列表无法定位，请核对状态`);
          if(command!=='retry')throw error;
          error.notSubmitted=true;await this.retryProblem(records.filter(r=>idsFor(r).some(id=>pending.has(id))),error);return;
        }
      }
    }
    async claimPage(records,ids,extra){
      for(let attempt=0;attempt<3;attempt++){
        this.guard();this.job.pendingClaim={ids,shop:extra.shop,site:extra.site,phase:'preparing'};
        await this.log(`加载并核对店铺 [${extra.site}]${extra.shop}，第 ${attempt+1}/3 次准备；尚未提交认领，加载最多等待90秒`,records);
        let submissionAttempted=false,submitted=false;
        try{
          await this.io.call('prepareClaim',{ids,...extra,reopen:attempt>0});this.guard();
          this.job.pendingClaim.phase='prepared';await this.io.save();
          submissionAttempted=true;await this.io.call('claim',{ids,...extra,prepared:true},true);submitted=true;await this.progress(records);
          for(const r of records){const all=r.collectorIds?.length?r.collectorIds:[r.collectorId];r.claimedCollectorIds=[...new Set([...(r.claimedCollectorIds||[]),...all.filter(id=>ids.includes(id))])];if(all.every(id=>r.claimedCollectorIds.includes(id)))r.checkpoint='claim_lookup';}
          this.job.pendingClaim=null;this.job.pendingStage=null;this.job.intent=null;await this.io.save();return true;
        }catch(error){
          this.guard();
          if(submitted||(submissionAttempted&&!error.notSubmitted)){error.uncertain=true;throw error;}
          this.job.intent=null;this.job.pendingStage=null;
          if(error.retryable!==false&&attempt<2){await this.log(`店铺准备尚未完成，自动重新打开并加载，不重复提交：${error.message}`,records);await this.io.sleep(1500*(attempt+1));continue;}
          if(error.listIncomplete){this.job.pendingClaim=null;throw error;}
          for(const r of records)this.fail(r,new Error(`认领尚未提交：${error.message}`));
          this.job.pendingClaim=null;await this.log(`本页认领未提交，保留采集结果；其他可执行记录继续：${error.message}`,records);return false;
        }
      }
    }
    firstProduct(record){return record.productIds?.[0]||record.productId;}
    markMoved(records,ids){
      for(const r of records){
        const all=[this.firstProduct(r)].filter(Boolean);
        r.movedProductIds=[...new Set([...(r.movedProductIds||[]),...all.filter(id=>ids.includes(id))])];
        if(all.every(id=>r.movedProductIds.includes(id)))r.checkpoint='offline';
      }
    }
    async reconcileMove(){
      const fail=message=>{const error=new Error(message);error.uncertain=true;throw error;};
      const plan=root.DXMBatchState.moveReconciliation(this.job);if(!plan)fail('移入保存点缺少可验证的父产品ID和最终结果，保留待核对，禁止重复移入');
      const records=this.job.rows.filter(r=>(r.productIds||[r.productId]).some(id=>plan.ids.includes(id)));
      if(plan.ids.some(id=>!records.some(r=>(r.productIds||[r.productId]).includes(id))))fail('移入保存点无法对应本批次产品，禁止重复移入');
      const ids=plan.ids.filter(id=>records.some(r=>this.firstProduct(r)===id));
      this.job.pendingMove=plan;await this.io.save();
      await this.log('恢复已移入的父产品；只查父产品，不核对子变体，不重复移入',records);
      let offline;
      try{if(ids.length){await this.io.open('https://www.dianxiaomi.com/web/amazon/pageList/offline');offline=await this.scan();}else offline=[];}
      catch(error){if(!this.job.stop)error.uncertain=true;throw error;}
      const parents=offline.filter(x=>ids.includes(x.id));
      const missingParents=ids.filter(id=>!parents.some(parent=>parent.id===id));
      const wrong=parents.filter(parent=>!records.some(r=>(r.productIds||[r.productId]).includes(parent.id)&&this.matchingProducts([parent],r).length));
      if(missingParents.length||wrong.length)fail(`移入后父产品待核对：缺父产品 ${missingParents.join('、')||'无'}；来源/标题/店铺/站点不符 ${wrong.map(r=>r.id).join('、')||'无'}。保留保存点，禁止重复移入`);
      this.markMoved(records,ids);this.job.pendingMove=null;if(this.job.pendingStage==='移入待发布')this.job.pendingStage=null;if(this.job.intent?.action==='move')this.job.intent=null;
      await this.log(`已恢复 ${ids.length} 个已移入父产品；不核对子变体，继续后续流程`,records);
    }
    async retryProblem(records,error){
      for(const r of records){
        if(error.notSubmitted){this.fail(r,error);delete r.retryUncertain;r.checkpoint='collect_lookup';}
        else{r.status='待人工核对';r.retryUncertain=true;r.checkpoint='retry_review';r.error=`采集重试结果待核对，禁止重复提交：${error.message||error}`;}
      }
      if(this.job.intent?.action==='retry')this.job.intent=null;
      await this.log(`本次重试仅影响 ${records.length} 条，其他已采集记录继续：${error.message||error}`,records);
    }
    async verifyRetry(records,progress){
      const pending=new Set(records),started=new Set(records.filter(r=>progress.transitionedIds?.includes(r.collectorId))),end=Date.now()+15*60*1000,idleEnd=Date.now()+20000;let verifiedFailures=0;
      while(pending.size&&Date.now()<end){
        this.guard();
        for(const name of ['未认领','已认领']){
          await this.io.call('acquisitionTab',{name});const list=await this.scan();
          for(const r of pending)if(list.some(x=>this.same(x.source,r.source))){
            try{await this.mapCollected(r,name==='未认领'?list:[],name==='已认领'?list:[]);}
            catch(error){this.fail(r,error);delete r.retryUncertain;r.checkpoint='collect_lookup';await this.log(r.error,[r]);}
            pending.delete(r);
          }
          if(!pending.size)return;
        }
        await this.io.call('acquisitionTab',{name:'采集中'});const collecting=await this.scan();
        const active=new Set([...pending].filter(r=>collecting.some(x=>this.same(x.source,r.source))));for(const r of active)started.add(r);
        await this.io.call('acquisitionTab',{name:'采集失败'});const failed=await this.scan();
        for(const r of pending){
          const matches=failed.filter(x=>this.same(x.source,r.source)&&!/跳过采集|采集已经采集过/.test(x.text));
          if(!active.has(r)&&matches.length===1&&(started.has(r)||(progress.done&&progress.failed-verifiedFailures===pending.size)||(r.retryOriginalText&&matches[0].text!==r.retryOriginalText))){
            this.fail(r,new Error(`采集重试后仍失败：${matches[0].text||'平台未采集成功'}`));delete r.retryUncertain;r.checkpoint='collect_lookup';pending.delete(r);verifiedFailures++;await this.log(r.error,[r]);
          }else if(!started.has(r)&&Date.now()>=idleEnd){await this.retryProblem([r],new Error('重试反馈后未确认该来源进入采集中或采集成功'));pending.delete(r);}
        }
        if(pending.size)await this.io.sleep(1500);
      }
      if(pending.size)await this.retryProblem([...pending],new Error('采集重试15分钟仍未确认完成'));
    }
    async mapCollected(r,crawled,alreadyClaimed){
      const unclaimed=crawled.filter(x=>this.same(x.source,r.source)),collectorTab=unclaimed.length?'未认领':'已认领';
      const found=unclaimed.length?unclaimed:alreadyClaimed.filter(x=>this.same(x.source,r.source));if(!found.length)return false;
      const m=this.firstMatch(found,'采集链接和标题映射');
      r.collectorIds=[m.id];r.collectorId=m.id;r.collectorTab=collectorTab;r.title=m.title;r.collectedTitle=m.title;r.collectedQuantity=C.extractProductQuantity(m.title);r.status='采集完成';r.checkpoint='collected';r.error='';delete r.retryUncertain;
      await this.log(`在${collectorTab}找到同链接 ${found.length} 条，只取第一条认领`,[r]);
      await this.log(`已对应标题：${r.title}；原标题数量：${r.collectedQuantity||'空'}；表格产品数量：${r.targetQuantity||'空'}`,[r]);return true;
    }
    fail(r,e){r.status='失败';r.error=e.message||String(e);if(e.field)r.failedField=e.field;if(e.completedFields)r.completedFields=e.completedFields;}
    async warn(r,stage,e){
      this.guard();
      const warning={stage,field:e.field||'',message:e.message||String(e),completedFields:e.completedFields||[]};
      r.warnings.push(warning);await this.log(`${stage}警告（继续执行）：${warning.message}`,[r]);
    }
    same(a,b){try{return C.sourceKey(a)===C.sourceKey(b);}catch{return false;}}
    sameTitle(title,r){return [r.title,r.collectedTitle].some(value=>C.text(value)&&C.norm(title)===C.norm(value));}
    matchingProducts(list,r){return list.filter(x=>this.same(x.source,r.source)&&this.sameTitle(x.title,r)&&x.text.includes(`「${r.targetShop}」`)&&C.siteInText(x.text,r.site));}
    firstMatch(list,label){
      if(!list.length)throw new Error(`${label}：匹配到 0 条`);
      if(!C.text(list[0].title))throw new Error(`${label}：第一条标题为空，请核对`);
      return list[0];
    }
    async runGroup(group){
      const pending=group.filter(r=>r.status==='待执行');if(!pending.length)return;
      const claimLookup=pending.filter(r=>r.checkpoint==='claim_lookup');
      if(claimLookup.length){
        await this.step('恢复认领映射：只查已有产品，不重复认领',claimLookup);
        await this.io.open('https://www.dianxiaomi.com/web/amazon/pageList/draft');const draft=await this.scan();
        let offline=[];if(claimLookup.some(r=>!this.matchingProducts(draft,r).length)){await this.io.open('https://www.dianxiaomi.com/web/amazon/pageList/offline');offline=await this.scan();}
        for(const r of claimLookup){
          try{
            const inDraft=this.matchingProducts(draft,r),first=this.firstMatch(inDraft.length?inDraft:this.matchingProducts(offline,r),'恢复认领产品映射');
            r.productIds=[first.id];r.productId=first.id;r.checkpoint=inDraft.length?'claimed':'offline';r.status='已认领';r.error='';
            if(!inDraft.length)r.movedProductIds=[...r.productIds];
            await this.log(`恢复首个已有父产品 ${first.id}，继续后续流程，不重复认领`,[r]);
          }catch(error){r.status='待人工核对';r.error=`认领结果待核对，不重复认领：${error.message}`;await this.log(r.error,[r]);}
        }
      }
      const lookup=pending.filter(r=>['retry_review','collect_lookup'].includes(r.checkpoint));
      if(lookup.length){
        await this.step('先核对已有采集记录，不重复提交重试',lookup);
        await this.io.open('https://www.dianxiaomi.com/web/productCrawl/dataAcquisition');
        await this.io.call('acquisitionTab',{name:'未认领'});const unclaimed=await this.scan();
        let claimed=[];if(lookup.some(r=>!unclaimed.some(x=>this.same(x.source,r.source)))){await this.io.call('acquisitionTab',{name:'已认领'});claimed=await this.scan();}
        for(const r of lookup){
          try{if(!await this.mapCollected(r,unclaimed,claimed))await this.retryProblem([r],new Error('续执行核对时，未认领和已认领均未找到该来源'));
          }catch(error){this.fail(r,error);}
        }
        await this.io.save();
      }
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
      await this.io.call('acquisitionTab',{name:'未认领'});let crawled=await this.scan(),alreadyClaimed=[];
      const missing=work.filter(r=>!crawled.some(x=>this.same(x.source,r.source)));
      if(missing.length){
        await this.step(`未认领未找到 ${missing.length} 条来源链接，继续到已认领查找`,missing);
        await this.io.call('acquisitionTab',{name:'已认领'});alreadyClaimed=await this.scan();
      }
      // Persist successful records before submitting any failed retry.
      for(const r of work){try{await this.mapCollected(r,crawled,alreadyClaimed);}catch(error){this.fail(r,error);}}
      this.job.pendingStage=null;await this.io.save();
      if(collected.failed>0){
      const successful=[...crawled,...alreadyClaimed];
      await this.io.call('acquisitionTab',{name:'采集失败'});
      const failed=await this.scan(),retry=[];
      const unresolved=work.filter(r=>r.status==='待执行'&&!successful.some(x=>this.same(x.source,r.source)));
      for(const r of unresolved){
        const matches=failed.filter(x=>this.same(x.source,r.source)&&!/跳过采集|采集已经采集过/.test(x.text));
        if(matches.length===1){r.collectorId=matches[0].id;r.retryOriginalText=matches[0].text;r.retryCount=1;retry.push(r);}
        else if(matches.length>1)this.fail(r,new Error('采集失败列表中来源重复，不能确定要重试的条目'));
      }
      if(retry.length!==collected.failed)await this.retryProblem(unresolved.filter(r=>r.status!=='失败'),new Error('本批次失败数量与可定位记录不一致，不重试历史记录'));
      else if(retry.length){
        await this.step(`批量重试 ${retry.length} 条，每条只重试一次`,retry);await this.pageBatches(retry,'collectorId','retry');
        await this.io.call('acquisitionTab',{name:'未认领'});crawled=await this.scan();
        await this.io.call('acquisitionTab',{name:'已认领'});alreadyClaimed=await this.scan();
      }
      }else await this.log('本次采集失败 0 条，按找到的采集记录继续认领',work);
      for(const r of work.filter(r=>r.status==='待执行')){
        try{
          if(!await this.mapCollected(r,crawled,alreadyClaimed))throw new Error('未认领和已认领列表均未找到该来源链接');
        }catch(e){this.fail(r,e);}
      }
      this.job.pendingStage=null;await this.io.save();
      }
      const good=pending.filter(r=>r.checkpoint==='collected'&&r.status!=='失败');
      if(good.length){
      await this.step(`批量认领到 [${good[0].site}]${good[0].targetShop}`,good);
      await this.io.open('https://www.dianxiaomi.com/web/productCrawl/dataAcquisition');
      for(const name of ['未认领','已认领']){
        const records=good.filter(r=>(r.collectorTab==='已认领'?'已认领':'未认领')===name);if(!records.length)continue;
        await this.io.call('acquisitionTab',{name});
        await this.pageBatches(records,'collectorId','claim',{shop:good[0].targetShop,site:good[0].site});
      }
      await this.io.open('https://www.dianxiaomi.com/web/amazon/pageList/draft');const draft=await this.scan();
      for(const r of good.filter(r=>r.status!=='失败')){try{const first=this.firstMatch(this.matchingProducts(draft,r),'认领产品映射');r.productIds=[first.id];r.productId=first.id;r.status='已认领';r.checkpoint='claimed';await this.log(`只取首个父产品 ${first.id} 移入并编辑，不核对子变体`,[r]);}catch(e){this.fail(r,e);r.checkpoint='claim_lookup';}}
      this.job.pendingStage=null;await this.io.save();
      }
      const claimed=pending.filter(r=>r.checkpoint==='claimed'&&r.status!=='失败');
      if(claimed.length){
      if(!good.length)await this.io.open('https://www.dianxiaomi.com/web/amazon/pageList/draft');
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
              this.guard();const snap=await this.readPage();
              const allowed=new Set(r.productIds?.length?r.productIds:[r.productId]);
              const matches=this.matchingProducts(snap.rows,r).filter(x=>allowed.has(x.id));
              if(matches.length){const first=matches[0];r.productId=first.id;r.listingTitle=first.title;found=true;break;}
              if(!snap.hasNext)break;await this.io.call('nextPage');
            }
            if(found)break;
          }
          if(!found)throw new Error('待发布列表未找到对应标题和产品ID');
          const editorRecord={...r,title:r.listingTitle};
          await this.log(`点击对应产品的编辑：${editorRecord.title}`,[r]);
          const clicked=await this.io.call('editProduct',{record:editorRecord});await this.io.waitEditor(clicked.url,editorRecord,clicked.beforeTabs);
          if(r.sellingMode==='single'){
            await this.step('售卖形式从多变种改为单品',[r]);
            await this.io.call('ensureSellingMode',{record:editorRecord});
          }
          await this.step(`填写：${r.title}`, [r]);
          try{
            const filled=await this.io.call('fill',{record:editorRecord,modelName:this.job.options.modelNameFromNumber?r.data['Model Number']:'',continueOnError:true});r.skippedFields=filled.skipped||[];
            if(typeof filled.title==='string'&&filled.title){r.title=filled.title;r.titleQuantity=C.extractProductQuantity(r.title);}
            if(filled.titleUpdate){
              r.titleUpdate=filled.titleUpdate;
              const message=filled.titleUpdate.mode==='german_translation'?`${C.normalizeSite(r.site)}标题使用表格中的德国标题翻译`:filled.titleUpdate.status==='updated'?`标题数量已修改：${filled.titleUpdate.originalQuantity} → ${filled.titleUpdate.targetQuantity}`:filled.titleUpdate.status==='no_match'?'标题未识别数量，保留原标题':filled.titleUpdate.status==='missing_target'?'表格产品数量为空，保留原标题':'标题数量与表格一致';
              await this.log(message,[r]);
            }
            if(r.skippedFields.length)await this.log(`页面没有这些字段，已跳过：${r.skippedFields.join('、')}`,[r]);
            await this.log(`已填写：${filled.written.join('、')}`,[r]);
            for(const warning of filled.warnings||[])await this.warn(r,'填写',warning);
          }catch(e){await this.warn(r,'填写',e);}
          if(C.shouldProcessImages(r)){
            await this.step(`${C.sameSite(r.site,'美国')?'美国站':'新品'}：保留主图并裁剪为400×400，保存并应用`,[r]);
            r.imageResult=await this.io.call('germanNewImages',{record:r});
            if(!r.imageResult?.done)throw new Error('商品图片未确认应用成功');
            await this.log('商品图片已确认：仅一张400×400主图',[r]);
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
          if(e.listIncomplete)throw e;
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
          if(r.status==='待执行')r.sellingMode='single';
          if(r.title&&!r.collectedTitle)r.collectedTitle=r.title;
          r.collectedQuantity=C.extractProductQuantity(r.collectedTitle);
          if(r.status==='待执行'){try{if(C.usesTranslatedContent(r.site)){C.planProductTitle(r);r.targetQuantity='';}else r.targetQuantity=C.parseTargetProductQuantity(r.data?.['产品数量']);}catch(e){this.fail(r,e);}}
        }
        for(const r of this.job.rows)if(r.status==='已提交待确认'){r.status='已发布';r.checkpoint='published';r.step='完成';r.error='';}
        if(this.job.pendingMove)await this.reconcileMove();
        for(const r of this.job.rows.filter(r=>r.status==='待执行')){
          if(r.collectorIds?.length){r.collectorIds=r.collectorIds.slice(0,1);r.collectorId=r.collectorIds[0];}
          const first=this.firstProduct(r);if(first){r.productId=first;r.productIds=[first];if(r.movedProductIds?.includes(first)&&r.checkpoint==='claimed')r.checkpoint='offline';}
        }
        await this.io.save();
        const groups=new Map();let waitingForList=false;for(const r of this.job.rows.filter(r=>r.status==='待执行')){const k=`${r.targetShop}|${r.site}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
        for(const group of groups.values()){
          try{await this.runGroup(group);}catch(e){
            if(e.uncertain||this.job.stop)throw e;
            if(e.listIncomplete){
              waitingForList=true;this.job.error=e.message;
              for(const r of group)if(!['失败','已跳过','已提交待确认','已上线','已发布'].includes(r.status)){r.status='待人工核对';r.error=`列表尚未加载完整，已保留已完成步骤：${e.message}`;}
              await this.log('本店铺列表读取暂未完成，保留原保存点；继续执行时恢复核对，其他店铺继续',group);continue;
            }
            for(const r of group)if(!['失败','已跳过','已提交待确认','已上线','已发布'].includes(r.status))this.fail(r,e);await this.log(`本店铺批次中止：${e.message}`,group);
          }
        }
        this.job.state=waitingForList?'review':'done';if(!waitingForList)this.job.error='';await this.log(waitingForList?'仍有列表等待加载核对，已完成步骤保留，可继续执行':'本批次结束，可以下载结果表');
      }catch(e){
        this.job.state=e.uncertain?'review':this.job.stop?'stopped':'error';this.job.error=e.message;
        for(const r of this.job.rows)if(!['未执行','数据错误','失败','已跳过','已上线','已发布','已提交待确认','发布失败'].includes(r.status)){r.status=e.uncertain?'待人工核对':'已停止';r.error=e.message;}
        await this.log(e.uncertain?`提交状态不确定，已停止：${e.message}`:`已停止：${e.message}`);
      }finally{await this.io.save();}
    }
  }
  root.DXMWorkflow=Workflow;if(typeof module!=='undefined')module.exports=Workflow;
})(globalThis);
