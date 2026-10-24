let clicks=0,running=true;
document.querySelector('#under').onclick=()=>document.querySelector('#count').textContent=`点击次数：${++clicks}`;
window.chrome={runtime:{sendMessage:async m=>{if(m.kind==='DXM_STOP')running=false;return {ok:true,owner:true,job:{state:running?'running':'stopped',rows:[{status:running?'待执行':'已停止'}],options:{startIndex:1,limit:1},step:'本地锁定测试，不连接店小秘',logs:[{message:'应阻止普通按钮，停止后解除锁定'}]}};}}};
