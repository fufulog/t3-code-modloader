const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
return await wc.executeJavaScript(`(()=>({roots:document.querySelectorAll('.t3cg').length, overlays:[...document.querySelectorAll('.t3cg-diff-overlay')].map(o=>({title:o.querySelector('.t3cg-diff-title')?.textContent, visible:o.offsetParent!==null, rootIdx:[...document.querySelectorAll('.t3cg')].indexOf(o.closest('.t3cg'))}))}))()`);
