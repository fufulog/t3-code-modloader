// Transactional injection: a mod that fails halfway leaves nothing behind, other mods
// keep working, a throwing disposer does not stop the rest, and a loader that cannot
// inject leaves T3 unmodified. Everything runs against a fake `electron` and temp dirs;
// no real T3 is touched.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "test/fixtures");
const { createScope } = require("../src/main/scope.cjs");
const loader = require("../src/main/loader.cjs");

// ---- tiny runner (async) ----------------------------------------------------------
let n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, fn) {
  await fn();
  n++;
  process.stdout.write(`ok   ${name}\n`);
}
const realLog = console.log;
console.log = (...a) => (String(a[0]).startsWith("[t3mod]") ? undefined : realLog(...a)); // loader chatter

const tmp = mkdtempSync(join(tmpdir(), "t3mod-tx-"));

// ---- fake T3 -----------------------------------------------------------------------
const CSP = "default-src 'self'";
function fakeT3Dir() {
  const app = mkdtempSync(join(tmp, "app-"));
  const client = join(app, "apps/server/dist/client");
  mkdirSync(join(client, "assets"), { recursive: true });
  writeFileSync(join(client, "index.html"), "<!doctype html><title>T3</title>");
  // carries the anchor the built-in core mod patches, so core verifies like on a real T3
  writeFileSync(join(client, "assets/main-1.js"), "const t3=1;(0,J.jsx)(Btn,{icon:(0,J.jsx)(Ic,{}),label:`Usage`,onClick:h});");
  return app;
}

/** A fake electron that is strict like the real one (duplicate handlers throw) and counts everything. */
function fakeElectron(opts = {}) {
  const handlers = new Map();
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, fn) => {
    if (opts.failHandle?.test(channel)) throw new Error(`cannot register ${channel}`);
    if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    handlers.set(channel, fn);
  };
  ipcMain.removeHandler = (channel) => void handlers.delete(channel);
  const t3Handler = async () => new Response("T3 itself", { headers: { "content-security-policy": CSP } });
  const protoHandlers = new Map([["t3code", t3Handler]]);
  const preloads = new Map();
  const windows = new Set();
  class BrowserWindow {
    constructor() {
      windows.add(this);
      this.destroyed = false;
    }
    destroy() {
      this.destroyed = true;
      windows.delete(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
  }
  const protocol = {
    handle(scheme, fn) {
      if (opts.failProtocolHandle && protoHandlers.size === 0 && !opts.failedOnce) {
        opts.failedOnce = true;
        throw new Error("protocol.handle exploded");
      }
      if (protoHandlers.has(scheme)) throw new Error(`protocol '${scheme}' already handled`);
      protoHandlers.set(scheme, fn);
    },
    unhandle: (scheme) => void protoHandlers.delete(scheme),
  };
  const electron = {
    ipcMain,
    protocol,
    BrowserWindow,
    app: { getAppPath: () => opts.appDir ?? fakeT3Dir(), whenReady: () => (opts.failWhenReady ? { then: () => { throw new Error("whenReady exploded"); } } : Promise.resolve()) },
    net: { fetch: async () => (opts.failFetch ? Promise.reject(new Error("no network")) : new Response("<html>", { headers: { "content-security-policy": CSP } })) },
    session: {
      defaultSession: {
        registerPreloadScript(o) {
          if (opts.failPreload) throw new Error("preload exploded");
          preloads.set(o.id, o);
          return o.id;
        },
        unregisterPreloadScript: (id) => void preloads.delete(id),
      },
    },
    webContents: { getAllWebContents: () => [] },
    shell: {},
  };
  return { electron, handlers, protoHandlers, preloads, windows, t3Handler, ipcMain };
}

// ---- the test world: shared objects the fixture mods touch -------------------------------
function freshWorld(failAt = null) {
  const original = function fn(x) {
    return [x];
  };
  const W = (globalThis.__T3TEST = { failAt, emitter: new EventEmitter(), target: { fn: original }, original, ticks: { timeout: 0, interval: 0, healthy: 0, healthyEvt: 0 }, deferred: [] });
  return W;
}

function teardown() {
  if (!globalThis.__t3modMain) return;
  for (const id of Object.keys(state().scopes)) loader._internals.unloadMod({ ipcMain: { removeHandler() {}, removeListener() {} } }, id);
}

function setupMods(names) {
  const dir = mkdtempSync(join(tmp, "mods-"));
  for (const [id, fixture] of names) cpSync(join(FIXTURES, fixture), join(dir, id), { recursive: true });
  const cfgDir = mkdtempSync(join(tmp, "cfg-"));
  process.env.T3MOD_MODS_DIR = dir;
  process.env.T3MOD_CONFIG = join(cfgDir, "config.json");
  writeFileSync(process.env.T3MOD_CONFIG, JSON.stringify({ enabled: names.map(([id]) => id) }));
  teardown(); // the previous scenario's mods must not keep timers alive
  delete globalThis.__t3modMain; // fresh loader state, as in a new T3 process
  return dir;
}

const trusted = { senderFrame: { parent: null, url: "t3code://app/index.html" } };
const state = () => loader._internals.state();
const status = (id) => state().status[id];
const catalog = (id) => state().catalog.find((m) => m.id === id);
const own = (handlers, mod) => [...handlers.keys()].filter((c) => c.startsWith(`t3mod:${mod}:`));

const STAGES = [
  ["load", "load"],
  ["main-start", "main"],
  ["after-ipc-handle", "main"],
  ["after-ipc-proxy", "main"],
  ["after-ipc-on", "main"],
  ["after-listener", "main"],
  ["after-patch", "main"],
  ["after-timeout", "main"],
  ["after-interval", "main"],
  ["after-window", "main"],
  ["after-defer", "main"],
  ["async", "main"],
];

for (const [stage, phase] of STAGES) {
  await test(`a mod failing at "${stage}" leaves nothing behind; a healthy mod keeps working`, async () => {
    const W = freshWorld(stage);
    setupMods([["failing", "fail-mod"], ["healthy", "healthy-mod"]]);
    const fake = fakeElectron();
    await loader.live({ reload: false, electron: fake.electron });
    await sleep(0); // lets an async main() reject

    // the failed mod: failed status with a short reason, readable from the Mods window data
    assert.equal(status("failing").ok, false, "status.ok");
    assert.equal(status("failing").failure.phase, phase);
    assert.match(status("failing").failure.reason, new RegExp(`^boom at ${stage}$`)); // one short line
    assert.equal(catalog("failing").ok, false);
    assert.equal(catalog("failing").failure.reason, status("failing").failure.reason);
    assert.ok(catalog("failing").problems.some((p) => p.includes(`boom at ${stage}`)));
    // ...and no resource of it remains
    assert.deepEqual(own(fake.handlers, "failing"), [], "ipc handlers");
    for (const ch of ["legacy", "on"]) assert.equal(fake.ipcMain.listenerCount(`t3mod:failing:${ch}`), 0, ch);
    assert.equal(W.emitter.listenerCount("evt"), 1, "only the healthy mod's listener is left");
    assert.equal(W.target.fn, W.original, "patched function restored");
    assert.equal(fake.windows.size, 0, "windows");
    const ticks = { ...W.ticks };
    await sleep(50);
    assert.equal(W.ticks.timeout, 0, "timeout cancelled");
    assert.equal(W.ticks.interval, 0, "interval cancelled");
    assert.ok(W.ticks.healthy > ticks.healthy, "the healthy mod's interval still runs");
    const defers = ["after-defer", "async"].includes(stage) ? ["custom"] : [];
    assert.deepEqual(W.deferred, defers, "custom disposer ran");

    // the other mod, the core mod and T3 itself
    assert.equal(status("healthy").ok, true);
    assert.equal(await fake.handlers.get("t3mod:healthy:ping")(), "pong");
    W.emitter.emit("evt");
    assert.equal(W.ticks.healthyEvt, 1);
    assert.ok(fake.handlers.has("t3mod:core:ops"), "core still loaded");
    assert.equal(status("core").ok, true);
    assert.ok(fake.preloads.has("t3mod-preload"));
    assert.equal(fake.protoHandlers.size, 1);
    state().loaderScope.dispose();
    for (const id of ["healthy", "core"]) loader._internals.unloadMod(fake.electron, id);
  });
}

await test("a mod that completes registers everything and unload takes it all back", async () => {
  const W = freshWorld(null);
  setupMods([["failing", "fail-mod"]]);
  const fake = fakeElectron();
  await loader.live({ reload: false, electron: fake.electron });
  assert.equal(status("failing").ok, true);
  assert.equal(catalog("failing").failure, null);
  assert.deepEqual(own(fake.handlers, "failing"), ["t3mod:failing:handle"]);
  assert.equal(fake.ipcMain.listenerCount("t3mod:failing:legacy"), 1);
  assert.equal(fake.windows.size, 1);
  assert.deepEqual(W.target.fn(1), ["patched", 1]);
  await sleep(40);
  assert.ok(W.ticks.interval > 0 && W.ticks.timeout === 1);
  // hot reload: registering again must not collide (the fake throws on a duplicate handler)
  await loader.live({ reload: false, electron: fake.electron });
  assert.equal(fake.windows.size, 1, "the old window was closed before the new one opened");
  assert.equal(W.emitter.listenerCount("evt"), 1);
  // unload goes through the same disposers
  loader._internals.unloadMod(fake.electron, "failing");
  assert.deepEqual(own(fake.handlers, "failing"), []);
  assert.equal(fake.windows.size, 0);
  assert.equal(W.target.fn, W.original);
  assert.equal(W.emitter.listenerCount("evt"), 0);
  const i = W.ticks.interval;
  await sleep(30);
  assert.equal(W.ticks.interval, i);
});

await test("disabling a mod from the Mods window data removes its handlers", async () => {
  freshWorld(null);
  setupMods([["failing", "fail-mod"], ["healthy", "healthy-mod"]]);
  const fake = fakeElectron();
  await loader.live({ reload: false, electron: fake.electron });
  const api = loader._internals.loaderApi(fake.electron);
  api.setEnabledMany({ failing: false });
  assert.deepEqual(own(fake.handlers, "failing"), []);
  assert.equal(own(fake.handlers, "healthy").length, 1);
  await sleep(150); // let the reload timer fire before tearing down
});

await test("a renderer setup failure reported over IPC rolls the mod's main side back too", async () => {
  const W = freshWorld(null);
  setupMods([["failing", "fail-mod"], ["healthy", "healthy-mod"]]);
  const fake = fakeElectron();
  await loader.live({ reload: false, electron: fake.electron });
  const report = fake.handlers.get("t3mod:loader:report");
  assert.deepEqual(await report({ senderFrame: { parent: null, url: "https://evil.example/" } }, { mod: "failing", phase: "renderer", error: "x" }), { ok: false, error: "untrusted sender" });
  assert.equal(status("failing").ok, true, "an untrusted sender changes nothing");
  assert.deepEqual(await report(trusted, { mod: "nope", phase: "renderer", error: "x" }), { ok: false, error: "unknown mod" });
  assert.deepEqual(await report(trusted, { mod: "failing", phase: "renderer", error: "runtime.js threw: anchor gone" }), { ok: true });
  assert.equal(status("failing").failure.phase, "renderer");
  assert.equal(catalog("failing").failure.reason, "runtime.js threw: anchor gone");
  assert.deepEqual(own(fake.handlers, "failing"), []);
  assert.equal(fake.windows.size, 0);
  assert.equal(W.target.fn, W.original);
  assert.equal(status("healthy").ok, true);
  // the failure survives a rescan (the window has not reloaded), and is cleared when the mod is toggled
  loader._internals.loaderApi(fake.electron).rescan();
  assert.equal(status("failing").ok, false);
  assert.deepEqual(own(fake.handlers, "failing"), []);
  // the first failure is the cause; later reports do not overwrite it
  await report(trusted, { mod: "failing", phase: "renderer", error: "second" });
  assert.equal(status("failing").failure.reason, "runtime.js threw: anchor gone");
});

// ---- scope unit tests -------------------------------------------------------------------

await test("disposers run newest first, a throwing disposer is logged and the rest still run", () => {
  const seen = [];
  const logged = [];
  const scope = createScope("t", { onError: (m) => logged.push(m) });
  scope.defer(() => seen.push("a"));
  scope.defer(() => {
    seen.push("b");
    throw new Error("b is broken");
  }, "thing b");
  scope.defer(() => seen.push("c"));
  scope.defer(() => {
    throw new Error("d is broken");
  }, "thing d");
  const errors = scope.dispose();
  assert.deepEqual(seen, ["c", "b", "a"]);
  assert.equal(errors.length, 2);
  assert.equal(logged.length, 2);
  assert.match(logged[0], /thing d failed: d is broken/);
  assert.deepEqual(scope.dispose(), [], "disposing twice does nothing");
  assert.deepEqual(seen, ["c", "b", "a"]);
  // a late registration on a disposed scope is undone immediately
  let undone = false;
  scope.defer(() => (undone = true));
  assert.equal(undone, true);
});

await test("a throwing disposer inside a failing mod does not stop the other cleanup", async () => {
  const W = freshWorld(null);
  const dir = setupMods([["healthy", "healthy-mod"], ["bad-cleanup", "fail-mod"]]);
  // a mod whose first-registered disposer throws, then it fails: everything else must still be undone
  writeFileSync(
    join(dir, "bad-cleanup/mod.cjs"),
    `const W = globalThis.__T3TEST;
     module.exports = { main({ scope }) {
       scope.on(W.emitter, "evt", () => {});
       scope.defer(() => { throw new Error("disposer explodes"); });
       scope.ipcHandle("t3mod:bad-cleanup:x", () => 1);
       throw new Error("then the mod fails");
     } };`,
  );
  writeFileSync(join(dir, "bad-cleanup/mod.md"), "---\nid: bad-cleanup\n---\n");
  writeFileSync(process.env.T3MOD_CONFIG, JSON.stringify({ enabled: ["healthy", "bad-cleanup"] }));
  const fake = fakeElectron();
  await loader.live({ reload: false, electron: fake.electron });
  assert.equal(status("bad-cleanup").ok, false);
  assert.deepEqual(own(fake.handlers, "bad-cleanup"), []);
  assert.equal(W.emitter.listenerCount("evt"), 1, "the listener registered before the throwing disposer is gone");
  assert.ok(state().log.some((l) => l.includes("disposer explodes")), "the broken disposer was logged");
  assert.equal(status("healthy").ok, true);
});

// ---- whole-loader failure ----------------------------------------------------------------------

function assertUntouched(fake, originalHandler) {
  assert.equal(fake.handlers.size, 0, `ipc handlers left: ${[...fake.handlers.keys()]}`);
  assert.equal(fake.preloads.size, 0, "preload scripts left");
  assert.equal(fake.windows.size, 0);
  assert.equal(fake.protoHandlers.get("t3code"), originalHandler, "T3's own protocol handler is still in place");
  assert.equal(fake.ipcMain.eventNames().length, 0, "ipc listeners left");
}

await test("loader failure before anything changed (CSP not capturable): nothing left behind", async () => {
  freshWorld(null);
  setupMods([["healthy", "healthy-mod"]]);
  rmSync(process.env.T3MOD_CONFIG); // first run: the loader would create config.json
  const fake = fakeElectron({ failFetch: true });
  await assert.rejects(loader.live({ reload: false, electron: fake.electron }), /content-security-policy/);
  assertUntouched(fake, fake.t3Handler);
  assert.equal(existsSync(process.env.T3MOD_CONFIG), false, "config.json created by the failed run is removed again");
  assert.ok(state().loaderError);
});

await test("loader failure while discovering mods (no asset directory): nothing left behind", async () => {
  freshWorld(null);
  setupMods([["healthy", "healthy-mod"]]);
  const fake = fakeElectron({ appDir: join(tmp, "does-not-exist") });
  await assert.rejects(loader.live({ reload: false, electron: fake.electron }));
  assertUntouched(fake, fake.t3Handler);
});

await test("loader failure while registering (loader IPC throws) after mods were set up: everything is undone", async () => {
  const W = freshWorld(null);
  setupMods([["healthy", "healthy-mod"]]);
  const fake = fakeElectron({ failHandle: /^t3mod:loader:/ });
  await assert.rejects(loader.live({ reload: false, electron: fake.electron }), /cannot register/);
  assertUntouched(fake, fake.t3Handler);
  assert.equal(W.emitter.listenerCount("evt"), 0, "the healthy mod was unloaded as well");
  assert.equal(state().removed, true);
  const t = W.ticks.healthy;
  await sleep(30);
  assert.equal(W.ticks.healthy, t, "its interval is gone");
});

await test("loader failure registering the preload script: T3 runs unmodified", async () => {
  freshWorld(null);
  setupMods([["healthy", "healthy-mod"]]);
  const fake = fakeElectron({ failPreload: true });
  await assert.rejects(loader.live({ reload: false, electron: fake.electron }), /preload exploded/);
  assertUntouched(fake, fake.t3Handler);
});

await test("loader failure swapping the protocol handler: a plain handler serves T3 unmodified, nothing else is left", async () => {
  freshWorld(null);
  setupMods([["healthy", "healthy-mod"]]);
  const fake = fakeElectron({ failProtocolHandle: true });
  await assert.rejects(loader.live({ reload: false, electron: fake.electron }), /protocol.handle exploded/);
  assert.equal(fake.handlers.size, 0);
  assert.equal(fake.preloads.size, 0);
  const plain = fake.protoHandlers.get("t3code");
  assert.ok(plain, "something still serves t3code://");
  const res = await plain(new Request("t3code://app/assets/main-1.js"));
  assert.ok((await res.text()).startsWith("const t3=1;"), "unpatched");
  assert.ok(!(await (await plain(new Request("t3code://app/assets/main-1.js"))).text()).includes("Mods"));
  assert.equal(state().removed, true);
});

await test("cold start: hooks that cannot be installed are undone", () => {
  freshWorld(null);
  setupMods([["healthy", "healthy-mod"]]);
  const fake = fakeElectron({ failWhenReady: true });
  const before = fake.electron.protocol.handle;
  assert.throws(() => loader.cold({ electron: fake.electron }), /whenReady exploded/);
  assert.equal(fake.electron.protocol.handle, before, "protocol.handle is the original again");
  assert.equal(state().cold, false);
});

await test("cold start: a loader-level setup failure leaves T3 serving its own files", async () => {
  const W = freshWorld(null);
  setupMods([["healthy", "healthy-mod"]]);
  const fake = fakeElectron({ failPreload: true });
  fake.protoHandlers.clear(); // cold runs before T3 registers its protocol
  loader.cold({ electron: fake.electron });
  fake.electron.protocol.handle("t3code", fake.t3Handler); // T3 registers; the hook verifies mods
  await sleep(10); // whenReady -> setupMain throws on the preload -> rollback
  assert.equal(fake.handlers.size, 0);
  assert.equal(W.emitter.listenerCount("evt"), 0);
  const served = fake.protoHandlers.get("t3code");
  const res = await served(new Request("t3code://app/__t3mod/status.json"));
  assert.equal(await res.text(), "T3 itself", "mod URLs are no longer intercepted");
  assert.equal(state().removed, true);
});

await test("cold start: a good run installs the hooks and sets the mods up", async () => {
  freshWorld(null);
  setupMods([["healthy", "healthy-mod"]]);
  const fake = fakeElectron();
  fake.protoHandlers.clear();
  loader.cold({ electron: fake.electron });
  fake.electron.protocol.handle("t3code", fake.t3Handler);
  await sleep(10);
  assert.ok(fake.handlers.has("t3mod:healthy:ping"));
  assert.ok(fake.handlers.has("t3mod:loader:report"));
  assert.equal(status("healthy").ok, true);
  const res = await fake.protoHandlers.get("t3code")(new Request("t3code://app/__t3mod/kit.js"));
  assert.match(await res.text(), /export function scope/);
});

// ---- renderer kit ----------------------------------------------------------------------------

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.parent = null;
  }
  appendChild(c) {
    this.children.push(c);
    c.parent = this;
    return c;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
}
function fakeDom() {
  const reports = [];
  globalThis.document = Object.assign(new EventTarget(), { head: new FakeNode("head"), body: new FakeNode("body"), createElement: (t) => new FakeNode(t) });
  globalThis.window = Object.assign(new EventTarget(), { t3mod: { invoke: async (channel, payload) => void reports.push([channel, payload]) } });
  return reports; // globalThis.__t3mod is kept: kit.js captured that object when it was imported
}
globalThis.__t3mod = {};
console.warn = () => {}; // kit.js warns about the failures these tests cause on purpose
const { scope: rscope } = await import(pathToFileURL(join(ROOT, "src/client/kit.js")).href);
const countListeners = (target) => {
  let c = 0;
  const add = target.addEventListener, rem = target.removeEventListener;
  target.addEventListener = function (...a) { c++; return add.apply(this, a); };
  target.removeEventListener = function (...a) { c--; return rem.apply(this, a); };
  return () => c;
};

const RSTAGES = ["style", "add", "listener", "timeout", "interval", "global", "patch", "defer", "after-all", "async"];
for (const stage of RSTAGES) {
  await test(`renderer: a mod failing at "${stage}" removes its DOM, styles, listeners, timers and globals and reports once`, async () => {
    const reports = fakeDom();
    const listeners = countListeners(globalThis.window);
    const target = { fn: () => 1 };
    const original = target.fn;
    let ticks = 0, deferred = 0;
    const S = rscope("rmod");
    const stop = (s) => {
      if (s === stage) throw new Error(`renderer boom at ${s}`);
    };
    const setup = () => {
      S.style("/__t3mod/rmod/style.css");
      stop("style");
      const host = S.add(new FakeNode("div"));
      S.style({ css: ".x{}" });
      stop("add");
      S.on(globalThis.window, "focus", () => {});
      S.on(globalThis.document, "keydown", () => {});
      stop("listener");
      S.timeout(() => ticks++, 10);
      stop("timeout");
      S.interval(() => ticks++, 5);
      stop("interval");
      S.global("rmod", { api: true });
      stop("global");
      S.patch(target, "fn", (orig) => () => orig() + 1);
      stop("patch");
      S.defer(() => deferred++);
      stop("defer");
      void host;
      stop("after-all");
      if (stage === "async") return Promise.reject(new Error("renderer boom at async"));
    };
    // a healthy second mod in the same page
    const H = rscope("rhealthy");
    H.run(() => {
      H.style({ css: ".h{}" });
      H.global("rhealthy", 1);
    });
    await S.run(setup);
    await sleep(40);
    assert.equal(S.closed, true);
    assert.equal(document.head.children.filter((c) => c.dataset.t3mod === "rmod").length, 0, "styles");
    assert.equal(document.body.children.length, 0, "elements");
    assert.equal(listeners(), 0, "listeners");
    assert.equal(ticks, 0, "timers");
    assert.equal(globalThis.__t3mod.rmod, undefined, "global");
    assert.equal(target.fn, original, "patch");
    assert.equal(deferred, ["defer", "after-all", "async"].includes(stage) ? 1 : 0, "defer");
    assert.equal(reports.length, 1);
    assert.deepEqual(reports[0], ["t3mod:loader:report", { mod: "rmod", phase: "renderer", error: `renderer boom at ${stage}` }]);
    assert.equal(globalThis.__t3mod.rhealthy, 1, "the healthy mod's global is intact");
    assert.equal(document.head.children.filter((c) => c.dataset.t3mod === "rhealthy").length, 1);
    H.dispose();
  });
}

await test("renderer: a throwing disposer is logged and the rest of the cleanup still runs; a good setup reports nothing", () => {
  const reports = fakeDom();
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(" "));
  try {
    const S = rscope("rbad");
    let ran = 0;
    S.run(() => {
      S.defer(() => ran++);
      S.defer(() => {
        throw new Error("renderer disposer explodes");
      });
      S.defer(() => ran++);
      throw new Error("setup fails");
    });
    assert.equal(ran, 2);
    assert.ok(warned.some((w) => w.includes("renderer disposer explodes")));
    assert.equal(reports.length, 1);
    const G = rscope("rgood");
    assert.equal(G.run(() => 42), 42);
    assert.equal(reports.length, 1);
    // hot reload: asking for the same id again disposes the previous run first
    let first = 0;
    G.defer(() => first++);
    const G2 = rscope("rgood");
    assert.equal(first, 1);
    G2.dispose();
  } finally {
    console.warn = warn;
  }
});

teardown();
rmSync(tmp, { recursive: true, force: true });
console.log = realLog;
console.log(`\n${n} tests passed`);
