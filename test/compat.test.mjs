// Compatibility manifest: pure checkCompat, plus the loader keeping a declared-incompatible mod off.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { checkCompat, majorOf, FIELD } = require("../src/main/compat.cjs");
const { parseManifest, discover } = require("../src/main/mods.cjs");
const { _internals } = require("../src/main/loader.cjs");

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok   ${name}`);
};
const quiet = () => {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(m) };
};

test("compatible by default (no field, any version)", () => {
  const q = quiet();
  for (const v of ["1.0.0", "2.4.1", "99.0.0", "", undefined]) assert.deepEqual(checkCompat({}, v, q.warn), { compatible: true });
  assert.deepEqual(checkCompat(undefined, "2.0.0", q.warn), { compatible: true });
  assert.deepEqual(checkCompat({ [FIELD]: "" }, "2.0.0", q.warn), { compatible: true });
  assert.deepEqual(q.warnings, []);
});

test("declared-incompatible major is refused with a reason", () => {
  const r = checkCompat({ [FIELD]: "2, 3" }, "2.4.1");
  assert.equal(r.compatible, false);
  assert.equal(r.reason, "Not compatible with T3 2.x");
  assert.equal(checkCompat({ [FIELD]: "3" }, "v3.0.0-nightly.20261108").compatible, false);
  assert.equal(checkCompat({ [FIELD]: [2] }, "2.0.0").compatible, false); // array form
  assert.equal(checkCompat({ [FIELD]: "[2, 3]" }, "3.1.0").compatible, false); // bracket form
});

test("other majors stay compatible", () => {
  assert.deepEqual(checkCompat({ [FIELD]: "2, 3" }, "1.9.9"), { compatible: true });
  assert.deepEqual(checkCompat({ [FIELD]: "2" }, "20.0.0"), { compatible: true }); // 20 is not 2
  assert.deepEqual(checkCompat({ [FIELD]: "2" }, "3.0.0"), { compatible: true });
});

test("malformed field fails open with a warning", () => {
  for (const bad of ["two", "2.x", "2, abc", "-1", "1.5", {}, true, [2, "x"], [1.5]]) {
    const q = quiet();
    assert.deepEqual(checkCompat({ [FIELD]: bad }, "2.0.0", q.warn), { compatible: true }, JSON.stringify(bad));
    assert.equal(q.warnings.length, 1, JSON.stringify(bad));
  }
});

test("unparsable T3 version fails open with a warning", () => {
  for (const bad of ["", "banana", "x.2.0", null, undefined, 2, {}]) {
    const q = quiet();
    assert.deepEqual(checkCompat({ [FIELD]: "2" }, bad, q.warn), { compatible: true });
    assert.equal(q.warnings.length, 1);
  }
  assert.equal(majorOf("2.1.0"), 2);
  assert.equal(majorOf("v10.0.0-rc.1"), 10);
  assert.equal(majorOf("2abc"), null);
});

test("never throws, even on hostile input or a throwing warn callback", () => {
  const hostile = { get [FIELD]() { throw new Error("boom"); } };
  const q = quiet();
  assert.deepEqual(checkCompat(hostile, "2.0.0", q.warn), { compatible: true });
  assert.equal(q.warnings.length, 1);
  assert.deepEqual(checkCompat(hostile, "2.0.0", () => { throw new Error("warn boom"); }), { compatible: true });
  assert.deepEqual(checkCompat({ [FIELD]: "x" }, "2.0.0", () => { throw new Error("warn boom"); }), { compatible: true });
  for (const m of [null, 0, "str", [], Symbol.iterator, () => {}]) assert.doesNotThrow(() => checkCompat(m, "2.0.0"));
  assert.doesNotThrow(() => checkCompat({ [FIELD]: Symbol("s") }, Symbol("v")));
});

test("frontmatter field reaches the check through mod.md", () => {
  const { meta } = parseManifest("---\nname: X\nincompatible-t3-majors: 2, 3\n---\nbody");
  assert.equal(meta[FIELD], "2, 3");
  assert.equal(checkCompat(meta, "3.2.0").compatible, false);
  assert.equal(checkCompat(meta, "4.0.0").compatible, true);
});

test("loader keeps a declared-incompatible mod off and reports why", () => {
  const dir = mkdtempSync(join(tmpdir(), "t3mod-compat-"));
  const put = (f, t) => {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), t);
  };
  put("old-mod/mod.md", "---\nname: Old\nincompatible-t3-majors: 2\n---\nx");
  put("old-mod/mod.cjs", "globalThis.__compatLoaded = (globalThis.__compatLoaded ?? 0) + 1; module.exports = {};");
  put("any-mod/mod.md", "---\nname: Any\n---\nx");
  put("any-mod/mod.cjs", "module.exports = {};");
  process.env.T3MOD_MODS_DIR = dir;
  const load = (v) => _internals.loadMods({ all: true, t3Version: v });
  let r = load("2.1.0");
  const old = r.found.find((m) => m.id === "old-mod");
  assert.equal(old.compat.compatible, false);
  assert.equal(old.compat.reason, "Not compatible with T3 2.x");
  assert.deepEqual(r.mods.map((m) => m.name).sort(), ["any-mod", "core"]);
  assert.equal(globalThis.__compatLoaded, undefined, "incompatible mod code must not run");
  r = load("3.0.0");
  assert.deepEqual(r.mods.map((m) => m.name).sort(), ["any-mod", "core", "old-mod"]);
  r = load(""); // unreadable version: fail open
  assert.ok(r.mods.some((m) => m.name === "old-mod"));
  assert.equal(discover(dir).length, 2);
});

console.log(`\n${n} tests passed`);
