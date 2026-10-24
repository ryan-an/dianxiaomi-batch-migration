const params=new URL(location.href).searchParams,preview=document.querySelector('#preview');
preview.width=Math.min(800,Math.max(280,Number(params.get('width'))||400));
preview.src='popup-preview.html?state='+encodeURIComponent(params.get('state')||'ready')+'&build='+Date.now();
setInterval(()=>{
  const doc=preview.contentDocument;if(!doc?.body)return;
  preview.style.height=Math.min(610,Math.ceil(doc.body.getBoundingClientRect().height)+2)+'px';
  const width=doc.documentElement.clientWidth,overflow=doc.documentElement.scrollWidth-width;
  const clipped=[...doc.querySelectorAll('button,input,select,summary')].filter(el=>{
    const r=el.getBoundingClientRect();return r.width>2&&r.height>2&&(r.left<0||r.right>width+1);
  }).map(el=>el.id||el.textContent);
  document.querySelector('#layout').textContent=`内容宽度 ${width}px\n页面横向溢出 ${overflow}px\n越界控件 ${clipped.length} 个`;
},250);
