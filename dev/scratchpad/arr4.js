const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const ev = (x) => wc.executeJavaScript(x);
return await ev(`(()=>{const a=document.querySelector('.t3m-arrow[data-id=zz-test]'); if(!a) return 'no arrow'; a.click(); return 'clicked'})()`);
