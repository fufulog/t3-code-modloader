const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
return await wc.executeJavaScript(`JSON.stringify({btn: !!document.querySelector('button[aria-label="Mods"]')})`) + " " + JSON.stringify(Object.fromEntries(Object.entries(globalThis.__t3modMain.status).map(([k,v])=>[k,v.ok])));
