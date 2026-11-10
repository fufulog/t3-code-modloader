const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
const z = wc.getZoomFactor();
const n = () => ev(`document.querySelectorAll('.t3cg-diff-overlay').length`);
for (let i = 0; i < 4 && await n(); i++) { await ev(`document.querySelector('.t3cg-diff-head [data-act=close]').click()`); await sleep(200); }
if (!await ev(`!!document.querySelector('.t3cg-file-row')`)) { await ev(`(()=>{const r=[...document.querySelectorAll('.t3cg tr.t3cg-row')].find(t=>!t.classList.contains('t3cg-uncommitted')); r&&r.click()})()`); await sleep(1500); }
await ev(`document.querySelector('.t3cg-file-row').click()`); await sleep(4000);
const shot = async (name) => { const r = await ev(`(()=>{const r=document.querySelector('.t3cg-diff-overlay').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`); const img = await wc.capturePage({x:Math.round(r[0]*z),y:Math.round(r[1]*z),width:Math.round(r[2]*z),height:Math.round(Math.min(r[3],700)*z)}); require("fs").writeFileSync(ARGS.out+"/"+name+".png", img.toPNG()); };
await shot("t3-diff");
const info = await ev(`({t3: !!document.querySelector('.t3cg-t3diff'), kids: document.querySelector('.t3cg-t3diff')?.innerHTML.slice(0,200), plain: !!document.querySelector('.t3cg-diff'), html: document.documentElement.className})`);
return JSON.stringify(info);
