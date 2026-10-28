/* Interpret visible batch-move text; a progress percentage alone is not a result. */
(function(root){
  'use strict';
  function move({title='',text='',state='',loading=false},expected){
    const compact=text.replace(/\s+/g,''),status=state.replace(/\s+/g,'');
    const success=/执行成功[：:]?(\d+)/.exec(compact),failure=/执行失败[：:]?(\d+)/.exec(compact);
    const active=loading||/进行中|执行中|处理中|未完成/.test(status);
    if(!active&&/执行结果/.test(title)&&success&&failure){
      const succeeded=Number(success[1]),failed=Number(failure[1]);
      if(succeeded+failed===expected){
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
  const api={move,movedChildren};root.DXMBatchState=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
