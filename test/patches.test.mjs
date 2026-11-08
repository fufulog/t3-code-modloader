// Applies every mod's patches to a T3 Code client asset directory and checks
// that each anchor matches once and the patched chunks still parse.
//
//   node test/patches.test.mjs [clientDir]
// clientDir defaults to the running AppImage's apps/server/dist/client (extracted
// with `npx @electron/asar extract`) or $T3_CLIENT_DIR.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = process.argv[2] ?? process.env.T3_CLIENT_DIR;
if (!clientDir) {
  console.error("usage: node test/patches.test.mjs <extracted apps/server/dist/client dir>");
  process.exit(2);
}
const assets = join(clientDir, "assets");
const files = readdirSync(assets).filter((f) => f.endsWith(".js"));
const { _internals } = require(join(ROOT, "src/main/loader.cjs"));
const mods = _internals.loadMods({ all: true }).mods;

let failed = 0;
const verdicts = _internals.verifyMods(clientDir, mods);
for (const [name, v] of Object.entries(verdicts)) {
  if (!v.ok) {
    failed++;
    console.error(`FAIL ${name}: ${v.problems.join("; ")}`);
  }
}
const out = mkdtempSync(join(tmpdir(), "t3mod-test-"));
for (const f of files) {
  const src = readFileSync(join(assets, f), "utf8");
  const { text, applied } = _internals.patchChunk(`/assets/${f}`, src, mods, verdicts);
  if (!applied.length) continue;
  const target = join(out, f.replace(/\.js$/, ".mjs"));
  writeFileSync(target, text);
  try {
    execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
    console.log(`ok   ${f}  +${text.length - src.length} bytes (${applied.join(",")})`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${f} does not parse:\n${e.stderr}`);
  }
}
// Every commit-graph insertion point must be present.
const expectations = {
  rightPanelStore: ["case`commit-graph`:return{id:`commit-graph`", "case`pull-requests`:case`commit-graph`:return"],
  PanelLayoutControls: ["case`commit-graph`:return`Commit Graph`", "case`commit-graph`:return globalThis", "?.menuItems("],
  main: ["label:`Mods`,onClick:()=>globalThis.__t3mod?.core?.open?.()", 'import "/__t3mod/core/runtime.js"'],
  _chat: ["?.bindOpener(", "case`commit-graph`:return globalThis"],
};
for (const [prefix, needles] of Object.entries(expectations)) {
  const f = files.find((x) => x.startsWith(prefix + "-"));
  const text = _internals.patchChunk(`/assets/${f}`, readFileSync(join(assets, f), "utf8"), mods, verdicts).text;
  for (const n of needles) {
    if (!text.includes(n)) {
      failed++;
      console.error(`FAIL ${prefix}: missing ${n}`);
    }
  }
  const menus = (text.match(/\?\.menuItems\(/g) ?? []).length;
  if (prefix === "PanelLayoutControls" && menus !== 2) {
    failed++;
    console.error(`FAIL launcher+add menu: expected 2 menu insertions, got ${menus}`);
  }
}
console.log(failed ? `\n${failed} failure(s)` : "\nall patches ok");
process.exit(failed ? 1 : 0);
