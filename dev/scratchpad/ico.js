const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().includes("t3")) || webContents.getAllWebContents()[0];
const info = await wc.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Commit Graph'); if(!b) return null; let p=b; for(let i=0;i<3;i++) p=p.parentElement; const r=p.getBoundingClientRect(); return {rect:[r.x,r.y,r.width,r.height], svg:[...p.querySelectorAll('svg')].map(s=>s.innerHTML.slice(0,200))}; })()`);
if (!info) return "no tab";
const z = wc.getZoomFactor();
const [x,y,w,h] = info.rect;
const img = await wc.capturePage({x:Math.max(0,Math.round((x-20)*z)),y:Math.max(0,Math.round(y*z)),width:Math.round((w+40)*z),height:Math.round(h*z)});
require("fs").writeFileSync(ARGS.out+"/tabicon.png", img.toPNG());
return JSON.stringify(info);
