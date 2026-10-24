let pageClicks=0;
document.getElementById('under').onclick=()=>document.getElementById('count').textContent=`页面点击次数：${++pageClicks}`;
