const { BrowserWindow } = require("electron");
const wc = BrowserWindow.getAllWindows()[0].webContents;
const z = wc.getZoomFactor();
const js = (s) => wc.executeJavaScript(s, true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 20 && !(await js(`!!document.querySelector(".t3cg tr.t3cg-row")`)); i++) await sleep(250);
const out = {};
for (const act of ["branches", "menu"]) {
  const b = await js(`(() => { const r = document.querySelector(".t3cg [data-act=${act}]").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const click = async () => {
    const pt = { x: Math.round(b.x * z), y: Math.round(b.y * z), button: "left", clickCount: 1 };
    wc.sendInputEvent({ type: "mouseDown", ...pt });
    wc.sendInputEvent({ type: "mouseUp", ...pt });
    await sleep(200);
    return js(`document.querySelectorAll(".t3cg-dd").length`);
  };
  out[act] = [await click(), await click(), await click(), await click()];
}
wc.sendInputEvent({ type: "mouseMove", x: 5, y: 5 });
return out;
