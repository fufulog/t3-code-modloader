const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
const n = () => ev(`document.querySelectorAll('.t3cg-diff-overlay').length`);
const log = [];
for (let i = 0; i < 5 && await n(); i++) { await ev(`document.querySelector('.t3cg-diff-head [data-act=close]').click()`); await sleep(300); log.push("closed -> " + await n()); }
log.push("clean: " + await n());
await ev(`document.querySelector('.t3cg-file-row').click()`); await sleep(1500);
log.push("after one file click: " + await n());
await sleep(1500);
log.push("1.5s later: " + await n());
return log;
