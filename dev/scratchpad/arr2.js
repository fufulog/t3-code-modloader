const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const ev = (x) => wc.executeJavaScript(x);
const z = wc.getZoomFactor();
const r = await ev(`(()=>{const e=document.querySelector('.t3m-cols'); if(!e) return null; e.scrollIntoView(); const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
if (!r) return "no modal";
const img = await wc.capturePage({x:Math.round(r[0]*z),y:Math.round(r[1]*z),width:Math.round(r[2]*z),height:Math.round(r[3]*z)});
require("fs").writeFileSync(ARGS.out+"/arr2.png", img.toPNG());
return JSON.stringify(r);
