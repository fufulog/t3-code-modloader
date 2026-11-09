// Anchor declarations and checks, and the status the Mods window gets through the loader.
// Everything runs against a stub T3 client in a temp dir and a fake `electron`; no real T3 is touched.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const anchors = require("../src/main/anchors.cjs");

const out = (...a) => process.stdout.write(a.join(" ") + "\n");
console.log = () => {}; // the loader logs every verdict; keep the test output readable
let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  out(`ok   ${name}`);
};
const tmp = mkdtempSync(join(tmpdir(), "t3mod-anchors-"));
const put = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

// ---- a stub T3 client ---------------------------------------------------------------------------
const client = join(tmp, "app", "apps/server/dist/client");
put(join(client, "assets/store-1.js"), "case`pull-requests`:return{id:`pull-requests`};");
put(join(client, "assets/panel-1.js"), "label:`Pull request`;label:`Pull request`;");
put(join(client, "assets/main-1.js"), "// no Usage button here");
const chunkNames = ["store-1.js", "panel-1.js", "main-1.js"];
const readChunk = (f) => require("node:fs").readFileSync(join(client, "assets", f), "utf8");
const fakeElectron = { ipcMain: { handle() {}, removeHandler() {}, on: 1 }, shell: null };
const fakeRequire = (m) => {
  if (m === "electron") return fakeElectron;
  return require(m);
};

const patches = [
  { id: "store", file: /^store-/, apply: (s) => s.replace("pull-requests", "x") + ";" },
  { id: "panel", file: /^panel-/, apply: (s) => (s.includes("Pull request") ? s : (() => { throw new Error("anchor matched 0x (want 1)"); })()) },
  { id: "extra", optional: true, file: /^panel-/, apply: () => { throw new Error("extra anchor gone"); } },
];
const { _internals } = require("../src/main/loader.cjs");
const patchResultsFor = (mod) => _internals.verifyMods(client, [{ name: "m", patches: mod.patches }]).m.patchAnchors;

const goodMod = () => ({
  patches,
  anchors: [
    { name: "store", kind: "patch", description: "store factory" },
    { name: "extra", kind: "patch", fallback: "plain view" },
    { name: "pull-request-label", kind: "chunk", file: /^panel-/, contains: "label:`Pull request`", min: 2, max: 2 },
    { name: "ipc-handle", kind: "main-export", module: "electron", path: "ipcMain.handle", type: "function" },
    { name: "has-store-chunk", kind: "check", check: ({ chunkNames: names }) => names.some((f) => f.startsWith("store-")) },
    { name: "bridge", kind: "renderer-global", path: "desktopBridge.showContextMenu", type: "function" },
    { name: "sidebar", kind: "renderer-selector", selector: "[data-sidebar]", min: 1 },
    { name: "props", kind: "renderer-reported" },
  ],
});
const check = (mod, ctx = {}) => anchors.checkStatic(mod, { require: fakeRequire, chunkNames, readChunk, patchResults: ctx.patchResults ?? patchResultsFor(mod), ...ctx });
const byName = (rs) => Object.fromEntries(rs.map((r) => [r.name, r]));

test("all static anchors present: each is named and answers present", () => {
  const r = byName(check(goodMod()));
  for (const name of ["store", "pull-request-label", "ipc-handle", "has-store-chunk"]) assert.equal(r[name].state, "present", name);
  assert.equal(r.store.kind, "patch");
  assert.equal(r.store.description, "store factory");
  // the patch the mod did not declare shows up anyway, under its patch id
  assert.equal(r.panel.state, "present");
  assert.equal(r.panel.kind, "patch");
  // the optional patch that misses keeps its fallback text and is flagged optional
  assert.equal(r.extra.state, "missing");
  assert.equal(r.extra.optional, true);
  assert.equal(r.extra.fallback, "plain view");
  assert.match(r.extra.reason, /extra anchor gone/);
});

test("one anchor missing: it is named, with the reason, and the others are untouched", () => {
  const mod = goodMod();
  mod.anchors.push({ name: "usage-button", kind: "chunk", file: /^main-/, contains: "label:`Usage`" });
  mod.anchors.push({ name: "ipc-gone", kind: "main-export", module: "electron", path: "ipcMain.vanished", type: "function" });
  mod.anchors.push({ name: "ipc-wrong-type", kind: "main-export", module: "electron", path: "ipcMain.on", type: "function" });
  mod.anchors.push({ name: "no-chunk", kind: "chunk", file: /^nothing-/, contains: "x" });
  mod.anchors.push({ name: "check-false", kind: "check", check: () => ({ ok: false, reason: "layout changed" }) });
  const r = byName(check(mod));
  assert.equal(r["usage-button"].state, "missing");
  assert.match(r["usage-button"].reason, /found 0 match\(es\) in main-1\.js/);
  assert.equal(r["ipc-gone"].state, "missing");
  assert.match(r["ipc-gone"].reason, /electron\.ipcMain\.vanished does not exist/);
  assert.equal(r["ipc-wrong-type"].state, "missing");
  assert.match(r["no-chunk"].reason, /no chunk matches/);
  assert.equal(r["check-false"].reason, "layout changed");
  assert.equal(r.store.state, "present");
  assert.equal(r["pull-request-label"].state, "present");
  // a required patch miss is a missing anchor named after the patch
  const broken = { patches: [{ id: "moved", file: /^store-/, apply: () => { throw new Error("anchor matched 0x (want 1)"); } }] };
  const rb = byName(check(broken));
  assert.equal(rb.moved.state, "missing");
  assert.equal(rb.moved.optional, false);
  assert.match(rb.moved.reason, /matched 0x/);
});

test("runtime-only anchors stay unknown until probed; probe results merge in, forged ones do not", () => {
  const mod = goodMod();
  const r = byName(check(mod));
  for (const name of ["bridge", "sidebar", "props"]) {
    assert.equal(r[name].state, "unknown", name);
    assert.equal(r[name].phase, "runtime");
  }
  const specs = anchors.runtimeSpecs(mod);
  assert.deepEqual(specs.map((s) => s.name), ["bridge", "sidebar"]); // renderer-reported cannot be probed
  assert.ok(specs.every((s) => JSON.stringify(s) === JSON.stringify(JSON.parse(JSON.stringify(s)))), "specs are plain data");
  const probe = anchors.sanitizeProbe(
    { bridge: { state: "present" }, sidebar: { state: "missing", reason: "[data-sidebar] matched 0 element(s)" }, props: { state: "present" }, store: { state: "missing" }, [`x`.repeat(10)]: { state: "missing" } },
    specs,
  );
  assert.deepEqual(Object.keys(probe).sort(), ["bridge", "sidebar"]); // props and store were never asked for
  const merged = byName(anchors.withProbe(check(mod), probe));
  assert.equal(merged.bridge.state, "present");
  assert.equal(merged.sidebar.state, "missing");
  assert.equal(merged.sidebar.reason, "[data-sidebar] matched 0 element(s)");
  assert.equal(merged.props.state, "unknown");
  assert.equal(merged.store.state, "present"); // static results are never overwritten by a probe
  assert.deepEqual(anchors.sanitizeProbe({ bridge: { state: "bogus" }, sidebar: "x" }, specs), {});
  assert.deepEqual(anchors.sanitizeProbe(null, specs), {});
});

test("checks never throw: bad declarations, throwing checkers, missing modules, garbage mods", () => {
  const mod = {
    patches: [{ id: "p", file: /x/, apply: () => "" }, null, 5, { id: 7 }],
    anchors: [
      null,
      "x",
      { name: "Bad Name", kind: "patch" },
      { name: "a", kind: "nope" },
      { name: "a", kind: "check", check: () => 1 },
      { name: "a", kind: "check", check: () => true }, // duplicate
      { name: "thrower", kind: "check", check: () => { throw new Error("checker bug"); } },
      { name: "weird", kind: "check", check: () => "yes" },
      { name: "no-module", kind: "main-export", module: "left-pad", path: "x" },
      { name: "bad-path", kind: "main-export", module: "electron", path: "a.b(" },
      { name: "chunk-no-file", kind: "chunk", contains: "x" },
      { name: "bad-selector", kind: "renderer-selector", selector: "" },
      { name: "needs-missing-module", kind: "main-export", module: "electron", path: "ipcMain.handle" },
    ],
  };
  const list = check(mod, { patchResults: { p: { state: "present" } }, require: () => { throw new Error("cannot load electron"); } });
  const r = byName(list);
  assert.equal(r.thrower.state, "unknown");
  assert.match(r.thrower.reason, /checker bug/);
  assert.equal(r.weird.state, "unknown");
  assert.equal(r["needs-missing-module"].state, "unknown");
  assert.match(r["needs-missing-module"].reason, /cannot load electron/);
  assert.ok(list.some((x) => /invalid declaration: unknown kind/.test(x.reason ?? "")));
  assert.ok(list.some((x) => /duplicate anchor name/.test(x.reason ?? "")));
  assert.ok(list.some((x) => /built-in/.test(x.reason ?? "")));
  for (const x of list) assert.notEqual(x.state, "missing", `${x.name}: a broken declaration must not claim an anchor is missing`);
  const hostile = new Proxy({}, { get() { throw new Error("no"); }, has() { throw new Error("no"); } });
  for (const junk of [undefined, null, 1, "x", [], hostile, { anchors: hostile }, { anchors: [hostile], patches: hostile }, { anchors: "x", patches: 5 }]) {
    assert.ok(Array.isArray(anchors.checkStatic(junk, {})));
    assert.ok(Array.isArray(anchors.checkStatic(junk)));
    assert.ok(Array.isArray(anchors.runtimeSpecs(junk)));
  }
  assert.deepEqual(anchors.withProbe(undefined, {}), undefined);
});

test("Commit Graph declares an anchor for every patch, no invalid or duplicate declaration", () => {
  const cg = require(join(ROOT, "mods/commit-graph/mod.cjs"));
  const { decls, invalid } = anchors.declarations(cg);
  assert.deepEqual(invalid, []);
  assert.equal(new Set(decls.map((d) => d.name)).size, decls.length);
  const declared = new Set(cg.anchors.filter((a) => a.kind === "patch").map((a) => a.patch));
  for (const p of cg.patches) assert.ok(declared.has(p.id), `patch ${p.id} has no explicit anchor`);
  for (const a of cg.anchors.filter((a) => a.kind === "patch")) assert.ok(cg.patches.some((p) => p.id === a.patch), `anchor ${a.name} points at a patch that does not exist`);
  // optional patches carry their fallback
  const diff = decls.find((d) => d.name === "diff-section");
  assert.equal(diff.optional, true);
  assert.match(diff.fallback, /plain diff/);
  assert.deepEqual(anchors.runtimeSpecs(cg).map((s) => s.name), ["desktop-bridge-context-menu"]);
  // the mod's main-process anchors resolve against a stub electron
  const r = byName(check(cg, { patchResults: Object.fromEntries(cg.patches.map((p) => [p.id, { state: "present", optional: p.optional === true }])) }));
  assert.equal(r["ipc-handle"].state, "present");
  assert.equal(r["ipc-remove-handler"].state, "present");
});

// ---- through the loader: what the Mods window gets ---------------------------------------------
const quiet = (fn) => fn();

function setup(name, modSource) {
  const base = join(tmp, name);
  const mods = join(base, "mods");
  put(join(mods, "fixture/mod.md"), "---\nid: fixture\nname: Fixture\n---\n# Fixture");
  put(join(mods, "fixture/mod.cjs"), modSource);
  process.env.T3MOD_MODS_DIR = mods;
  process.env.T3MOD_CONFIG = join(base, "config.json");
  process.env.T3MOD_CONFIG_DIR = join(base, "cfgdir");
  put(join(base, "config.json"), JSON.stringify({ enabled: ["fixture"] }));
  const owned = [];
  const electron = {
    app: { getAppPath: () => join(tmp, "app") },
    // `owned` lists the mods' channels; the loader's own report channel is not a mod's
    ipcMain: { handle: (c) => c.startsWith("t3mod:loader:") || owned.push(c), removeHandler: (c) => owned.includes(c) && owned.splice(owned.indexOf(c), 1), on() {}, removeListener() {} },
    session: { defaultSession: { registerPreloadScript: () => "preload", unregisterPreloadScript() {} } },
  };
  return { electron, owned };
}
const entryOf = (api, id = "fixture") => api.list().mods.find((m) => m.id === id);

const MOD = (anchorsSrc, patchSrc = "[]") => `
module.exports = {
  patches: ${patchSrc},
  anchors: ${anchorsSrc},
  main({ ipcMain }) { ipcMain.handle("t3mod:fixture:ping", () => 1); },
};`;
const OK_PATCH = `[{ id: "store", file: /^store-/, apply: (s) => s + ";" }]`;

test("loader: all anchors present -> compatible, injected, probe specs offered for runtime anchors", () => {
  const { electron, owned } = setup("ok", MOD(`[{ name: "bridge", kind: "renderer-global", path: "desktopBridge.x", type: "function" }, { name: "ipc", kind: "main-export", module: "electron", path: "ipcMain", type: "object" }]`, OK_PATCH));
  quiet(() => {
    _internals.refreshMods(electron);
    _internals.setupMain(electron);
  });
  const api = _internals.loaderApi(electron);
  const m = entryOf(api);
  // the real `electron` is unavailable under node, so the main-export anchor cannot be evaluated here: unknown, not missing
  assert.equal(m.status.state, "compatible");
  assert.equal(m.ok, true);
  assert.equal(m.status.injects, true);
  assert.deepEqual(m.probes.map((p) => p.name), ["bridge"]);
  assert.deepEqual(owned, ["t3mod:fixture:ping"]);
  assert.deepEqual(m.status.missing, []);
  assert.equal(api.list().mods.find((x) => x.builtin).id, "core");
});

test("loader: a missing anchor -> anchors-missing, names it, the mod does not inject", () => {
  const { electron, owned } = setup("missing", MOD(`[{ name: "usage-button", kind: "chunk", file: /^main-/, contains: "label:\`Usage\`" }]`, OK_PATCH));
  quiet(() => {
    _internals.refreshMods(electron);
    _internals.setupMain(electron);
  });
  const m = entryOf(_internals.loaderApi(electron));
  assert.equal(m.status.state, "anchors-missing");
  assert.deepEqual(m.status.missing.map((a) => a.name), ["usage-button"]);
  assert.equal(m.ok, false);
  assert.equal(m.status.injects, false);
  assert.ok(m.problems.some((p) => p.includes("usage-button")), m.problems.join("|"));
  assert.deepEqual(owned, [], "main() never ran");
  assert.equal(_internals.state().status.fixture.ok, false);
});

test("loader: a missing anchor with a fallback leaves the mod injected and says so", () => {
  const { electron, owned } = setup("fallback", MOD(`[{ name: "pretty-diff", kind: "patch", patch: "pretty", fallback: "plain diff" }]`, `[{ id: "pretty", optional: true, file: /^store-/, apply: () => { throw new Error("moved"); } }]`));
  quiet(() => {
    _internals.refreshMods(electron);
    _internals.setupMain(electron);
  });
  const m = entryOf(_internals.loaderApi(electron));
  assert.equal(m.status.state, "anchors-missing");
  assert.equal(m.status.injects, true);
  assert.equal(m.ok, true);
  assert.deepEqual(m.status.missing.map((a) => [a.name, a.fallback]), [["pretty-diff", "plain diff"]]);
  assert.deepEqual(owned, ["t3mod:fixture:ping"]);
});

test("loader: the Mods window probe result flips a runtime anchor; the main side is taken back", () => {
  const { electron, owned } = setup("probe", MOD(`[{ name: "bridge", kind: "renderer-global", path: "desktopBridge.x", type: "function" }, { name: "menu", kind: "renderer-global", path: "desktopBridge.menu", type: "function", fallback: "no menu" }]`, OK_PATCH));
  quiet(() => {
    _internals.refreshMods(electron);
    _internals.setupMain(electron);
  });
  const api = _internals.loaderApi(electron);
  assert.equal(entryOf(api).status.state, "compatible");
  assert.deepEqual(owned, ["t3mod:fixture:ping"]);
  // forged / unknown ids and anchors are ignored
  quiet(() => api.probe({ nope: { bridge: { state: "missing" } }, fixture: { notAnAnchor: { state: "missing" } }, core: { x: { state: "missing" } } }));
  assert.equal(entryOf(api).status.state, "compatible");
  // an optional runtime anchor gone: still injected, fallback shown
  quiet(() => api.probe({ fixture: { bridge: { state: "present" }, menu: { state: "missing", reason: "desktopBridge.menu does not exist" } } }));
  let m = entryOf(api);
  assert.equal(m.status.state, "anchors-missing");
  assert.equal(m.status.injects, true);
  assert.equal(m.ok, true);
  assert.deepEqual(owned, ["t3mod:fixture:ping"]);
  // a required one gone: not active, IPC handlers released, named in the problems
  quiet(() => api.probe({ fixture: { bridge: { state: "missing", reason: "desktopBridge.x does not exist" }, menu: { state: "present" } } }));
  m = entryOf(api);
  assert.equal(m.status.state, "anchors-missing");
  assert.deepEqual(m.status.missing.map((a) => a.name), ["bridge"]);
  assert.equal(m.ok, false);
  assert.deepEqual(owned, [], "ipc handler released");
  assert.ok(m.problems.some((p) => p.includes("bridge") && p.includes("desktopBridge.x does not exist")));
  // an unknown answer (probe could not tell) never counts as missing
  quiet(() => api.probe({ fixture: { bridge: { state: "unknown", reason: "invalid path" }, menu: { state: "unknown" } } }));
  assert.equal(entryOf(api).status.state, "compatible");
});

test("loader: a mod with no anchors still gets its patches named; a mod that is not loaded is not checked", () => {
  const { electron } = setup("plain", MOD(`undefined`, OK_PATCH));
  quiet(() => _internals.refreshMods(electron));
  const api = _internals.loaderApi(electron);
  const m = entryOf(api);
  assert.equal(m.status.state, "compatible");
  assert.equal(m.status.present, 1);
  put(join(tmp, "plain", "config.json"), JSON.stringify({ enabled: [] }));
  quiet(() => _internals.refreshMods(electron));
  const off = entryOf(api);
  assert.equal(off.enabled, false);
  assert.equal(off.ok, null);
  assert.equal(off.status, null, "nothing is evaluated for a mod that is not enabled");
  assert.deepEqual(off.probes, []);
});

rmSync(tmp, { recursive: true, force: true });
out(`\n${n} tests passed`);
