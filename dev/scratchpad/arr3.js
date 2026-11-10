const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
const z = wc.getZoomFactor();
if (!await ev(`!!document.querySelector('.t3m-cols')`)) { await ev(`document.querySelector('button[aria-label="Mods"]').click()`); await sleep(1500); await ev(`document.querySelector('[data-act=rescan]').click()`); await sleep(1000); }
const r = await ev(`(()=>{const r=document.querySelector('.t3m-dialog').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
const img = await wc.capturePage({x:Math.round(r[0]*z),y:Math.round(r[1]*z),width:Math.round(r[2]*z),height:Math.round(r[3]*z/2)});
require("fs").writeFileSync(ARGS.out+"/arr3.png", img.toPNG());
return JSON.stringify(r);
