const { clipboard, BrowserWindow } = require("electron");
const wc = BrowserWindow.getAllWindows()[0].webContents;
return { formats: clipboard.availableFormats(), text: String(clipboard.readText()).slice(0, 60), cardHidden: await wc.executeJavaScript(`document.querySelector(".t3cg-card").hidden`) };
