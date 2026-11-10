const asar = require("../../src/install/asar.cjs");
const fs = require("fs"), path = require("path");
const [src, out] = process.argv.slice(2);
const h = asar.readHeader(src).header;
let n = 0;
(function walk(node, p) {
  for (const [k, v] of Object.entries(node.files ?? {})) {
    const q = p ? p + "/" + k : k;
    if (v.files) { walk(v, q); continue; }
    if (!q.startsWith("apps/server/dist/client/") || !/\.(js|css|html)$/.test(q)) continue;
    const dest = path.join(out, q); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, asar.readFile(src, q)); n++;
  }
})(h, "");
console.log(n, "files");
