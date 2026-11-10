const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const ev = (x) => wc.executeJavaScript(x);
const z = wc.getZoomFactor();
const r = await ev(`(()=>{const r=document.querySelector('.t3cg-diff-overlay').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
const img = await wc.capturePage({x:Math.round(r[0]*z),y:Math.round(r[1]*z),width:Math.round(r[2]*z),height:Math.round(Math.min(r[3],500)*z)});
require("fs").writeFileSync(ARGS.out+"/t3-full.png", img.toPNG());
return JSON.stringify(await ev(`({pressed:[...document.querySelectorAll('[data-view]')].map(b=>b.dataset.view+':'+b.getAttribute('aria-pressed')), sep: document.querySelector('diffs-container')?.shadowRoot.querySelectorAll('[data-separator]').length})`));
