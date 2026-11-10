const { BrowserWindow } = require("electron");
return await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`document.querySelectorAll(".t3cg").length + " views, " + document.querySelectorAll(".t3cg-card").length + " cards, fixed hosts: " + [...document.body.children].filter(e => e.style.zIndex === "99999").length`);
