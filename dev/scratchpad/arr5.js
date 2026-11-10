const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
await sleep(3500);
if (!await ev(`!!document.querySelector('.t3m-cols')`)) { await ev(`document.querySelector('button[aria-label="Mods"]').click()`); await sleep(1500); }
return await ev(`(()=>{const rows=[...document.querySelectorAll('[data-list=loaded] .t3m-row')].map(r=>r.querySelector('.t3m-name').textContent); const t=document.querySelector('.t3m-arrow[data-id=zz-test]'); return {loaded:rows, arrow:t&&t.title}})()`);
