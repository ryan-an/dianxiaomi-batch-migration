const fs=require('node:fs');
const html=fs.readFileSync('extension/popup.html','utf8').match(/<main\b[\s\S]+?<\/main>/)[0];
const css=fs.readFileSync('extension/popup.css','utf8');
fs.writeFileSync('extension/panel-view.js','// Generated from popup.html and popup.css by tests/build-panel.cjs.\n'+'globalThis.DXMPanelView='+JSON.stringify({html,css})+';\n');
