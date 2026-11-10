const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
if (!await ev(`!!document.querySelector('.t3m-cols')`)) { await ev(`document.querySelector('button[aria-label="Mods"]').click()`); await sleep(1500); }
const q = `(()=>{const b=document.querySelector('[data-act=rescan]');return {cls:b.className, anim:getComputedStyle(b.querySelector('svg')).animationName, tf:getComputedStyle(b.querySelector('svg')).transform}})()`;
await ev(`document.querySelector('[data-act=rescan]').click()`);
const during = [await ev(q)]; await sleep(250); during.push(await ev(q));
await sleep(900);
return JSON.stringify({during, after: await ev(q)});
