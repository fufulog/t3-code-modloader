const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const ev = (x) => wc.executeJavaScript(x);
const img = await wc.capturePage();
require("fs").writeFileSync(ARGS.out+"/t3-win2.png", img.toPNG());
return JSON.stringify(await ev(`({ta: document.querySelector('.t3cg-t3diff textarea')?.value, txt: [...document.querySelectorAll('*')].filter(e=>e.children.length===0 && /spike test/.test(e.textContent)).map(e=>e.tagName+'.'+e.className.toString().slice(0,60))})`));
