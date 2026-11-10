const { BrowserWindow } = require("electron");
const fs = require("fs");
const wc = BrowserWindow.getAllWindows()[0].webContents;
const js = (s) => wc.executeJavaScript(s, true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40 && !(await js(`!!globalThis.__t3mod?.commitGraph?._GraphView`)); i++) await sleep(250);
const z = wc.getZoomFactor();
let out = {};
try {
  await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const host = document.createElement("div");
    host.id = "t3cg-test-host";
    host.style.cssText = "position:fixed;left:0;top:0;width:520px;height:700px;z-index:99999;background:var(--background);display:flex";
    document.body.appendChild(host);
    const s = new globalThis.__t3mod.commitGraph._GraphView(host);
    host._view = s;
    s.setProps({ cwd: ${JSON.stringify(ARGS.repo)}, visible: true });
    for (let i = 0; i < 40 && !s.data; i++) await sleep(100);
    return 0;
  })()`);
  const q = (e) => js(`(() => { const h = document.getElementById("t3cg-test-host"); ${e} })()`);
  const click = async (i) => { await q(`[...h.querySelectorAll("tr.t3cg-row[data-i]")].find(r => r.dataset.i === "${i}").click(); return 0;`); await sleep(700); };
  const state = () => q(`return { open: h.querySelectorAll(".t3cg-details").length, keys: [...h.querySelectorAll(".t3cg-details")].map(d => d.dataset.key.slice(0, 7)), files: [...h.querySelectorAll(".t3cg-details")].map(d => d.querySelectorAll(".t3cg-file-row").length) };`);
  await click(2); out.afterFirst = await state();
  await click(4); out.afterSecond = await state();
  await click(6); out.afterThird = await state();
  fs.writeFileSync(`${ARGS.out}/multi.png`, (await wc.capturePage({ x: 0, y: 0, width: Math.round(520 * z), height: Math.round(700 * z) })).toPNG());
  // open a diff from the second list: it must be that commit's file
  await q(`h.querySelectorAll(".t3cg-details")[1].querySelector("[data-file]").click(); return 0;`); await sleep(800);
  out.diffTitle = await q(`return h.querySelector(".t3cg-diff-title")?.textContent;`);
  out.diffHash = await q(`return h.querySelector(".t3cg-diff-head .t3cg-mono")?.textContent;`);
  out.secondKey = (await state()).keys[1];
  await q(`h.querySelector("[data-act=close]").click(); return 0;`); await sleep(200);
  await click(4); out.afterCloseSecond = await state();
  await q(`h.querySelector(".t3cg").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return 0;`); await sleep(300);
  out.afterEscape = await state();
} finally {
  await js(`(() => { const h = document.getElementById("t3cg-test-host"); h?._view?.destroy(); h?.remove(); return 0; })()`);
}
out.left = await js(`document.querySelectorAll("#t3cg-test-host").length`);
return out;
