const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
return await wc.executeJavaScript(`JSON.stringify({open: !!document.querySelector('.t3m-dialog'), items:[...document.querySelectorAll('.t3m-item')].map(e=>e.dataset.id), foot: document.querySelector('[data-foot]')?.textContent})`);
