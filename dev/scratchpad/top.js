const { BrowserWindow } = require("electron");
const wc = BrowserWindow.getAllWindows()[0].webContents;
const r = await wc.executeJavaScript(`(() => { const c = document.querySelector(".t3cg").getBoundingClientRect(); return { x: c.x, y: c.y, width: c.width, height: 200, th: document.querySelectorAll(".t3cg th").length, rows: document.querySelectorAll(".t3cg tr.t3cg-row").length }; })()`);
const z = wc.getZoomFactor();
require("fs").writeFileSync(ARGS.out + "/top.png", (await wc.capturePage({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.round(r.width * z), height: Math.round(r.height * z) })).toPNG());
return { th: r.th, rows: r.rows };
