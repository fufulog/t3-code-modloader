const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
return await wc.executeJavaScript(`({url:location.href.slice(0,60), root:!!document.querySelector('.t3cg'), rows:document.querySelectorAll('.t3cg tbody tr').length, keys:[...document.querySelectorAll('.t3cg tbody tr')].slice(0,3).map(t=>t.className+'|'+t.dataset.key), files:document.querySelectorAll('.t3cg-file-row').length, overlays:document.querySelectorAll('.t3cg-diff-overlay').length})`);
