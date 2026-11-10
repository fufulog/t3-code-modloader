const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
const btns = await ev(`(()=>{const sr=document.querySelector('diffs-container').shadowRoot; const host=[...document.querySelectorAll('.t3cg-t3diff *')].find(e=>e.children.length===0&&/spike test comment/.test(e.textContent)); let n=host; for(let i=0;i<6&&n;i++){n=n.parentElement} return [...(host.closest('div[class*=group], div')?.parentElement?.querySelectorAll('button')??[])].map(b=>(b.getAttribute('aria-label')||b.title||b.textContent))})()`);
return JSON.stringify(btns);
