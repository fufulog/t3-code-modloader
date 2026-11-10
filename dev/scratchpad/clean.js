const { BrowserWindow } = require("electron");
return await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(() => { const hs = [...document.body.children].filter(e => e.style.zIndex === "99999" && e.style.width === "700px"); hs.forEach(h => h.remove()); return hs.length; })()`);
