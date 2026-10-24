(function(root){
  'use strict';
  function fit(position,viewport,size){
    const margin=12,width=Math.max(0,size.width),height=Math.max(0,size.height);
    const maxLeft=Math.max(margin,viewport.width-width-margin),maxTop=Math.max(margin,viewport.height-height-margin);
    const left=Number.isFinite(position?.left)?position.left:viewport.width-width-20;
    const top=Number.isFinite(position?.top)?position.top:112;
    return {left:Math.max(Math.min(margin,Math.max(0,viewport.width-width)),Math.min(maxLeft,left)),top:Math.max(Math.min(margin,Math.max(0,viewport.height-height)),Math.min(maxTop,top))};
  }
  const api={fit};root.DXMPanelLayout=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
