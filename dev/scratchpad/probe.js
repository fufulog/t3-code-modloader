const { BrowserWindow } = require("electron");
const out = [];
for (const w of BrowserWindow.getAllWindows()) {
  out.push(await w.webContents.executeJavaScript(`(async () => {
    const r = document.querySelector(".t3cg");
    const dark = document.documentElement.classList.contains("dark");
    const map = await fetch("/__t3mod/commit-graph/icons/map.json").then(r => r.status);
    const svg = await fetch("/__t3mod/commit-graph/icons/kotlin.svg").then(r => r.status + " " + r.headers.get("content-type"));
    return { title: document.title, open: !!r, rows: r ? r.querySelectorAll("tr.t3cg-row").length : 0, details: !!document.querySelector(".t3cg-details"), dark, htmlClass: document.documentElement.className, map, svg };
  })()`));
}
return out;
