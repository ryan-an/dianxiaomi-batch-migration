/* Interpret visible batch-move text; a progress percentage alone is not a result. */
(function(root){
  'use strict';
  function move({title='',text='',state='',loading=false},expected){
    const compact=text.replace(/\s+/g,''),status=state.replace(/\s+/g,'');
    const success=/执行成功[：:]?(\d+)/.exec(compact),failure=/执行失败[：:]?(\d+)/.exec(compact);
    const active=loading||/进行中|执行中|处理中|未完成/.test(status);
    if(!active&&/执行结果/.test(title)&&success&&failure){
      const succeeded=Number(success[1]),failed=Number(failure[1]);
      if(succeeded+failed===expected)return {done:true,success:succeeded,failed,text};
      return {done:false,text:`${text}\n等待最终结果：当前统计 ${succeeded+failed} / ${expected} 个产品`};
    }
    return {done:false,text:text||'等待店小秘返回移入结果，请勿刷新页面'};
  }
  const api={move};root.DXMBatchState=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
