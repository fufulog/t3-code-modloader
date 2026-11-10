const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const ev = (x) => wc.executeJavaScript(x);
return JSON.stringify(await ev(`[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/runtime\\.js L799/.test(e.textContent)).map(e=>e.tagName+'|'+e.closest('[class]')?.className.toString().slice(0,50))`));
