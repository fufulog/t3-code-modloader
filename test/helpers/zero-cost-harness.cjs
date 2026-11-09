"use strict";
// Child-process harness for the zero-cost-with-no-mods gate (test/zero-cost.test.mjs).
//
//   node test/helpers/zero-cost-harness.cjs '<scenario json>'
//
// Runs the real src/main/loader.cjs against a STUB T3 (fake Electron app, ipcMain,
// protocol, session, net, webContents) inside a temp directory, with every way of
// "doing work" instrumented, then prints one JSON report line on stdout. No real T3,
// no real inspector, no real child processes or sockets are ever started: the
// instrumented calls below record and DO NOT call through (except fs writes, which are
// confined to the temp directory the scenario points the loader at).
//
// scenario = { kind: "cold" | "live", tmp, launcher?: path }
//   tmp must hold: client/apps/server/dist/client/{index.html,assets/*.js} (the stub T3's
//   assets), mods/ (T3MOD_MODS_DIR), cfg/ (T3MOD_CONFIG_DIR), config.json path optional.

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const EventEmitter = require("node:events");
const cp = require("node:child_process");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");
const dgram = require("node:dgram");
const inspector = require("node:inspector");
const workerThreads = require("node:worker_threads");

void process.stdout, void process.stderr; // create the lazy stdio streams before recording starts
const scenario = JSON.parse(process.argv[2]);
const ROOT = path.resolve(__dirname, "../..");
const TMP = fs.realpathSync(scenario.tmp);

// Saved originals: the harness itself must never show up in the recording.
const real = {
  setTimeout, setInterval, setImmediate, clearTimeout,
  consoleLog: console.log, consoleError: console.error,
  stdoutWrite: process.stdout.write.bind(process.stdout),
};

// ---- recording ----------------------------------------------------------------------
const rec = {
  electron: [], timers: [], listeners: [], watchers: [], fsWrites: [], fsReads: new Set(),
  childProcess: [], network: [], inspector: [], workers: [], signals: [], builtinRequires: new Set(), requires: new Set(),
};
let recording = false;
const norm = (p) => {
  if (typeof p !== "string") return `<${typeof p}>`;
  let abs = path.resolve(p);
  try { abs = fs.realpathSync.native(abs); } catch { try { abs = path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs)); } catch {} }
  if (abs === TMP) return "<tmp>";
  if (abs.startsWith(TMP + path.sep)) return "<tmp>/" + path.relative(TMP, abs).split(path.sep).join("/");
  if (abs === ROOT) return "<root>";
  if (abs.startsWith(ROOT + path.sep)) return "<root>/" + path.relative(ROOT, abs).split(path.sep).join("/");
  return "<outside>" + abs;
};
const note = (list, entry) => { if (recording) list.push(entry); };

// -- timers (the loader's own setTimeout etc. are recorded, then run for real)
for (const name of ["setTimeout", "setInterval", "setImmediate"]) {
  const orig = real[name];
  globalThis[name] = function (fn, delay, ...rest) {
    note(rec.timers, name === "setImmediate" ? name : `${name}(${typeof delay === "number" ? delay : "default"}ms)`);
    return orig.call(this, fn, delay, ...rest);
  };
}

// -- event listeners on any real emitter (process, streams, ...). Stub Electron objects are
//    plain objects and are recorded through the electron stub instead.
for (const m of ["on", "once", "addListener", "prependListener", "prependOnceListener"]) {
  const orig = EventEmitter.prototype[m];
  EventEmitter.prototype[m] = function (event, ...rest) {
    if (recording && !this.__harness) note(rec.listeners, (process.env.GATE_DEBUG ? new Error().stack.split("\n").slice(2, 8).join("|") + " :: " : "") + `${this === process ? "process" : this.constructor.name}.${m}(${String(event)})`);
    return orig.call(this, event, ...rest);
  };
}

// -- file system: writes (recorded, run for real inside tmp), reads (recorded), watchers (recorded, not run)
const WRITE_FNS = ["writeFile", "appendFile", "mkdir", "mkdtemp", "rm", "rmdir", "unlink", "rename", "copyFile", "cp", "symlink", "link", "chmod", "chown", "truncate", "utimes", "createWriteStream", "writev", "write", "ftruncate"];
const READ_FNS = ["readFile", "readdir", "stat", "lstat", "exists", "access", "realpath", "open", "opendir", "readlink", "createReadStream"];
for (const base of WRITE_FNS) {
  for (const name of [base, base + "Sync"]) {
    const orig = fs[name];
    if (typeof orig !== "function") continue;
    fs[name] = function (target, ...rest) {
      if (recording) {
        const t = typeof target === "string" || Buffer.isBuffer(target) || target instanceof URL ? norm(String(target)) : `<${typeof target}>`;
        note(rec.fsWrites, `${name} ${t}`);
        if (!t.startsWith("<tmp>")) throw new Error(`harness: refusing write outside tmp: ${name} ${t}`);
      }
      return orig.call(this, target, ...rest);
    };
  }
  const po = fs.promises[base];
  if (typeof po === "function") {
    fs.promises[base] = function (target, ...rest) {
      if (recording) note(rec.fsWrites, `promises.${base} ${typeof target === "string" ? norm(target) : `<${typeof target}>`}`);
      return po.call(this, target, ...rest);
    };
  }
}
// openSync/open with a write flag also counts as a write
for (const name of ["open", "openSync"]) {
  const orig = fs[name];
  fs[name] = function (target, flags, ...rest) {
    if (recording) {
      const f = typeof flags === "string" ? flags : typeof flags === "number" ? ((flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND)) ? "w" : "r") : "r";
      if (/[wa+]/.test(f)) note(rec.fsWrites, `${name}(${f}) ${norm(String(target))}`);
      else rec.fsReads.add(norm(String(target)));
    }
    return orig.call(this, target, flags, ...rest);
  };
}
for (const base of READ_FNS) {
  if (base === "open") continue;
  for (const name of [base, base + "Sync"]) {
    const orig = fs[name];
    if (typeof orig !== "function") continue;
    fs[name] = function (target, ...rest) {
      if (recording && (typeof target === "string" || target instanceof URL)) rec.fsReads.add(norm(String(target)));
      return orig.call(this, target, ...rest);
    };
  }
}
for (const name of ["watch", "watchFile", "unwatchFile"]) {
  fs[name] = function (target) {
    note(rec.watchers, `fs.${name} ${typeof target === "string" ? norm(target) : "<?>"}`);
    const h = new EventEmitter(); h.__harness = true; h.close = () => {}; h.unref = () => h; h.ref = () => h;
    return h;
  };
}
fs.promises.watch = function (target) {
  note(rec.watchers, `fs.promises.watch ${typeof target === "string" ? norm(target) : "<?>"}`);
  return { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; } };
};

// -- child processes, network, workers, inspector, signals: record only, never run
const dummyChild = () => { const e = new EventEmitter(); e.__harness = true; e.stdout = new EventEmitter(); e.stderr = new EventEmitter(); e.kill = () => true; e.unref = () => {}; return e; };
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  cp[name] = function (file) { note(rec.childProcess, `child_process.${name} ${typeof file === "string" ? path.basename(file) : "<?>"}`); return /Sync$/.test(name) ? Buffer.alloc(0) : dummyChild(); };
}
const harnessCpSpawn = cp.spawn;
net.Socket.prototype.connect = function () { note(rec.network, "net.Socket.connect"); return this; };
net.Server.prototype.listen = function () { note(rec.network, "net.Server.listen"); return this; };
for (const [mod, label] of [[http, "http"], [https, "https"]]) for (const n of ["request", "get"]) mod[n] = function () { note(rec.network, `${label}.${n}`); return dummyChild(); };
dns.lookup = function () { note(rec.network, "dns.lookup"); };
dgram.createSocket = function () { note(rec.network, "dgram.createSocket"); return dummyChild(); };
globalThis.fetch = function () { note(rec.network, "globalThis.fetch"); return Promise.reject(new Error("harness: no network")); };
workerThreads.Worker = class { constructor() { note(rec.workers, "worker_threads.Worker"); } };
inspector.open = function () { note(rec.inspector, "inspector.open"); };
inspector.waitForDebugger = function () { note(rec.inspector, "inspector.waitForDebugger"); };
inspector.Session.prototype.connect = function () { note(rec.inspector, "inspector.Session.connect"); };
inspector.Session.prototype.connectToMainThread = function () { note(rec.inspector, "inspector.Session.connectToMainThread"); };
process.kill = function (pid, sig) { note(rec.signals, `process.kill(${pid === process.pid ? "self" : "other"}, ${sig ?? "SIGTERM"})`); return true; };
process._debugProcess = function () { note(rec.inspector, "process._debugProcess"); };

// ---- stub T3 / Electron ----------------------------------------------------------------
const clientDir = path.join(TMP, "client");
const summarize = (a) => (typeof a === "string" ? a : typeof a === "function" ? "<fn>" : a && typeof a === "object" ? JSON.stringify(a, (k, v) => (k === "filePath" ? path.basename(String(v)) : v)) : String(a));
const call = (name, args, impl) => { note(rec.electron, `${name}(${args.map(summarize).join(", ")})`); return impl?.(...args); };
const window = { getType: () => "window", getURL: () => "t3code://app/", reloadIgnoringCache() { note(rec.electron, "webContents.window.reloadIgnoringCache()"); }, session: { clearCache: () => Promise.resolve() } };
let registered = null; // the t3code:// handler the loader installed on the stub protocol
const stubElectron = {
  app: {
    getAppPath: () => clientDir,
    whenReady: () => { note(rec.electron, "app.whenReady()"); return Promise.resolve(); },
    on: (...a) => call("app.on", a), once: (...a) => call("app.once", a),
    quit: (...a) => call("app.quit", a),
  },
  ipcMain: {
    handle: (...a) => call("ipcMain.handle", a), handleOnce: (...a) => call("ipcMain.handleOnce", a),
    on: (...a) => call("ipcMain.on", a), once: (...a) => call("ipcMain.once", a),
    removeHandler: (...a) => call("ipcMain.removeHandler", a), removeListener: (...a) => call("ipcMain.removeListener", a),
  },
  protocol: {
    handle: (...a) => call("protocol.handle", a, (scheme, fn) => { if (scheme === "t3code") registered = fn; }),
    unhandle: (...a) => call("protocol.unhandle", a),
  },
  session: { defaultSession: { registerPreloadScript: (...a) => call("session.registerPreloadScript", a, () => "preload-1"), on: (...a) => call("session.on", a) } },
  webContents: { getAllWebContents: () => { note(rec.electron, "webContents.getAllWebContents()"); return scenario.windows ? [window] : []; } },
  net: { fetch: (url) => call("net.fetch", [url], () => Promise.resolve(new Response("<html></html>", { headers: { "content-security-policy": "default-src 'self'", "content-type": "text/html" } }))) },
  shell: { openPath: (...a) => call("shell.openPath", a) },
  dialog: new Proxy({}, { get: (_t, k) => (...a) => call(`dialog.${String(k)}`, a) }),
  BrowserWindow: new Proxy(function BrowserWindow() {}, { get: (_t, k) => (...a) => call(`BrowserWindow.${String(k)}`, a) }),
};
// anything not stubbed above is recorded as a call too, so new surface use shows up in the diff
const electronProxy = new Proxy(stubElectron, {
  get: (t, k) => (k in t || typeof k === "symbol" ? t[k] : new Proxy(function () {}, { get: (_x, m) => (...a) => call(`UNSTUBBED electron.${String(k)}.${String(m)}`, a), apply: (_x, _s, a) => call(`UNSTUBBED electron.${String(k)}()`, a) })),
});

// require("electron") -> stub. Also record what the loader pulls in.
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (recording && !(parent && /zero-cost-harness/.test(parent.filename ?? ""))) {
    if (request === "electron") rec.builtinRequires.add("electron");
    else if (Module.isBuiltin(request)) rec.builtinRequires.add(request.replace(/^node:/, ""));
    else if (request.startsWith(".")) rec.requires.add(norm(path.resolve(path.dirname(parent?.filename ?? ROOT), request)).replace(/(\.cjs|\.js)?$/, ""));
  }
  if (request === "electron") return electronProxy;
  return origLoad.call(this, request, parent, isMain);
};
process.type = "browser";

// ---- run -----------------------------------------------------------------------------------
const flush = () => new Promise((r) => real.setImmediate(() => real.setImmediate(r)));
const sleep = (ms) => new Promise((r) => real.setTimeout(r, ms));
const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { out[path.relative(dir, f) + "/"] = "dir"; walk(f); }
      else out[path.relative(dir, f)] = require("node:crypto").createHash("sha1").update(fs.readFileSync(f)).digest("hex");
    }
  };
  walk(dir);
  return out;
};

(async () => {
  const before = snapshot(TMP);
  const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));
  const resourcesBefore = process.getActiveResourcesInfo().length;
  const logged = [];
  console.log = (...a) => logged.push(a.join(" "));
  console.error = console.log;
  recording = true;
  const t0 = process.hrtime.bigint();

  const loader = require(path.join(ROOT, "src/main/loader.cjs"));
  const result = { requests: {} };
  if (scenario.kind === "cold") {
    const r = loader.cold({ launcher: scenario.launcher });
    result.cold = r;
    // T3 now registers its own protocol handler; the loader's wrapper sits in front of it.
    const t3Handler = (req) => stubElectron.__inner(req);
    stubElectron.__inner = async (req) => {
      const u = new URL(req.url);
      const file = path.join(clientDir, "apps/server/dist/client", u.pathname === "/" ? "index.html" : u.pathname);
      const was = recording;
      recording = false; // T3's own file reads are not loader work
      const body = fs.readFileSync(file);
      recording = was;
      return new Response(body, { headers: { "content-type": u.pathname.endsWith(".js") ? "text/javascript" : "text/html" } });
    };
    // (T3 registering its own protocol is the trigger, not loader work; the loader's reaction is.)
    electronProxy.protocol.handle("t3code", t3Handler);
    await flush();
  } else {
    result.live = await loader.live({ reload: !!scenario.windows });
  }
  const t1 = process.hrtime.bigint();
  recording = false;

  // Requests T3 would make, through whatever handler the loader registered.
  const assetsDir = path.join(clientDir, "apps/server/dist/client/assets");
  const mainChunk = fs.readdirSync(assetsDir).find((f) => /^main-/.test(f));
  const otherChunk = fs.readdirSync(assetsDir).find((f) => /^vendor-/.test(f));
  recording = true;
  for (const [label, p] of [["index.html", "/index.html"], ["otherChunk", `/assets/${otherChunk}`], ["mainChunk", `/assets/${mainChunk}`], ["status", "/__t3mod/status.json"]]) {
    const res = await registered(new Request(`t3code://app${p}`, { headers: { accept: p.endsWith(".html") ? "text/html" : "*/*" } }));
    const text = await res.text();
    recording = false;
    const onDisk = p.startsWith("/__t3mod") ? null : fs.readFileSync(path.join(clientDir, "apps/server/dist/client", p === "/index.html" ? "index.html" : p), "utf8");
    recording = true;
    result.requests[label] = label === "status" ? { mods: Object.keys(JSON.parse(text).mods).sort() } : { modified: text !== onDisk };
  }
  recording = false;

  // Quiescence: give any deferred work (timers, immediates, promises) time to show itself.
  await sleep(120);
  await flush();

  const after = snapshot(TMP);
  const changed = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[k] !== after[k]) changed.push(`${before[k] === undefined ? "created" : after[k] === undefined ? "deleted" : "modified"} ${k}`);
  console.log = real.consoleLog; console.error = real.consoleError;

  const state = globalThis.__t3modMain;
  const report = {
    electron: rec.electron,
    timers: rec.timers,
    listeners: rec.listeners,
    watchers: rec.watchers,
    fsWrites: rec.fsWrites,
    fsChangedUnderTmp: changed.sort(),
    childProcess: rec.childProcess,
    network: rec.network,
    inspector: rec.inspector,
    workers: rec.workers,
    signals: rec.signals,
    replacedChildProcessSpawn: cp.spawn !== harnessCpSpawn,
    newGlobals: Object.getOwnPropertyNames(globalThis).filter((k) => !globalsBefore.has(k)).sort(),
    activeResourcesAdded: process.getActiveResourcesInfo().length - resourcesBefore,
    builtinRequires: [...rec.builtinRequires].sort(),
    requires: [...rec.requires].sort(),
    fsReads: [...rec.fsReads].sort(),
    log: (state?.log ?? []).map((l) => l.replace(/^\S+ /, "")),
    requests: result.requests,
    gateFixtureRan: !!globalThis.__T3MOD_GATE_FIXTURE_RAN,
    statusKeys: Object.keys(state?.status ?? {}).sort(),
    timeMs: Number(t1 - t0) / 1e6,
  };
  real.stdoutWrite("\n@@REPORT@@" + JSON.stringify(report) + "\n");
  process.exit(0);
})().catch((e) => {
  real.consoleError(e.stack ?? e);
  process.exit(1);
});
