const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (x) => wc.executeJavaScript(x);
await ev(`document.querySelector('.t3cg-t3diff button[aria-label="Delete comment"]')?.click()`);
await sleep(600);
return JSON.stringify(await ev(`({left: document.body.innerText.includes('spike test comment'), chip: document.body.innerText.includes('runtime.js L799')})`));
