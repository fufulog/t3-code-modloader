const { BrowserWindow } = require("electron");
const fs = require("fs");
const wc = BrowserWindow.getAllWindows()[0].webContents;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const z = wc.getZoomFactor();
const js = (s) => wc.executeJavaScript(s, true);
// Record clipboard writes in the page instead of touching the real clipboard.
await js(`window.__t3cgOrigWrite = navigator.clipboard.writeText.bind(navigator.clipboard); window.__t3cgCopied = null; navigator.clipboard.writeText = async (t) => { window.__t3cgCopied = t; }; 0`);
try {
  const row = await js(`(() => { const r = document.querySelectorAll(".t3cg tr.t3cg-row[data-i]")[1].getBoundingClientRect(); return { x: r.x + 200, y: r.y + r.height / 2 }; })()`);
  const move = (p) => wc.sendInputEvent({ type: "mouseMove", x: Math.round(p.x * z), y: Math.round(p.y * z) });
  move({ x: row.x, y: row.y - 30 }); await sleep(50);
  move(row);
  await sleep(1000);
  const btn = await js(`(() => { const b = document.querySelector(".t3cg-card:not([hidden]) .t3cg-copy"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hash: b.dataset.copy }; })()`);
  if (!btn) {
    // fall back to a synthetic hover so the visual can still be checked
    await js(`document.querySelectorAll(".t3cg tr.t3cg-row[data-i]")[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))`);
    await sleep(800);
    return { realHover: false, note: "sendInputEvent hover did not open the card", shown: await js(`!document.querySelector(".t3cg-card").hidden`) };
  }
  for (let i = 1; i <= 8; i++) { move({ x: row.x + (btn.x - row.x) * i / 8, y: row.y + (btn.y - row.y) * i / 8 }); await sleep(15); }
  await sleep(150);
  const card = await js(`(() => { const r = document.querySelector(".t3cg-card").getBoundingClientRect(); return { x: r.x, y: r.bottom - 60, width: r.width, height: 60 }; })()`);
  const shot = async (name) => fs.writeFileSync(`${ARGS.out}/${name}.png`, (await wc.capturePage({ x: Math.round(card.x * z), y: Math.round(card.y * z), width: Math.round(card.width * z), height: Math.round(card.height * z) })).toPNG());
  await shot("copy-hover");
  const pt = { x: Math.round(btn.x * z), y: Math.round(btn.y * z), button: "left", clickCount: 1 };
  wc.sendInputEvent({ type: "mouseDown", ...pt });
  wc.sendInputEvent({ type: "mouseUp", ...pt });
  await sleep(250);
  await shot("copy-done");
  const res = { realHover: true, copied: await js(`window.__t3cgCopied`), hash: btn.hash, cls: await js(`document.querySelector(".t3cg-copy").className`) };
  move({ x: 5, y: 5 });
  return res;
} finally {
  await js(`navigator.clipboard.writeText = window.__t3cgOrigWrite; delete window.__t3cgOrigWrite; delete window.__t3cgCopied;`);
}
