const { BrowserWindow } = require("electron");
const fs = require("fs");
const wc = BrowserWindow.getAllWindows()[0].webContents;
const z = wc.getZoomFactor();
const js = (s) => wc.executeJavaScript(s, true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40 && !(await js(`!!globalThis.__t3mod?.commitGraph?._GraphView`)); i++) await sleep(250);
await js(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const host = document.createElement("div");
  host.id = "t3cg-test-host";
  host.style.cssText = "position:fixed;left:0;top:0;width:420px;height:560px;z-index:99999;background:var(--background);display:flex";
  document.body.appendChild(host);
  try {
    const s = new globalThis.__t3mod.commitGraph._GraphView(host);
    host._view = s;
    s.setProps({ cwd: ${JSON.stringify(ARGS.repo)}, visible: true });
    for (let i = 0; i < 40 && !s.data; i++) await sleep(100);
    await sleep(200);
    const expand = ${JSON.stringify(ARGS.expand ?? null)};
    if (expand !== null) { host.querySelectorAll("tr.t3cg-row[data-i]")[Number(expand)].click(); await sleep(600); }
  } catch (e) { host._err = String(e); }
  return 0;
})()`);
const err = await js(`document.getElementById("t3cg-test-host")._err ?? null`);
try {
  fs.writeFileSync(`${ARGS.out}/${ARGS.name}.png`, (await wc.capturePage({ x: 0, y: 0, width: Math.round(420 * z), height: Math.round(560 * z) })).toPNG());
} finally {
  await js(`(() => { const h = document.getElementById("t3cg-test-host"); h?._view?.destroy(); h?.remove(); return 0; })()`);
}
return { err, left: await js(`document.querySelectorAll("#t3cg-test-host").length`) };
