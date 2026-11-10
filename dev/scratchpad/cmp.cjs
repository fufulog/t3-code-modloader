const asar = require("../../src/install/asar.cjs");
const [a, b] = process.argv.slice(2);
const ha = asar.readHeader(a).header, hb = asar.readHeader(b).header;
let same = 0, diff = [];
(function walk(n, m, p) {
  for (const [k, v] of Object.entries(n.files ?? {})) {
    const w = m.files?.[k]; const q = p + k;
    if (v.files) { walk(v, w ?? {}, q + "/"); continue; }
    if (v.unpacked) continue;
    if (!w) { diff.push("missing " + q); continue; }
    asar.readFile(a, q).equals(asar.readFile(b, q)) ? same++ : diff.push(q);
  }
})(ha, hb, "");
console.log({ same, diff });
const m = JSON.parse(asar.readFile(b, "package.json")).main;
console.log(m, JSON.stringify(asar.readFile(b, m).toString().slice(0, 200)));
