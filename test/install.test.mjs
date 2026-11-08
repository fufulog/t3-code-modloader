// asar patching, the bootstrap block, and install/uninstall against a synthetic T3
// install (no real T3 is touched; state goes to temp dirs).
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const asar = require("../src/install/asar.cjs");
const inst = require("../src/install/install.cjs");
const { resolveTarget } = require("../src/install/targets.cjs");

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok   ${name}`);
};
const tmp = mkdtempSync(join(tmpdir(), "t3mod-install-"));
process.env.T3MOD_CONFIG_DIR = join(tmp, "cfg");
process.env.T3MOD_DATA_DIR = join(tmp, "data");
const buf = (s) => Buffer.from(s);

const ENTRY = 'apps/desktop/dist-electron/boot.cjs';
const BOOT = '"use strict";\nrequire("./main.cjs");\n';
const files = {
  "package.json": buf(JSON.stringify({ name: "t3code", version: "9.9.9", main: ENTRY })),
  [ENTRY]: buf(BOOT),
  "apps/desktop/dist-electron/main.cjs": buf("module.exports = 1;\n"),
  "big.bin": Buffer.alloc(9 * 1024 * 1024, 7), // spans several integrity blocks
};
const makeInstall = (name) => {
  const root = join(tmp, name);
  mkdirSync(join(root, "resources"), { recursive: true });
  writeFileSync(join(root, "resources", "app.asar"), asar.build(files));
  writeFileSync(join(root, "t3code"), "binary");
  return root;
};

test("asar: replacing one file keeps every other file intact", () => {
  const f = join(tmp, "a.asar");
  const g = join(tmp, "b.asar");
  writeFileSync(f, asar.build(files));
  asar.replaceFile(f, g, ENTRY, buf("// new\n" + BOOT));
  assert.equal(asar.readFile(g, ENTRY).toString(), "// new\n" + BOOT);
  for (const k of Object.keys(files)) if (k !== ENTRY) assert.ok(asar.readFile(g, k).equals(files[k]), k);
  const node = asar.lookup(asar.readHeader(g).header, ENTRY);
  assert.equal(node.integrity.hash.length, 64);
  assert.throws(() => asar.replaceFile(f, g, "missing.js", buf("x")), /not in/);
  assert.throws(() => asar.readHeader(join(tmp, "package.json")), /./);
});

test("bootstrap block: injected after use strict, idempotent, removable byte for byte", () => {
  const once = inst.inject(BOOT, null);
  assert.ok(once.startsWith('"use strict";\n/*t3mod:begin*/try{require('));
  assert.equal(inst.inject(once, null), once);
  assert.equal(inst.inject(once, "/x/launcher"), inst.inject(BOOT, "/x/launcher"));
  assert.equal(inst.strip(once), BOOT);
  const plain = 'require("./a");\n';
  assert.ok(inst.inject(plain, null).startsWith("/*t3mod:begin*/"));
  assert.equal(inst.strip(inst.inject(plain, null)), plain);
  assert.throws(() => inst.strip("/*t3mod:begin*/ no end"), /not its end/);
  new Function(inst.inject(BOOT, "/x"));
});

test("targets: a folder with resources/app.asar, and not-T3 paths", () => {
  const root = makeInstall("T3 Code");
  const t = resolveTarget(root);
  assert.equal(t.kind, "dir");
  assert.equal(t.version, "9.9.9");
  assert.equal(resolveTarget(join(root, "resources", "app.asar")).root, t.root);
  assert.equal(resolveTarget(join(tmp, "nope")), null);
  assert.equal(resolveTarget(tmp)?.asar, t.asar);
  mkdirSync(join(tmp, "empty"));
  assert.equal(resolveTarget(join(tmp, "empty")), null);
});

test("install patches app.asar in place, uninstall restores it byte for byte", () => {
  const root = makeInstall("inst1");
  const asarFile = join(root, "resources", "app.asar");
  const original = readFileSync(asarFile);
  inst.install(resolveTarget(root));
  assert.ok(inst.isPatched(asarFile));
  assert.ok(readFileSync(asarFile + ".t3mod-backup").equals(original));
  assert.ok(asar.readFile(asarFile, "big.bin").equals(files["big.bin"]));
  assert.ok(inst.status().installed);
  assert.ok(inst.status().changes[0].present);
  const steps = inst.uninstall();
  assert.ok(steps.every((s) => s.ok), JSON.stringify(steps));
  assert.ok(readFileSync(asarFile).equals(original));
  assert.equal(existsSync(asarFile + ".t3mod-backup"), false);
  assert.equal(inst.status().installed, false);
  assert.match(inst.uninstall()[0].label, /Nothing to restore/);
});

test("uninstall still works when the backup is gone (strips the block)", () => {
  const root = makeInstall("inst2");
  const asarFile = join(root, "resources", "app.asar");
  inst.install(resolveTarget(root));
  rmSync(asarFile + ".t3mod-backup");
  inst.uninstall();
  assert.equal(inst.isPatched(asarFile), false);
  assert.equal(asar.readFile(asarFile, ENTRY).toString(), BOOT);
});

test("install refuses an asar-integrity build, and a second install replaces the first", () => {
  const root = makeInstall("inst3");
  const asarFile = join(root, "resources", "app.asar");
  const original = readFileSync(asarFile);
  // fake Electron binary whose fuse wire says EmbeddedAsarIntegrityValidation is on
  const fuseOn = Buffer.concat([buf("junk"), buf("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"), Buffer.from([1, 6]), buf("101110")]);
  writeFileSync(join(root, "t3code"), fuseOn);
  assert.equal(inst.readFuses(join(root, "t3code")).EmbeddedAsarIntegrityValidation, true);
  assert.throws(() => inst.install(resolveTarget(root)), /integrity/);
  assert.ok(readFileSync(asarFile).equals(original), "a refused install changes nothing");
  assert.equal(inst.status().installed, false);
  inst.install(resolveTarget(root), { force: true });
  inst.install(resolveTarget(root), { force: true }); // reinstall
  assert.equal(inst.status().changes.length, 1);
  inst.uninstall();
  assert.ok(readFileSync(asarFile).equals(original));
});

test("a failed install is rolled back", () => {
  const root = makeInstall("inst4");
  const asarFile = join(root, "resources", "app.asar");
  writeFileSync(asarFile + ".t3mod-backup", "occupied");
  const original = readFileSync(asarFile);
  assert.throws(() => inst.install(resolveTarget(root)), /exists already/);
  assert.ok(readFileSync(asarFile).equals(original));
  assert.equal(readFileSync(asarFile + ".t3mod-backup", "utf8"), "occupied");
  assert.equal(existsSync(asarFile + ".t3mod-new"), false);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} tests passed`);
