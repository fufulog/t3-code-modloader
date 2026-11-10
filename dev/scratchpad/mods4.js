const { webContents } = require("electron");
const get = () => webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = async (x) => { try { return await get().executeJavaScript(x); } catch (e) { throw new Error("EV FAIL: " + x.slice(0,80) + " :: " + e.message); } };
const shot = async (name) => { const img = await get().capturePage(); require("fs").writeFileSync(ARGS.out+"/"+name+".png", img.toPNG()); };
await ev(`document.querySelector('button[aria-label="Mods"]').click()`); await sleep(700);
await shot("core1");
await ev(`document.querySelector('[data-act=confirm-remove]').click()`); await sleep(300);
await shot("core2");
if (ARGS.go) {
  await ev(`document.querySelector('[data-act=remove]').click()`); await sleep(800);
  await shot("core3");
  await sleep(5500);
  const gone = await ev(`JSON.stringify({btn: !!document.querySelector('button[aria-label="Mods"]'), modal: !!document.querySelector('.t3m-dialog')})`);
  return gone;
}
await ev(`document.querySelector('[data-act=cancel]').click()`);
await ev(`document.querySelector('[data-act=close]').click()`);
return "preview only";
