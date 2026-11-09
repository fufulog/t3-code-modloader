// The three sources of a mod's state (declared incompatible, anchors, failed injection) meet in ONE
// status, computed by the loader (computeCatalog -> status.cjs) and shown by the Mods window.
// These tests run the real loader against a stub T3 client in a temp dir and a fake `electron`.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const loader = require("../src/main/loader.cjs");
const { _internals } = loader;

const out = (...a) => process.stdout.write(a.join(" ") + "\n");
console.log = () => {}; // the loader logs every verdict; keep the test output readable
let n = 0;
const test = async (name, fn) => {
  await fn();
  n++;
  out(`ok   ${name}`);
};

const tmp = mkdtempSync(join(tmpdir(), "t3mod-wiring-"));
const put = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
put(join(tmp, "app/apps/server/dist/client/assets/store-1.js"), "case`pull-requests`:return{id:`pull-requests`};");
put(join(tmp, "app/apps/server/dist/client/assets/main-1.js"), "// main");

const T3_VERSION = "2.4.1";

/** A fake electron whose ipcMain really tracks handlers and listeners, so leftovers are visible. */
function fakeElectron() {
  const handlers = new Map();
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, fn) => {
    if (handlers.has(channel)) throw new Error(`second handler for ${channel}`);
    handlers.set(channel, fn);
  };
  ipcMain.removeHandler = (channel) => void handlers.delete(channel);
  return {
    handlers,
    electron: {
      app: { getAppPath: () => join(tmp, "app"), getVersion: () => T3_VERSION },
      ipcMain,
      session: { defaultSession: { registerPreloadScript: () => "preload", unregisterPreloadScript() {} } },
    },
  };
}

/** Mods in a fresh mods dir, all enabled. `mods` = { id: { md, cjs } }. */
function world(name, mods) {
  delete globalThis.__t3modMain; // each test starts from a fresh loader state
  delete globalThis.__wiring;
  globalThis.__wiring = { loaded: [], ticks: 0 };
  const base = join(tmp, name);
  for (const [id, m] of Object.entries(mods)) {
    put(join(base, "mods", id, "mod.md"), `---\nid: ${id}\nname: ${id}\n${m.md ?? ""}---\n# ${id}`);
    put(join(base, "mods", id, "mod.cjs"), `globalThis.__wiring.loaded.push(${JSON.stringify(id)});\n${m.cjs}`);
  }
  process.env.T3MOD_MODS_DIR = join(base, "mods");
  process.env.T3MOD_CONFIG = join(base, "config.json");
  process.env.T3MOD_CONFIG_DIR = join(base, "cfgdir");
  put(join(base, "config.json"), JSON.stringify({ enabled: Object.keys(mods) }));
  const fake = fakeElectron();
  const scan = () => {
    _internals.refreshMods(fake.electron);
    _internals.setupMain(fake.electron);
  };
  scan();
  const api = _internals.loaderApi(fake.electron);
  const entry = (id) => api.list().mods.find((m) => m.id === id);
  const mine = (id) => [...fake.handlers.keys()].filter((c) => c.startsWith(`t3mod:${id}:`));
  return { ...fake, api, scan, entry, mine, base };
}

const HEALTHY = { cjs: `module.exports = { main({ ipcMain }) { ipcMain.handle("t3mod:healthy:ping", () => "pong"); } };` };
// Registers a handler, a listener and an interval, then throws: everything must be undone.
const FAILING = (extra = "") => ({
  cjs: `module.exports = {
  ${extra}
  main({ ipcMain, scope }) {
    ipcMain.handle("t3mod:failing:a", () => 1);
    ipcMain.on("t3mod:failing:b", () => {});
    scope.interval(() => { globalThis.__wiring.ticks++; }, 5);
    throw new Error("boom at setup");
  },
};`,
});
const INCOMPATIBLE = {
  md: "incompatible-t3-majors: 2\n",
  cjs: `globalThis.__wiring.ranIncompatible = true; module.exports = { main({ ipcMain }) { ipcMain.handle("t3mod:old:x", () => 1); } };`,
};
const nothingLeft = (w, id) => {
  assert.deepEqual(w.mine(id), [], `${id}: ipc handlers`);
  assert.equal(w.electron.ipcMain.listenerCount(`t3mod:${id}:b`), 0, `${id}: ipc listeners`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await test("incompatible: shown as incompatible with the manifest's reason, its code is never loaded", () => {
  const w = world("incompatible", { old: INCOMPATIBLE, healthy: HEALTHY });
  const m = w.entry("old");
  assert.equal(m.status.state, "incompatible");
  assert.equal(m.status.reason, "Not compatible with T3 2.x");
  assert.equal(m.status.injects, false);
  assert.equal(m.ok, false);
  assert.equal(m.failure, null, "declared incompatible is not a failure");
  assert.deepEqual(globalThis.__wiring.loaded, ["healthy"], "mod.cjs of the incompatible mod was never required");
  assert.equal(globalThis.__wiring.ranIncompatible, undefined);
  assert.deepEqual(w.mine("old"), []);
  assert.equal(_internals.state().status.old.ok, false);
  assert.ok(_internals.state().status.old.problems.includes("Not compatible with T3 2.x"));
  // the healthy mod is untouched, and so is a mod that does not declare anything
  assert.equal(w.entry("healthy").status.state, "compatible");
  assert.equal(w.entry("healthy").ok, true);
  assert.deepEqual(w.mine("healthy"), ["t3mod:healthy:ping"]);
});

await test("incompatible: the compat check is reused, not repeated (one verdict per scan)", () => {
  const compat = require("../src/main/compat.cjs");
  const real = compat.checkCompat;
  let calls = 0;
  compat.checkCompat = (...a) => (calls++, real(...a));
  try {
    const w = world("compat-once", { old: INCOMPATIBLE, healthy: HEALTHY }); // world() scans once
    assert.equal(calls, 2, "one check per enabled user mod, none for core and none for the status");
    assert.equal(w.entry("old").compat.compatible, false);
    w.api.probe({}); // recomputes the status; must not re-run the check
    assert.equal(calls, 2);
  } finally {
    compat.checkCompat = real;
  }
});

await test("failed at main setup: shown as failed with the reason, nothing left behind, the others keep running", async () => {
  const w = world("failed", { failing: FAILING(), healthy: HEALTHY });
  const m = w.entry("failing");
  assert.equal(m.status.state, "failed");
  assert.equal(m.status.reason, "main setup failed: boom at setup");
  assert.equal(m.status.injects, false);
  assert.equal(m.ok, false);
  assert.deepEqual({ phase: m.failure.phase, reason: m.failure.reason }, { phase: "main", reason: "boom at setup" });
  assert.equal(_internals.state().status.failing.ok, false);
  assert.equal(_internals.state().status.failing.failure.phase, "main");
  nothingLeft(w, "failing");
  const ticks = globalThis.__wiring.ticks;
  await sleep(40);
  assert.equal(globalThis.__wiring.ticks, ticks, "its interval was cancelled");
  assert.equal(w.entry("healthy").status.state, "compatible");
  assert.equal(w.entry("healthy").ok, true);
  assert.deepEqual(w.mine("healthy"), ["t3mod:healthy:ping"]);
});

await test("failed at load (mod.cjs throws): failed, with the same shape", () => {
  const w = world("failed-load", { broken: { cjs: `throw new Error("syntax gone wrong");` }, healthy: HEALTHY });
  const m = w.entry("broken");
  assert.equal(m.status.state, "failed");
  assert.equal(m.status.reason, "load setup failed: syntax gone wrong");
  assert.equal(m.ok, false);
  assert.equal(m.failure.phase, "load");
  assert.equal(w.entry("healthy").ok, true);
});

await test("precedence matches docs/design/anchors.md: incompatible > failed > anchors-missing > compatible", () => {
  // failed beats anchors-missing: the mod fails at main and also has a required anchor that is gone
  const gone = `anchors: [{ name: "usage-button", kind: "chunk", file: /^main-/, contains: "label:\`Usage\`" }],`;
  const w = world("precedence", { failing: FAILING(gone), healthy: HEALTHY });
  // the anchor miss alone keeps it from injecting, so main never ran: it is anchors-missing, not failed
  let m = w.entry("failing");
  assert.equal(m.status.state, "anchors-missing");
  assert.deepEqual(m.status.missing.map((a) => a.name), ["usage-button"]);
  assert.equal(m.failure, null);
  // an optional anchor (fallback) does not stop injection, so main runs, fails, and failed wins
  const w2 = world("precedence2", { failing: FAILING(`anchors: [{ name: "menu", kind: "chunk", file: /^main-/, contains: "NOPE", fallback: "no menu" }],`), healthy: HEALTHY });
  m = w2.entry("failing");
  assert.equal(m.status.state, "failed");
  assert.deepEqual(m.status.also, ["anchors-missing"]);
  assert.deepEqual(m.status.missing.map((a) => a.name), ["menu"]);
  assert.equal(m.ok, false);
  // incompatible beats failed: a leftover failure record cannot hide the declaration
  const w3 = world("precedence3", { old: INCOMPATIBLE, healthy: HEALTHY });
  _internals.failMod(w3.electron, "old", "renderer", "leftover from an earlier run");
  m = w3.entry("old");
  assert.equal(m.status.state, "incompatible");
  assert.deepEqual(m.status.also, ["failed"]);
  assert.equal(m.status.reason, "Not compatible with T3 2.x");
  // nothing holds: compatible
  assert.equal(w3.entry("healthy").status.state, "compatible");
});

await test("a probe after a failure does not revive the mod", () => {
  const anchors = `anchors: [{ name: "bridge", kind: "renderer-global", path: "desktopBridge.x", type: "function" }],`;
  const w = world("probe-after-failure", { failing: FAILING(anchors), healthy: HEALTHY });
  assert.equal(w.entry("failing").status.state, "failed");
  nothingLeft(w, "failing");
  // the window reports the runtime anchor as present: still failed, still undone
  w.api.probe({ failing: { bridge: { state: "present" } } });
  let m = w.entry("failing");
  assert.equal(m.status.state, "failed");
  assert.equal(m.ok, false);
  assert.equal(_internals.state().status.failing.ok, false);
  nothingLeft(w, "failing");
  // reporting it missing changes the picture (also), not the outcome, and releases nothing twice
  w.api.probe({ failing: { bridge: { state: "missing", reason: "desktopBridge.x does not exist" } } });
  m = w.entry("failing");
  assert.equal(m.status.state, "failed");
  assert.deepEqual(m.status.also, ["anchors-missing"]);
  nothingLeft(w, "failing");
  assert.equal(w.entry("healthy").ok, true);
  assert.deepEqual(w.mine("healthy"), ["t3mod:healthy:ping"]);
});

await test("a renderer failure stays failed across a probe and a rescan; main() is not run again", () => {
  const w2 = world("renderer-failure", { late: { cjs: `module.exports = { main({ ipcMain }) { globalThis.__wiring.runs = (globalThis.__wiring.runs ?? 0) + 1; ipcMain.handle("t3mod:late:ping", () => 1); } };` } });
  assert.equal(globalThis.__wiring.runs, 1);
  assert.deepEqual(w2.mine("late"), ["t3mod:late:ping"]);
  // the renderer says its setup failed (item 3's report path)
  _internals.failMod(w2.electron, "late", "renderer", "runtime.js threw: anchor gone");
  assert.deepEqual(w2.mine("late"), [], "main side undone by the same unload");
  let m = w2.entry("late");
  assert.equal(m.status.state, "failed");
  assert.equal(m.status.reason, "renderer setup failed: runtime.js threw: anchor gone");
  w2.api.probe({ late: {} });
  assert.equal(w2.entry("late").status.state, "failed");
  w2.scan(); // a rescan keeps a renderer failure until the window reloads
  m = w2.entry("late");
  assert.equal(m.status.state, "failed");
  assert.equal(m.ok, false);
  assert.equal(globalThis.__wiring.runs, 1, "main() did not run again");
  assert.deepEqual(w2.mine("late"), []);
  // enabling/disabling clears the record: the next load attempt is fresh
  _internals.state().failures.clear("late");
  w2.scan();
  assert.equal(w2.entry("late").status.state, "compatible");
  assert.equal(globalThis.__wiring.runs, 2);
});

await test("the probe's release of a mod goes through unloadMod (one cleanup path)", async () => {
  const anchors = `anchors: [{ name: "bridge", kind: "renderer-global", path: "desktopBridge.x", type: "function" }],`;
  const w = world("probe-release", { gone: { cjs: `module.exports = { ${anchors} main({ ipcMain, scope }) { ipcMain.handle("t3mod:gone:a", () => 1); ipcMain.on("t3mod:gone:b", () => {}); scope.interval(() => { globalThis.__wiring.ticks++; }, 5); } };` } });
  assert.deepEqual(w.mine("gone"), ["t3mod:gone:a"]);
  assert.ok(_internals.state().scopes.gone, "the mod runs inside a scope");
  // a blocking runtime anchor is reported gone: the mod's scope is disposed, not just its handlers released
  w.api.probe({ gone: { bridge: { state: "missing", reason: "desktopBridge.x does not exist" } } });
  assert.equal(w.entry("gone").status.state, "anchors-missing");
  assert.equal(_internals.state().scopes.gone, undefined, "scope disposed");
  const ticks = globalThis.__wiring.ticks;
  await sleep(40);
  assert.equal(globalThis.__wiring.ticks, ticks, "its interval was cancelled by the scope (the old release path only knew handlers)");
  nothingLeft(w, "gone");
  assert.equal(w.entry("gone").failure, null, "an anchor miss is not a failure");
});

rmSync(tmp, { recursive: true, force: true });
out(`\n${n} tests passed`);
