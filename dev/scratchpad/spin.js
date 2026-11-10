const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
return await wc.executeJavaScript(`(()=>{const out=[];for(const ss of document.styleSheets){try{for(const r of ss.cssRules){if(r.cssText.includes('animate-spin')||(r.type===7&&r.name==='spin'))out.push(r.cssText.slice(0,160))}}catch{}}return out})()`);
