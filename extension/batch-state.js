/* Interpret visible batch-move text; a progress percentage alone is not a result. */
(function(root){
  'use strict';
  function move({title='',text='',state='',loading=false},expected){
    const compact=text.replace(/\s+/g,''),status=state.replace(/\s+/g,'');
    const success=/执行成功[：:]?(\d+)/.exec(compact),failure=/执行失败[：:]?(\d+)/.exec(compact);
    const active=loading||/进行中|执行中|处理中|未完成/.test(status);
    if(!active&&/执行结果/.test(title)&&success&&failure){
      const succeeded=Number(success[1]),failed=Number(failure[1]);
      if(expected===undefined?succeeded+failed>0:succeeded+failed===expected){
        const failures=[...text.matchAll(/产品[：:]\s*(\d+)\s*失败原因[：:]\s*([^\n]+)/g)].map(m=>({id:m[1],reason:m[2].trim()}));
        return {done:true,success:succeeded,failed,text,...(failures.length?{failures}:{})};
      }
      return {done:false,text:`${text}\n等待最终结果：当前统计 ${succeeded+failed} / ${expected} 个产品`};
    }
    return {done:false,text:text||'等待店小秘返回移入结果，请勿刷新页面'};
  }
  function movedChildren(result,ids=[]){
    return ids.length>0&&result.done&&result.failed===ids.length&&result.success>0&&result.failures?.length===ids.length&&new Set(result.failures.map(f=>f.id)).size===ids.length&&result.failures.every(f=>ids.includes(f.id)&&f.reason==='只能处在采集箱中的产品才能移入待发布！');
  }
  function movedParents(result,ids=[]){
    if(!ids.length||new Set(ids).size!==ids.length||!result.done||!Number.isInteger(result.success)||!Number.isInteger(result.failed)||result.success<ids.length||result.failed<0)return false;
    if(!result.failed)return true;
    const failures=result.failures||[];
    return failures.length===result.failed&&new Set(failures.map(f=>f.id)).size===result.failed&&failures.every(f=>f.id&&!ids.includes(f.id));
  }
  function moveReconciliation(job){
    const pending=job?.pendingMove,valid=ids=>Array.isArray(ids)&&ids.length>0&&ids.every(id=>typeof id==='string'&&id)&&new Set(ids).size===ids.length;
    if(!pending?.reconciling||!valid(pending.ids)||(job.intent&&job.intent.action!=='move')||(job.pendingStage&&job.pendingStage!=='移入待发布'))return null;
    // reconciling was saved only after the selected parents' final success was confirmed.
    if(Array.isArray(pending.childIds))return {...pending};
    // v0.4.43 saved the verified duplicate-child result in logs, but omitted its IDs.
    const entries=job.logs||[],marker=entries.findLastIndex(entry=>entry.message==='父产品已移入；正在待发布列表核对全部子变体，禁止重复移入');
    if(marker<0)return null;
    const text=entries.slice(0,marker).findLast(entry=>/执行结果/.test(entry.message))?.message||'';
    const result=move({title:'执行结果',text});
    return movedParents(result,pending.ids)?{...pending,childIds:result.failures?.map(f=>f.id)||[]}:null;
  }
  const api={move,movedParents,movedChildren,moveReconciliation};root.DXMBatchState=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
