const { BrowserWindow } = require("electron");
return await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const root = document.querySelector(".t3cg");
  const scrolls = () => { const o = []; for (let e = root; e; e = e.parentElement) if (e.scrollLeft) o.push((e.className || e.tagName).toString().slice(0, 40) + ":" + e.scrollLeft); return o; };
  const before = scrolls();
  root.querySelector("[data-act=branches]").click(); await sleep(100);
  const dd = root.querySelector(".t3cg-dd").getBoundingClientRect(), rr = root.getBoundingClientRect();
  const afterOpen = scrolls();
  root.querySelector(".t3cg-dd input[data-all]").click(); await sleep(400);
  const afterAll = scrolls();
  return { before, afterOpen, afterAll, dd: [dd.left, dd.right], root: [rr.left, rr.right] };
})()`, true);
