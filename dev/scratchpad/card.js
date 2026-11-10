const { BrowserWindow } = require("electron");
const fs = require("fs");
const w = BrowserWindow.getAllWindows()[0];
const r = await w.webContents.executeJavaScript(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rows = [...document.querySelectorAll(".t3cg tr.t3cg-row[data-i]")];
  const tr = rows[1];
  tr.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await sleep(1200);
  const cards = document.querySelectorAll(".t3cg-card");
  const card = cards[0];
  const c = card.getBoundingClientRect(), p = document.querySelector(".t3cg").getBoundingClientRect(), t = tr.getBoundingClientRect();
  return { count: cards.length, parent: card.parentElement.tagName, shown: !card.hidden, fg: getComputedStyle(card).color, bg: getComputedStyle(card).backgroundColor, card: [c.left, c.top, c.right, c.bottom], panelLeft: p.left, rowTop: t.top,
    shot: { x: Math.max(0, c.left - 20), y: Math.max(0, Math.min(c.top, t.top) - 20), width: Math.min(innerWidth, p.left + 300) - Math.max(0, c.left - 20), height: Math.max(c.bottom, t.bottom) - Math.min(c.top, t.top) + 40 } };
})()`);
const z = w.webContents.getZoomFactor(), s = r.shot;
const img = await w.webContents.capturePage({ x: Math.round(s.x * z), y: Math.round(s.y * z), width: Math.round(s.width * z), height: Math.round(s.height * z) });
fs.writeFileSync(ARGS.out + "/card.png", img.toPNG());
await w.webContents.executeJavaScript(`(() => { const tr = document.querySelectorAll(".t3cg tr.t3cg-row[data-i]")[1]; tr.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); })()`);
await new Promise((r) => setTimeout(r, 300));
r.hiddenAfter = await w.webContents.executeJavaScript(`document.querySelector(".t3cg-card").hidden`);
return r;
