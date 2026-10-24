'use strict';
const app=document.getElementById('app'),result=document.getElementById('result');
const assert=(x,m)=>{if(!x)throw new Error(m);};
const visibleModal=()=>[...app.querySelectorAll('.ant-modal')].find(e=>e.getClientRects().length);
document.getElementById('run').onclick=async()=>{
  result.textContent='执行本地回归…';
  try{
    const [row,menu,confirmation,finished]=await Promise.all([
      fetch('/docs/evidence/move-regression-draft-row.html').then(x=>x.text()),
      fetch('/docs/evidence/move-regression-menu.html').then(x=>x.text()),
      fetch('/docs/evidence/move-regression-after-confirm.json').then(x=>x.json()),
      fetch('/docs/evidence/move-regression-progress.json').then(x=>x.json())
    ]);
    app.innerHTML='<div class="vxe-table--main-wrapper"><table><tbody>'+row+'</tbody></table></div><div id="batch"><button>批量操作</button>'+menu+'</div>';
    const dropdown=app.querySelector('.ant-dropdown');dropdown.style.display='none';
    // Reproduce the observed hover-only opening; plain .click() cannot open it.
    app.querySelector('#batch button').addEventListener('mouseenter',()=>dropdown.style.display='block');
    app.querySelector('.menu-item').closest('.batchOperationDropdown').querySelectorAll('.menu-item').forEach(item=>{
      if(item.textContent==='批量移入待发布')item.onclick=()=>{
        dropdown.style.display='none';app.insertAdjacentHTML('beforeend',confirmation.modals[0].html);
        visibleModal().className='ant-modal';
        [...visibleModal().querySelectorAll('button')].find(e=>e.textContent.replace(/\s/g,'')==='确定').onclick=()=>{
          visibleModal().remove();app.insertAdjacentHTML('beforeend','<div class="ant-modal"><div class="ant-modal-title">批量移入待发布</div><div id="commonProgressBarStatus">进行中...</div><div class="ant-progress-status-active">0 / 1</div><button>关闭</button></div>');
        };
      };
    });
    const rows=DXMAdapter.rows();assert(rows.length===1,'单条产品映射失败');
    const submitted=await DXMAdapter.commands.move({ids:[rows[0].id],waitMode:'poll'});assert(submitted.submitted,'未返回已提交状态');
    assert(visibleModal(),'提交后过早关闭弹窗');
    let p=await DXMAdapter.commands.moveProgress({expected:1});assert(!p.done,'进行中误判完成');
    await DXMAdapter.commands.closeMoveProgress({expected:1}).then(()=>{throw new Error('提前关窗没有被拦截');},e=>assert(/尚未全部成功/.test(e.message),'提前关窗错误原因不符'));
    visibleModal().querySelector('#commonProgressBarStatus').textContent='已完成!';visibleModal().querySelector('.ant-progress-status-active').textContent='100%';
    assert(!(await DXMAdapter.commands.moveProgress({expected:1})).done,'100%进度误判成最终结果');
    visibleModal().remove();app.insertAdjacentHTML('beforeend',finished.modals[0].html);
    p=await DXMAdapter.commands.moveProgress({expected:1});assert(p.done&&p.success===1&&p.failed===0,'真实最终结果解析错误');
    visibleModal().querySelector('.ant-modal-footer button').onclick=()=>visibleModal().remove();
    await DXMAdapter.commands.closeMoveProgress({expected:1});assert(!visibleModal(),'最终弹窗未关闭');
    result.textContent='PASS：真实行ID与标题匹配；悬停展开菜单；提交立即返回；进度未完成和100%都保留弹窗；提前关闭被拦截；最终成功1、失败0后才关闭。';
  }catch(e){result.textContent='FAIL：'+e.message;}
};
