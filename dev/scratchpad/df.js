const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
const z = wc.getZoomFactor();
const info = await ev(`(()=>{const rows=[...document.querySelectorAll('.t3cg tr[data-hash], .t3cg tr.t3cg-row')]; return rows.length})()`);
// click the first real commit row
await ev(`(()=>{const r=[...document.querySelectorAll('.t3cg tbody tr')].find(t=>!t.classList.contains('t3cg-details-row')&&t.dataset.key&&t.dataset.key!=='*'); r&&r.click()})()`);
await sleep(1500);
const f = await ev(`(()=>{const f=document.querySelector('.t3cg-details [data-file], .t3cg-details .t3cg-file-row, .t3cg-details li'); return f? f.className+'|'+f.outerHTML.slice(0,160):null})()`);
return JSON.stringify({info, f});
