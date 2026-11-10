const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
if (!await ev(`!!document.querySelector('.t3m-cols')`)) { await ev(`document.querySelector('button[aria-label="Mods"]').click()`); await sleep(1500); }
await ev(`document.querySelector('.t3m-arrow[data-id=zz-a]').click()`);
await ev(`document.querySelector('.t3m-arrow[data-id=zz-b]').click()`);
const before = require("fs").readFileSync(require("os").homedir()+"/.config/t3-modloader/config.json","utf8");
ev(`document.querySelector('[data-act=apply]').click()`);
return before.replace(/\s+/g,"");
