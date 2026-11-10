const { webContents } = require("electron");
const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith("t3code://"));
const ev = (x) => wc.executeJavaScript(x);
return JSON.stringify(await ev(`(()=>{const cs=[...document.querySelectorAll('diffs-container')]; const c=cs[0]; const sr=c?.shadowRoot; if(!sr) return {cs:cs.length, ov:document.querySelectorAll('.t3cg-diff-overlay').length}; const attrs=new Set(); sr.querySelectorAll('*').forEach(e=>{for(const a of e.getAttributeNames()) if(!a.startsWith('data-line')&&a.startsWith('data-')) attrs.add(a)}); const ex=sr.querySelector('[data-line]'); return {cs:cs.length, attrs:[...attrs].slice(0,60), line: ex?.outerHTML.slice(0,300)}})()`));
