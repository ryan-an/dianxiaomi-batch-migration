(function(){
  'use strict';
  if(globalThis.DXMPanel||document.getElementById('dxm-migration-panel'))return;
  const host=document.createElement('div');host.id='dxm-migration-panel';
  host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>${DXMPanelView.css}
    #surface{position:fixed;right:20px;top:112px;width:480px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain;pointer-events:auto;background:#fff;border:1px solid #dce5f1;border-radius:15px;box-shadow:0 12px 48px #22395c33}
    #surface.dragging>main>header{cursor:grabbing}
    #shade{position:fixed;inset:0;background:#213d642b;pointer-events:auto;cursor:wait}
    #lockNotice{position:absolute;left:20px;top:20px;max-width:calc(100vw - 40px);padding:14px 20px;background:#fff;border:1px solid #cbdcf5;border-radius:12px;box-shadow:0 6px 24px #22395c26;color:#25354b;font:14px/1.7 system-ui,'Microsoft YaHei',sans-serif}
    #lockNotice strong{display:block;color:#245bd6;font-size:15px}
    #lockNotice p{margin:3px 0 0;font-size:12px;color:#647892}
  </style><div id="shade" hidden><div id="lockNotice" role="status" aria-live="polite"><strong>正在自动执行，页面操作已锁定</strong><p>请勿操作或刷新此页面。如需手动操作，请先在迁移助手中点击“停止”，等待任务停止。</p></div></div><aside id="surface" aria-label="店小秘迁移浮动面板">${DXMPanelView.html}</aside>`;
  document.documentElement.append(host);
  const surface=root.getElementById('surface'),header=root.querySelector('main>header');
  let locked=false,running=false,closed=false,position=null,drag=null,moved=false,explicitOpen=false,cacheResetting=false,layoutEpoch=0,layoutWrite=Promise.resolve();
  const store=value=>{if(cacheResetting)return Promise.resolve();layoutWrite=layoutWrite.then(()=>chrome.storage.local.set(value)).catch(()=>{});return layoutWrite;};
  function place(){
    if(closed)return;
    const rect=surface.getBoundingClientRect();
    position=DXMPanelLayout.fit(position,{width:innerWidth,height:innerHeight},{width:rect.width,height:rect.height});
    surface.style.right='auto';surface.style.left=`${position.left}px`;surface.style.top=`${position.top}px`;
  }
  function setClosed(value,persist=true){
    if(value&&(running||locked))return false;
    closed=value;surface.hidden=value;place();
    if(persist)store({dxmPanelClosed:value});
    return true;
  }
  function show(){explicitOpen=true;setClosed(false);root.dispatchEvent(new CustomEvent('dxm-panel-open'));}
  function guard(event){if(locked&&event.isTrusted&&!event.composedPath().includes(surface)){event.preventDefault();event.stopImmediatePropagation();}}
  for(const type of ['click','dblclick','pointerdown','pointerup','mousedown','mouseup','touchstart','touchmove','keydown','keyup','beforeinput','paste','cut','drop','dragstart','wheel','contextmenu'])document.addEventListener(type,guard,{capture:true,passive:false});
  header.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button'))return;
    const rect=surface.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX-rect.left,y:event.clientY-rect.top};
    header.setPointerCapture(event.pointerId);surface.classList.add('dragging');event.preventDefault();
  });
  header.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    moved=true;position={left:event.clientX-drag.x,top:event.clientY-drag.y};place();event.preventDefault();
  });
  function finish(event){
    if(!drag||event.pointerId!==drag.id)return;const id=drag.id;drag=null;surface.classList.remove('dragging');
    if(header.hasPointerCapture(id))header.releasePointerCapture(id);
    if(moved)store({dxmPanelPosition:position});
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture'])header.addEventListener(type,finish);
  addEventListener('resize',()=>requestAnimationFrame(place));
  function reset(){
    layoutEpoch++;locked=false;running=false;cacheResetting=false;drag=null;moved=false;explicitOpen=true;position=null;
    surface.classList.remove('dragging');root.getElementById('shade').hidden=true;
    setClosed(false,false);globalThis.DXMAdapter?.reset();
  }
  globalThis.DXMPanel={root,show,reset,close:()=>setClosed(true),update(value){
    const wasLocked=locked;locked=!!value.locked;running=!!value.running;
    root.getElementById('shade').hidden=!locked;
    if(running||locked){explicitOpen=true;if(closed)setClosed(false);}
    if(locked&&!wasLocked&&document.activeElement!==host){document.activeElement?.blur();root.getElementById('logs')?.focus({preventScroll:true});}
    requestAnimationFrame(place);
  }};
  chrome.runtime.onMessage?.addListener((message,sender,reply)=>{
    if(message.kind==='DXM_CACHE_PREPARE'){
      cacheResetting=true;layoutEpoch++;const waits=[layoutWrite];
      root.dispatchEvent(new CustomEvent('dxm-cache-prepare',{detail:{waitUntil:p=>waits.push(p)}}));
      Promise.allSettled(waits).then(()=>reply({ok:true}));return true;
    }
    if(message.kind==='DXM_CACHE_CLEARED'){reset();root.dispatchEvent(new CustomEvent('dxm-cache-cleared'));reply({ok:true});return;}
    if(message.kind==='DXM_CACHE_FAILED'){cacheResetting=false;root.dispatchEvent(new CustomEvent('dxm-cache-failed'));reply({ok:true});return;}
    if(message.kind!=='DXM_PANEL_OPEN')return;show();reply({ok:true});
  });
  place();
  const initialLayoutEpoch=layoutEpoch;
  chrome.storage.local.get(['dxmPanelPosition','dxmPanelClosed']).then(saved=>{
    if(initialLayoutEpoch!==layoutEpoch)return;
    if(!moved)position=saved.dxmPanelPosition||position;
    setClosed(!explicitOpen&&saved.dxmPanelClosed===true,false);
  }).catch(()=>{});
})();
