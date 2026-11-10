const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const ev = (x) => wc.executeJavaScript(x);
await ev(`document.querySelector('.t3cg-diff-head [data-act=close]')?.click()`);
return await ev(`document.querySelectorAll('.t3cg-diff-overlay').length`);
