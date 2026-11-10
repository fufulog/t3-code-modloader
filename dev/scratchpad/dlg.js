const { BrowserWindow } = require("electron");
const fs = require("fs");
const wc = BrowserWindow.getAllWindows()[0].webContents;
const z = wc.getZoomFactor();
return await wc.executeJavaScript(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:700px;height:400px;z-index:99999;background:var(--background)";
  document.body.appendChild(host);
  const out = {};
  let s;
  try {
    s = new globalThis.__t3mod.commitGraph._GraphView(host);
    s.setProps({ cwd: ${JSON.stringify(ARGS.repo)}, visible: true });
    for (let i = 0; i < 40 && !s.data; i++) await sleep(100);
    s.pushCurrent(); await sleep(150);
    out.push = host.querySelector(".t3cg-overlay")?.innerText;
    out.pushRemote = host.querySelector(".t3cg-overlay select")?.value;
    out.pushUpstreamChecked = host.querySelector(".t3cg-overlay input[type=checkbox]")?.checked;
    host.querySelector(".t3cg-overlay [data-act=cancel]").click(); await sleep(100);
    s.pullCurrent(); await sleep(150);
    out.pull = host.querySelector(".t3cg-overlay")?.innerText;
    host.querySelector(".t3cg-overlay [data-act=cancel]").click(); await sleep(100);
  } finally {
    s?.destroy(); host.remove();
  }
  out.leftovers = document.querySelectorAll(".t3cg").length + " views, " + document.querySelectorAll(".t3cg-card").length + " cards";
  return out;
})()`, true);
