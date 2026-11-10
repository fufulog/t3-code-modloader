const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const ev = (x) => wc.executeJavaScript(x);
const z = wc.getZoomFactor();
const info = await ev(`(()=>{const c=document.querySelector('diffs-container');const sr=c?.shadowRoot;const b=document.querySelector('.t3cg-diff-body').getBoundingClientRect();return {sr:!!sr, srHtml:sr?.innerHTML.length, lines:sr?.querySelectorAll('[data-line]').length, body:[b.width,b.height], cont:c&&[c.getBoundingClientRect().width,c.getBoundingClientRect().height]}})()`);
const r = await ev(`(()=>{const r=document.querySelector('.t3cg-diff-overlay').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
const img = await wc.capturePage({x:Math.round(r[0]*z),y:Math.round(r[1]*z),width:Math.round(r[2]*z),height:Math.round(Math.min(r[3],700)*z)});
require("fs").writeFileSync(ARGS.out+"/t3-diff2.png", img.toPNG());
return JSON.stringify({info,r,z});
