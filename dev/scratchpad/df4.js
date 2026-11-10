const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
const n = () => ev(`document.querySelectorAll('.t3cg-diff-overlay').length`);
const out = { start: await n() };
if (!await ev(`!!document.querySelector('.t3cg-file-row')`)) { await ev(`(()=>{const r=[...document.querySelectorAll('.t3cg tbody tr')].find(t=>!t.classList.contains('t3cg-details-row')&&t.dataset.key&&t.dataset.key!=='*'); r&&r.click()})()`); await sleep(1500); }
await ev(`document.querySelector('.t3cg-file-row').click()`); await sleep(1200);
out.opened = await n();
await ev(`document.querySelector('.t3cg-diff-head [data-act=close]').click()`); await sleep(200);
out.afterBack = await n();
await ev(`document.querySelector('.t3cg-file-row').click()`); await sleep(1200);
out.opened2 = await n();
await ev(`document.querySelector('.t3cg-diff-overlay').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(200);
out.afterEsc = await n();
return out;
