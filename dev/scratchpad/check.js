const { BrowserWindow } = require("electron");
const fs = require("fs");
const w = BrowserWindow.getAllWindows()[0];
const js = (s) => w.webContents.executeJavaScript(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// expand the oldest commit (most files)
await js(`(() => { const rows = [...document.querySelectorAll(".t3cg tr.t3cg-row[data-i]")]; rows.at(-1).click(); })()`);
await sleep(800);
const info = await js(`(() => {
  const d = document.querySelector(".t3cg-details");
  const files = [...d.querySelectorAll(".t3cg-file-row")].map(r => [r.querySelector(".t3cg-fname").textContent, r.querySelector("img")?.src.split("/").pop(), r.querySelector(".t3cg-st").textContent, getComputedStyle(r.querySelector(".t3cg-fname")).color, getComputedStyle(r.querySelector(".t3cg-st")).color]);
  const closeBtn = !!d.querySelector("[data-act=close-details]");
  const imgsOk = [...d.querySelectorAll("img")].every(i => i.complete && i.naturalWidth > 0);
  const root = document.querySelector(".t3cg").getBoundingClientRect();
  return { files, closeBtn, imgsOk, rect: { x: root.x, y: root.y, width: root.width, height: Math.min(root.height, 520) } };
})()`);
const z = w.webContents.getZoomFactor();
const r = info.rect;
const img = await w.webContents.capturePage({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.round(r.width * z), height: Math.round(r.height * z) });
fs.writeFileSync(ARGS.out + "/files.png", img.toPNG());
// hover the row above the expanded one -> card; then move onto the file list
const hover = await js(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rows = [...document.querySelectorAll(".t3cg tr.t3cg-row[data-i]")];
  const tr = rows.at(-1);
  tr.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await sleep(1200);
  const card = document.querySelector(".t3cg-card");
  const shown = !card.hidden, passthru = card.classList.contains("t3cg-card-passthru");
  tr.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.querySelector(".t3cg-details") }));
  document.querySelector(".t3cg-details .t3cg-file-row").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await sleep(50);
  const hiddenAfter = card.hidden;
  // collapse again to leave the panel as it was
  tr.click();
  await sleep(200);
  return { shown, passthru, hiddenAfter, detailsLeft: !!document.querySelector(".t3cg-details") };
})()`);
return { ...info, hover, rect: undefined };
