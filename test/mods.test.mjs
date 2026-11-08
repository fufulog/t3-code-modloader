// Zip reader/writer, mod discovery (folder, zip, zipped folder), in-memory code
// loading, and the enabled-mods config. Touches only temp directories.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { readZip, writeZip } = require("../src/main/zip.cjs");
const { discover, loadCode, parseManifest } = require("../src/main/mods.cjs");

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok   ${name}`);
};
const tmp = mkdtempSync(join(tmpdir(), "t3mod-mods-"));
const put = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const buf = (s) => Buffer.from(s);

test("zip round-trips stored and deflated entries", () => {
  const big = "hello ".repeat(5000);
  const z = readZip(writeZip([{ name: "a.txt", data: buf("tiny") }, { name: "d/b.txt", data: buf(big) }, { name: "empty", data: buf("") }]));
  assert.deepEqual(z.names.sort(), ["a.txt", "d/b.txt", "empty"]);
  assert.equal(z.read("a.txt").toString(), "tiny");
  assert.equal(z.read("d/b.txt").toString(), big);
  assert.equal(z.read("empty").length, 0);
  assert.equal(z.read("nope"), null);
});

test("zip refuses traversal, corruption and non-zips", () => {
  assert.throws(() => readZip(writeZip([{ name: "../evil", data: buf("x") }])), /unsafe path/);
  assert.throws(() => readZip(writeZip([{ name: "/abs", data: buf("x") }])), /unsafe path/);
  const z = writeZip([{ name: "a.txt", data: buf("some content here") }]);
  z[z.indexOf("some content here")] ^= 0xff; // stored entry: flip a byte
  assert.throws(() => readZip(z).read("a.txt"), /checksum/);
  assert.throws(() => readZip(buf("definitely not a zip")), /not a zip/);
});

test("manifest frontmatter", () => {
  const { meta, body } = parseManifest('---\nid: x-y\nname: "X Y"\nversion: 1.2.3\n---\n# Title\n\ntext');
  assert.deepEqual(meta, { id: "x-y", name: "X Y", version: "1.2.3" });
  assert.equal(body, "# Title\n\ntext");
  assert.deepEqual(parseManifest("# no frontmatter").meta, {});
});

const modsDir = join(tmp, "mods");
put(join(modsDir, "folder-mod/mod.md"), "---\nname: Folder Mod\nversion: 1.0.0\nauthor: me\n---\n# Folder\nbody");
put(join(modsDir, "folder-mod/mod.cjs"), 'module.exports = { patches: require("./p.cjs"), data: require("./d.json"), main() {} };');
put(join(modsDir, "folder-mod/p.cjs"), 'module.exports = [{ id: "p", file: /x/, apply: (s) => s + require("node:path").sep }];');
put(join(modsDir, "folder-mod/d.json"), '{"k":1}');
put(join(modsDir, "folder-mod/client/a.js"), "export {}");
// the same mod as a zip: files at the root, and wrapped in a folder
const entriesOf = (dir, prefix = "") =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? entriesOf(join(dir, e.name), `${prefix}${e.name}/`) : [{ name: prefix + e.name, data: readFileSync(join(dir, e.name)) }]));
const files = entriesOf(join(modsDir, "folder-mod"));
writeFileSync(join(modsDir, "flat-zip.zip"), writeZip(files.map((f) => ({ ...f, name: f.name }))));
writeFileSync(join(modsDir, "wrapped.t3mod"), writeZip(files.map((f) => ({ ...f, name: `inner/${f.name}` }))));
put(join(modsDir, "junk/readme.txt"), "not a mod");
put(join(modsDir, ".hidden/mod.md"), "ignored");
put(join(modsDir, "notes.txt"), "ignored");
put(join(modsDir, "BadId/mod.md"), "---\nid: Bad Id!\n---\n");
writeFileSync(join(modsDir, "broken.zip"), "garbage");

test("discovery finds folders, zips, and zipped folders", () => {
  const found = discover(modsDir);
  const byFile = Object.fromEntries(found.map((m) => [m.file, m]));
  assert.deepEqual(Object.keys(byFile).sort(), ["BadId", "broken.zip", "flat-zip.zip", "folder-mod", "junk", "wrapped.t3mod"]);
  assert.equal(byFile["folder-mod"].kind, "folder");
  assert.equal(byFile["folder-mod"].name, "Folder Mod");
  assert.equal(byFile["folder-mod"].version, "1.0.0");
  assert.equal(byFile["folder-mod"].markdown, "# Folder\nbody");
  assert.equal(byFile["folder-mod"].usable, true);
  // flat-zip and wrapped carry the same manifest, so their id (from the file name) is distinct from folder-mod's
  for (const f of ["flat-zip.zip", "wrapped.t3mod"]) {
    assert.equal(byFile[f].kind, "zip");
    assert.equal(byFile[f].usable, true, byFile[f].problems.join());
    assert.equal(byFile[f].name, "Folder Mod");
    assert.equal(byFile[f].markdown, "# Folder\nbody");
  }
  assert.equal(byFile["flat-zip.zip"].id, "flat-zip");
  assert.equal(byFile["wrapped.t3mod"].id, "wrapped");
  for (const f of ["BadId", "broken.zip", "junk"]) {
    assert.equal(byFile[f].usable, false);
    assert.ok(byFile[f].problems.length, f);
  }
  assert.match(byFile.BadId.problems[0], /invalid mod id/);
  assert.match(byFile.junk.problems[0], /no mod\.md/);
});

test("duplicate ids: the first wins, the other is reported", () => {
  const d = join(tmp, "dup");
  put(join(d, "a/mod.md"), "---\nid: same\n---\n");
  put(join(d, "b/mod.md"), "---\nid: same\n---\n");
  const f = discover(d);
  assert.deepEqual(f.map((m) => m.usable), [true, false]);
  assert.match(f[1].problems[0], /duplicate/);
});

test("code loads from a folder and from memory with identical results", () => {
  const found = discover(modsDir);
  for (const file of ["folder-mod", "flat-zip.zip", "wrapped.t3mod"]) {
    const m = found.find((x) => x.file === file);
    const exp = loadCode(m, require);
    assert.deepEqual(exp.data, { k: 1 }, file);
    assert.equal(exp.patches.length, 1, file);
    assert.ok(exp.patches[0].file instanceof RegExp, file);
    assert.equal(exp.patches[0].apply("s"), "s/", file);
    assert.equal(m.files.read("client/a.js").toString(), "export {}", file);
    assert.equal(m.files.read("../mod.md"), null, file);
  }
});

test("mod code may not require packages or escape its folder", () => {
  const d = join(tmp, "sandbox");
  put(join(d, "m1/mod.cjs"), 'require("left-pad");');
  put(join(d, "m2/mod.cjs"), 'require("../../outside");');
  put(join(tmp, "outside.cjs"), "module.exports = 1");
  const [a, b] = discover(d);
  assert.throws(() => loadCode(a, require), /only require node built-ins/);
  assert.throws(() => loadCode(b, require), /cannot find/);
});

test("the shipped Commit Graph mod loads the same from a folder and from a zip", () => {
  const out = join(tmp, "packed");
  mkdirSync(out);
  const zip = join(out, "commit-graph.zip");
  execFileSync(process.execPath, [join(ROOT, "bin/t3mod-pack.mjs"), join(ROOT, "mods/commit-graph"), zip], { stdio: "pipe" });
  const folder = discover(join(ROOT, "mods")).find((m) => m.id === "commit-graph");
  const zipped = discover(out)[0];
  assert.ok(folder.usable && zipped.usable, [...folder.problems, ...zipped.problems].join());
  assert.equal(zipped.id, "commit-graph");
  assert.equal(zipped.version, folder.version);
  const a = loadCode(folder, require);
  const b = loadCode(zipped, require);
  assert.equal(a.patches.length, b.patches.length);
  assert.deepEqual(a.patches.map((p) => p.id), b.patches.map((p) => p.id));
  for (const f of ["client/runtime.js", "client/style.css", "client/icons/map.json"]) {
    assert.ok(folder.files.read(f).equals(zipped.files.read(f)), f);
  }
});

test("config: first run enables everything found; later arrivals start Available", () => {
  const cfg = join(tmp, "config", "config.json");
  process.env.T3MOD_MODS_DIR = modsDir;
  process.env.T3MOD_CONFIG = cfg;
  const { _internals } = require("../src/main/loader.cjs");
  const first = _internals.loadMods();
  const ids = (r) => r.mods.map((m) => m.name).sort();
  assert.deepEqual(ids(first), ["core", "flat-zip", "folder-mod", "wrapped"]);
  assert.deepEqual(JSON.parse(readFileSync(cfg, "utf8")).enabled, ["flat-zip", "folder-mod", "wrapped"]);
  put(join(modsDir, "late/mod.md"), "---\nname: Late\n---\n");
  assert.deepEqual(ids(_internals.loadMods()), ["core", "flat-zip", "folder-mod", "wrapped"]); // `late` is not enabled
  writeFileSync(cfg, JSON.stringify({ enabled: ["late"] }));
  assert.deepEqual(ids(_internals.loadMods()), ["core", "late"]);
  assert.deepEqual(ids(_internals.loadMods({ all: true })), ["core", "flat-zip", "folder-mod", "late", "wrapped"]);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} tests passed`);
