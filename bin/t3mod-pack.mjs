#!/usr/bin/env node
// Pack a mod folder into a single .zip the loader reads from memory.
//
//   t3mod-pack.mjs mods/commit-graph [out.zip]      (default: <folder name>.zip next to the folder)
//
// Files go in at the zip's root (mod.md, mod.cjs, client/...). Dot-files are skipped.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { writeZip } = require(join(dirname(fileURLToPath(import.meta.url)), "../src/main/zip.cjs"));

const src = process.argv[2];
if (!src) {
  console.error("usage: node bin/t3mod-pack.mjs <mod folder> [out.zip]");
  process.exit(1);
}
const dir = resolve(src);
const out = resolve(process.argv[3] ?? join(dirname(dir), basename(dir) + ".zip"));

const entries = [];
(function walk(rel) {
  for (const name of readdirSync(join(dir, rel)).sort()) {
    if (name.startsWith(".")) continue;
    const r = rel ? `${rel}/${name}` : name;
    const st = statSync(join(dir, r));
    if (st.isDirectory()) walk(r);
    else if (st.isFile()) entries.push({ name: r, data: readFileSync(join(dir, r)) });
  }
})("");
if (!entries.some((e) => e.name === "mod.md" || e.name === "mod.cjs")) {
  console.error(`${dir} has no mod.md or mod.cjs; is it a mod folder?`);
  process.exit(1);
}
const zip = writeZip(entries);
writeFileSync(out, zip);
const raw = entries.reduce((n, e) => n + e.data.length, 0);
console.log(`${entries.length} files, ${raw} -> ${zip.length} bytes: ${out}`);
