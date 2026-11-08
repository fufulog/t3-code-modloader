#!/usr/bin/env node
// Copy the file-type icons of Material Icon Theme (MIT, the icon set VS Code users know)
// into the Commit Graph mod: only the icons that files map to, no folder icons.
//
//   npm pack material-icon-theme@5.40.0 && tar xzf material-icon-theme-5.40.0.tgz
//   node bin/vendor-icons.mjs ./package
//
// Writes mods/commit-graph/client/icons/{*.svg,map.json,LICENSE}, replacing what is there.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkg = process.argv[2];
if (!pkg) {
  console.error("usage: node bin/vendor-icons.mjs <extracted material-icon-theme package dir>");
  process.exit(1);
}
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../mods/commit-graph/client/icons");
const { version } = JSON.parse(readFileSync(path.join(pkg, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(pkg, "dist/material-icons.json"), "utf8"));

const used = new Map(); // icon id -> svg file name
const iconFile = (id) => {
  const def = manifest.iconDefinitions[id];
  if (!def) throw new Error(`no icon definition for ${id}`);
  const name = path.basename(def.iconPath);
  if (!/^[\w.-]+\.svg$/.test(name)) throw new Error(`unexpected icon path ${def.iconPath}`);
  used.set(id, name);
  return name.slice(0, -4);
};
const mapAll = (table = {}) => Object.fromEntries(Object.entries(table).map(([k, id]) => [k.toLowerCase(), iconFile(id)]));

const map = {
  version,
  file: iconFile(manifest.file),
  ext: mapAll(manifest.fileExtensions),
  names: mapAll(manifest.fileNames),
  light: { ext: mapAll(manifest.light?.fileExtensions), names: mapAll(manifest.light?.fileNames) },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const name of new Set(used.values())) copyFileSync(path.join(pkg, "icons", name), path.join(OUT, name));
copyFileSync(path.join(pkg, "LICENSE"), path.join(OUT, "LICENSE"));
writeFileSync(path.join(OUT, "map.json"), JSON.stringify(map));
console.log(`material-icon-theme ${version}: ${new Set(used.values()).size} icons -> ${path.relative(process.cwd(), OUT)}`);
