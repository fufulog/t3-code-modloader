"use strict";
// T3 Code modloader, main-process side.
//
// Two entry points, one pipeline:
//   cold: bin/t3code-launch.mjs starts T3 with --inspect-brk, calls cold() before
//         T3's main.cjs runs, wraps electron.protocol.handle so the t3code://
//         asset handler serves patched client chunks.
//   live: bin/t3mod-inject.mjs requires this file inside the running main process
//         and calls live(). The t3code:// handler is swapped for one that serves
//         the same asset directory (with the captured CSP) plus patches, then the
//         window reloads.
//
// Patching is all-or-nothing per mod: if any required anchor in any of a mod's
// target chunks fails to match, that mod's patches are skipped everywhere and the
// client keeps running unmodified.
//
// Injection is transactional (see scope.cjs): each mod's main-process setup runs in
// its own scope of disposers. If it throws, or the mod's renderer reports a failed
// setup, everything the mod registered is undone, the mod is marked failed (with a
// short reason, see failures.cjs) and the other mods and T3 carry on. If the loader
// itself cannot inject, everything it did is undone and T3 runs unmodified.

const path = require("node:path");
const fs = require("node:fs");
const modsLib = require("./mods.cjs");
const paths = require("./paths.cjs");
const { createScope, modFacing } = require("./scope.cjs");
const { createFailures, applyFailure, shortReason } = require("./failures.cjs");

const ROOT = path.resolve(__dirname, "../..");
const STATE_KEY = "__t3modMain";
const MOD_PREFIX = "/__t3mod/";
const SCHEMES = new Set(["t3code", "t3code-dev"]);
const CORE_ID = "core"; // built-in (src/core): the Mods button and modal. Always loaded, not listed.

function state() {
  const s = (globalThis[STATE_KEY] ??= { log: [], status: {}, csp: null, handlerInstalled: false });
  s.catalog ??= []; // fields added after a live-injected older version created the state
  s.owned ??= {}; // legacy (pre-scope) IPC bookkeeping, still released on unload
  s.scopes ??= {}; // mod id -> its main-process scope
  s.failures ??= createFailures();
  s.loaderScope ??= createScope("loader", { onError: (m) => log(m) }); // what the loader itself registered (report handler, preload script)
  return s;
}

function log(...parts) {
  const line = `[t3mod] ${parts.join(" ")}`;
  const s = state();
  s.log.push(`${new Date().toISOString()} ${line}`);
  if (s.log.length > 200) s.log.shift();
  try {
    console.log(line);
  } catch {}
}

// ---- mod folder + config ------------------------------------------------------

/** Where mods live: <repo>/mods, or $T3MOD_MODS_DIR. Folders and .zip/.t3mod files both work. */
const modsDir = () => process.env.T3MOD_MODS_DIR || path.join(ROOT, "mods");
const configFile = () => process.env.T3MOD_CONFIG || path.join(paths.configDir(), "config.json");

/**
 * Which mods run is the user's choice, kept in config.json as { enabled: [id...] }.
 * First run (no file): everything found is enabled. Mods dropped in later start
 * out Available, so nothing new runs in T3's main process until it is loaded by hand.
 */
function readEnabled(found) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    if (Array.isArray(cfg.enabled)) return new Set(cfg.enabled.filter((x) => typeof x === "string"));
  } catch {}
  const first = new Set(found.filter((m) => m.usable).map((m) => m.id));
  writeEnabled(first);
  state().createdConfig = configFile(); // a failed injection removes it again (see forgetCreatedConfig)
  return first;
}

function writeEnabled(set) {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify({ enabled: [...set].sort() }, null, 2) + "\n");
  } catch (e) {
    log(`could not save ${configFile()}: ${e.message}`);
  }
}

/**
 * Discover mods and instantiate the ones to run. `all` (tests) ignores the config
 * and loads every usable mod. Returns { mods, found }.
 */
function loadMods({ all = false } = {}) {
  const core = modsLib.inspect(path.join(ROOT, "src/core"));
  core.id = CORE_ID;
  const found = modsLib.discover(modsDir());
  const enabled = all ? null : readEnabled(found);
  const mods = [];
  for (const entry of [core, ...found]) {
    entry.enabled = entry === core || !enabled || enabled.has(entry.id);
    if (!entry.usable || !entry.enabled) continue;
    try {
      const exported = modsLib.loadCode(entry, require);
      mods.push({ name: entry.id, entry, ...exported });
    } catch (e) {
      entry.usable = false;
      entry.problems.push(`failed to load: ${e.message}`);
      entry.failure = state().failures.fail(entry.id, "load", e);
    }
  }
  return { mods, found, core };
}

// ---- chunk patching -------------------------------------------------------

/** Patch one chunk's source. Returns { text, applied: [modName...] }. */
function patchChunk(pathname, source, mods, verdicts) {
  const base = pathname.split("/").pop();
  let text = source;
  const applied = [];
  for (const mod of mods) {
    if (verdicts[mod.name]?.ok === false) continue;
    const targets = (mod.patches ?? []).filter((p) => p.file.test(base));
    if (!targets.length) continue;
    let next = text;
    for (const p of targets) {
      // optional patches add extras (a mod must work without them): a miss skips the patch
      if (!p.optional) next = p.apply(next);
      else {
        try {
          next = p.apply(next);
        } catch (e) {
          log(`optional patch ${mod.name}/${p.id} skipped: ${e.message}`);
        }
      }
    }
    text = next;
    applied.push(mod.name);
  }
  return { text, applied };
}

/**
 * Dry-run every mod against every chunk in the asset directory so a mod is only
 * enabled when all of its anchors match. Cheap: a few regexes over ~6 files.
 */
function verifyMods(assetDir, mods) {
  const assets = path.join(assetDir, "assets");
  const files = fs.readdirSync(assets).filter((f) => f.endsWith(".js"));
  const verdicts = {};
  for (const mod of mods) {
    const problems = [];
    const optionalMisses = [];
    for (const p of mod.patches ?? []) {
      const miss = p.optional ? optionalMisses : problems;
      const hits = files.filter((f) => p.file.test(f));
      if (hits.length !== 1) {
        miss.push(`${p.id}: expected 1 chunk matching ${p.file}, found ${hits.length}`);
        continue;
      }
      try {
        p.apply(fs.readFileSync(path.join(assets, hits[0]), "utf8"));
      } catch (e) {
        miss.push(`${p.id}: ${e.message}`);
      }
    }
    if (optionalMisses.length) log(`mod ${mod.name}: optional patches unavailable: ${optionalMisses.join("; ")}`);
    verdicts[mod.name] = { ok: problems.length === 0, problems, ...(optionalMisses.length ? { optionalMisses } : {}) };
    log(`mod ${mod.name}: ${problems.length ? "DISABLED " + problems.join("; ") : "ok"}`);
  }
  return verdicts;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".webmanifest": "application/manifest+json",
      ".map": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".jpg": "image/jpeg",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".wasm": "application/wasm",
      ".txt": "text/plain; charset=utf-8",
    }[ext] ?? "application/octet-stream"
  );
}

/** Serve /__t3mod/<mod>/<file> from a mod's client/ files (folder or zip, same path). */
function serveModAsset(pathname, mods) {
  const rest = pathname.slice(MOD_PREFIX.length);
  if (rest === "status.json") {
    const s = state();
    return new Response(JSON.stringify({ mods: s.status, loader: s.loaderError ? { failed: s.loaderError } : { ok: true }, log: s.log.slice(-30) }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (rest === "kit.js") {
    // renderer-side registration helpers (see src/client/kit.js)
    return new Response(fs.readFileSync(path.join(ROOT, "src/client/kit.js")), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
  }
  if (rest === "chunks.json") {
    // T3's own chunk file names (hashed), so a mod can import() the same module instance T3 uses
    let files = [];
    try {
      files = fs.readdirSync(path.join(state().assetDir, "assets")).filter((f) => f.endsWith(".js"));
    } catch {}
    return new Response(JSON.stringify(files), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const [modName, ...fileParts] = rest.split("/");
  const mod = mods.find((m) => m.name === modName);
  if (!mod || state().status[modName]?.ok !== true) return new Response(null, { status: 404 });
  let rel;
  try {
    rel = decodeURIComponent(fileParts.join("/"));
  } catch {
    return new Response(null, { status: 400 });
  }
  const body = mod.entry.files.read(`client/${rel}`);
  if (!body) return new Response(null, { status: 404 });
  return new Response(body, { headers: { "content-type": contentType(rel), "cache-control": "no-store" } });
}

function makeWrapped(inner, getMods) {
  return async (request) => {
    if (state().removed) return inner(request); // "Remove modloader" ran: serve T3 untouched
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return inner(request);
    }
    const mods = getMods();
    if (url.pathname.startsWith(MOD_PREFIX)) return serveModAsset(url.pathname, mods);
    const response = await inner(request);
    if (!response || !response.ok || !url.pathname.startsWith("/assets/") || !url.pathname.endsWith(".js")) return response;
    const base = url.pathname.split("/").pop();
    const relevant = mods.some((m) => state().status[m.name]?.ok && (m.patches ?? []).some((p) => p.file.test(base)));
    if (!relevant) return response;
    try {
      const source = await response.text();
      const { text, applied } = patchChunk(url.pathname, source, mods, state().status);
      if (applied.length) log(`patched ${base} (${applied.join(",")})`);
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.set("cache-control", "no-store");
      return new Response(text, { status: response.status, statusText: response.statusText, headers });
    } catch (e) {
      log(`patch failed for ${base}: ${e.stack ?? e}`);
      return inner(request);
    }
  };
}

// ---- static handler for live mode ------------------------------------------

function makeStaticHandler(assetDir, csp) {
  const withCsp = (res) => {
    if (csp) res.headers.set("content-security-policy", csp);
    return res;
  };
  return async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    let file = path.resolve(assetDir, "." + rel);
    if (!file.startsWith(assetDir + path.sep)) return new Response(null, { status: 403 });
    const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(rel) !== "" && !wantsHtml) return new Response(null, { status: 404 });
      file = path.join(assetDir, "index.html");
    }
    const body = request.method === "HEAD" ? null : fs.readFileSync(file);
    return withCsp(new Response(body, { headers: { "content-type": contentType(file) } }));
  };
}

// ---- shared setup -----------------------------------------------------------

const getMods = () => state().mods ?? [];

function assetDirFor(electron) {
  return path.join(electron.app.getAppPath(), "apps/server/dist/client");
}

function refreshMods(electron, opts) {
  const s = state();
  // main/load failures are re-derived on every scan; a renderer failure sticks until the window reloads
  s.failures.clear(undefined, ["load", "main"]);
  const { mods, found, core } = loadMods(opts);
  const assetDir = assetDirFor(electron);
  const status = verifyMods(assetDir, mods);
  for (const entry of [core, ...found]) {
    if (!entry.usable && entry.enabled) status[entry.id] = { ok: false, problems: entry.problems, ...(entry.failure ? { failure: entry.failure } : {}) };
  }
  const catalog = [core, ...found].map((m) => ({
    builtin: m === core,
    id: m.id,
    name: m.name,
    version: m.version,
    author: m.author,
    description: m.description,
    markdown: m.markdown,
    kind: m.kind,
    file: m.file,
    enabled: m.enabled,
    ok: m.enabled ? status[m.id]?.ok === true : null,
    failure: status[m.id]?.failure ?? null,
    problems: [...m.problems.filter((p) => !status[m.id]?.problems?.includes(p)), ...(status[m.id]?.problems ?? [])],
  }));
  for (const [id, failure] of Object.entries(s.failures.all())) if (failure.phase === "renderer" && status[id]) applyFailure(status, catalog, id, failure);
  // Commit only now: a throw above leaves the previous state untouched.
  s.assetDir = assetDir;
  s.status = status;
  s.mods = mods;
  s.catalog = catalog;
  // Route the (possibly older) installed handler through this module's code.
  s.dispatch = (request, inner) => makeWrapped(inner, getMods)(request);
}

// ---- per-mod transactions ----------------------------------------------------

/** ipcMain as a mod sees it: handle/on/once go through the mod's scope, so unloading takes them back. */
function trackedIpc(ipcMain, scope) {
  const tracked = {
    handle: (channel, fn) => void scope.ipcHandle(ipcMain, channel, fn),
    on: (channel, fn) => void scope.ipcOn(ipcMain, channel, fn, "on"),
    once: (channel, fn) => void scope.ipcOn(ipcMain, channel, fn, "once"),
  };
  return new Proxy(ipcMain, { get: (t, k) => (Object.hasOwn(tracked, k) ? tracked[k] : typeof t[k] === "function" ? t[k].bind(t) : t[k]) });
}

/** Undo everything a mod registered in the main process. The one cleanup path: failure, unload, disable, hot reload. */
function unloadMod(electron, id) {
  const s = state();
  const scope = s.scopes[id];
  delete s.scopes[id];
  scope?.dispose();
  for (const [kind, channel, fn] of s.owned[id] ?? []) {
    // handlers registered by an older loader version that tracked them in `owned`
    if (kind === "handle") electron.ipcMain.removeHandler(channel);
    else electron.ipcMain.removeListener(channel, fn);
  }
  delete s.owned[id];
}

/** A mod failed: undo all of it, mark it failed with the reason, leave everything else running. */
function failMod(electron, id, phase, error) {
  const s = state();
  const failure = s.failures.fail(id, phase, error);
  unloadMod(electron, id);
  applyFailure(s.status, s.catalog, id, failure);
  log(`mod ${id} FAILED (${phase}): ${failure.reason}; everything it registered was undone`);
  return failure;
}

/** Run one mod's main() inside its own scope; a throw or a rejected promise rolls the mod back. */
function loadMain(electron, mod) {
  const s = state();
  const scope = createScope(mod.name, { onError: (m) => log(m) });
  s.scopes[mod.name] = scope;
  const fail = (e) => {
    if (s.scopes[mod.name] !== scope) return; // already unloaded or reloaded
    failMod(electron, mod.name, "main", e);
  };
  try {
    const result = mod.main({
      electron,
      ipcMain: trackedIpc(electron.ipcMain, scope),
      scope: modFacing(scope, electron.ipcMain),
      log: (...a) => log(`[${mod.name}]`, ...a),
      isTrustedSender,
      loader: loaderApi(electron),
    });
    if (result && typeof result.then === "function") result.then(undefined, fail);
  } catch (e) {
    log(`mod ${mod.name} main() failed: ${e.stack ?? e}`);
    fail(e);
  }
}

function setupMain(electron, tx) {
  const s = state();
  const active = new Set(getMods().map((m) => m.name));
  for (const name of new Set([...Object.keys(s.scopes), ...Object.keys(s.owned)])) if (!active.has(name) || !s.status[name]?.ok) unloadMod(electron, name);
  for (const mod of getMods()) {
    if (!s.status[mod.name]?.ok || typeof mod.main !== "function") continue;
    unloadMod(electron, mod.name);
    loadMain(electron, mod);
  }
  // Loader-owned registrations: if anything here throws, the caller rolls the whole loader back.
  const loaderScope = tx ?? s.loaderScope;
  if (!s.reportHandled) {
    loaderScope.ipcHandle(electron.ipcMain, REPORT_CHANNEL, (event, payload) => reportFromRenderer(electron, event, payload));
    s.reportHandled = true;
    loaderScope.defer(() => (s.reportHandled = false), "report flag");
  }
  if (!s.preloadId) {
    const session = electron.session.defaultSession;
    const id = session.registerPreloadScript({ type: "frame", filePath: path.join(__dirname, "preload.cjs"), id: "t3mod-preload" });
    s.preloadId = id;
    loaderScope.defer(() => {
      s.preloadId = null;
      session.unregisterPreloadScript?.(id);
    }, "preload script");
    log("preload registered");
  }
}

const REPORT_CHANNEL = "t3mod:loader:report";

/** A mod's renderer runtime says its setup failed (it already undid its own renderer side). */
function reportFromRenderer(electron, event, payload) {
  if (!isTrustedSender(event)) return { ok: false, error: "untrusted sender" };
  const id = payload?.mod;
  if (typeof id !== "string" || !state().status[id]) return { ok: false, error: "unknown mod" };
  if (payload.phase !== "renderer" || typeof payload.error !== "string") return { ok: false, error: "bad arguments" };
  failMod(electron, id, "renderer", payload.error);
  return { ok: true };
}

/** Injection failed: a config.json that only this run created goes away again (and its folder, if empty). */
function forgetCreatedConfig(undo) {
  const s = state();
  const file = s.createdConfig;
  s.createdConfig = null;
  if (!undo || !file) return;
  try {
    fs.rmSync(file, { force: true });
    fs.rmdirSync(path.dirname(file));
  } catch {}
}

function resetLoaderScope() {
  const s = state();
  s.loaderScope?.dispose();
  s.loaderScope = createScope("loader", { onError: (m) => log(m) });
}

/**
 * The loader could not inject: undo every mod and everything the loader registered, and make
 * the t3code:// handler pass requests straight through, so T3 runs unmodified.
 */
function deactivate(electron, tx, error) {
  const s = state();
  for (const id of new Set([...Object.keys(s.scopes), ...Object.keys(s.owned)])) unloadMod(electron, id);
  tx?.dispose();
  resetLoaderScope();
  s.removed = true;
  s.mods = [];
  s.status = {};
  s.catalog = [];
  s.loaderError = shortReason(error);
  forgetCreatedConfig(true);
  log(`loader FAILED: ${s.loaderError}; T3 runs unmodified`);
}

/** What the built-in Mods modal may ask of the loader (reached over IPC by src/core). */
function loaderApi(electron) {
  const installer = () => require("../install/install.cjs");
  const view = () => {
    const inst = installer().status();
    return { modsDir: modsDir(), mods: state().catalog, install: { installed: inst.installed, target: inst.target ?? null } };
  };
  const api = {
    list: view,
    rescan() {
      refreshMods(electron);
      setupMain(electron);
      return view();
    },
    setEnabled(id, on) {
      return api.setEnabledMany({ [id]: on });
    },
    /** Load and unload several mods at once (`{id: boolean}`): one config write, one reload. */
    setEnabledMany(changes) {
      const enabled = new Set(state().catalog.filter((m) => m.enabled && !m.builtin).map((m) => m.id));
      const done = [];
      for (const [id, on] of Object.entries(changes)) {
        const entry = state().catalog.find((m) => m.id === id);
        if (!entry) throw new Error(`no such mod: ${id}`);
        if (entry.builtin) throw new Error("the modloader's own UI cannot be unloaded; use Remove modloader");
        if (enabled.has(id) === on) continue;
        on ? enabled.add(id) : enabled.delete(id);
        state().failures.clear(id); // a fresh load attempt after the window reloads
        done.push(`${on ? "loaded" : "unloaded"} ${id}`);
      }
      if (!done.length) return view();
      writeEnabled(enabled);
      refreshMods(electron);
      setupMain(electron);
      for (const line of done) log(line);
      // Patches apply as chunks are fetched, so the window reloads; let the IPC reply go out first.
      setTimeout(() => reloadWindows(electron), 120);
      return view();
    },
    openFolder() {
      fs.mkdirSync(modsDir(), { recursive: true });
      return electron.shell.openPath(modsDir());
    },
    /**
     * Take the modloader out, in order: every mod, then the Mods UI, then what the
     * installer put into T3 (see src/install). The window reloads afterwards, unmodified.
     */
    removeModloader() {
      const steps = [];
      const step = (label, ok = true, detail) => steps.push({ label, ok, ...(detail ? { detail } : {}) });
      const s = state();
      const loaded = s.catalog.filter((m) => m.enabled && !m.builtin);
      writeEnabled(new Set());
      for (const m of loaded) {
        unloadMod(electron, m.id);
        step(`Unloaded ${m.name}`);
      }
      if (!loaded.length) step("No mods were loaded");
      s.removed = true;
      s.mods = [];
      s.status = {};
      for (const name of new Set([...Object.keys(s.scopes), ...Object.keys(s.owned)])) unloadMod(electron, name);
      resetLoaderScope(); // report handler, preload script
      step("Removed the Mods window and button");
      try {
        steps.push(...installer().uninstall({ log: (m) => log(m) }));
      } catch (e) {
        step("Could not restore T3's files", false, e.message);
      }
      log("modloader removed");
      setTimeout(() => reloadWindows(electron), 3000);
      return { steps };
    },
  };
  return api;
}

function reloadWindows(electron) {
  for (const wc of electron.webContents.getAllWebContents()) {
    if (wc.getType() === "window" && wc.getURL().startsWith("t3code://app/")) {
      wc.session.clearCache?.().catch(() => {});
      wc.reloadIgnoringCache();
    }
  }
}

/** Only the T3 app document itself may call mod IPC (never browser previews). */
function isTrustedSender(event) {
  try {
    const frame = event.senderFrame;
    if (!frame || frame.parent) return false;
    const url = new URL(frame.url);
    return SCHEMES.has(url.protocol.replace(/:$/, "")) && url.host === "app";
  } catch {
    return false;
  }
}

// ---- cold start (launcher, --inspect-brk) ------------------------------------
//
// bin/t3code-launch.mjs starts T3 paused at the first line of its main script,
// requires this file and calls cold({ launcher }) before resuming. We wrap
// electron.protocol.handle so T3's own t3code:// handler is patched as it
// registers. (NODE_OPTIONS --require is ignored by Electron in packaged apps.)

function cold({ launcher, electron: injected } = {}) {
  if (!injected && process.type !== "browser") return { skipped: "not the main process" };
  const electron = injected ?? require("electron");
  const s = state();
  if (s.cold) return { skipped: "already" };
  s.cold = true;
  const tx = createScope("loader", { onError: (m) => log(m) }); // undone as a whole if the hooks cannot be installed

  try {
    if (launcher) tx.defer(relaunchThroughLauncher(launcher), "launcher spawn hook");

    // Mod main() needs both an app that is ready and verified mods (verification
    // happens when T3 registers its protocol, usually inside whenReady).
    let ready = false, setupDone = false;
    const trySetup = () => {
      if (setupDone || !ready || !state().dispatch) return;
      setupDone = true;
      const attempt = createScope("loader", { onError: (m) => log(m) });
      try {
        setupMain(electron, attempt);
        s.loaderScope.adopt(attempt);
        forgetCreatedConfig(false);
      } catch (e) {
        log(`setup failed: ${e.stack ?? e}`);
        deactivate(electron, attempt, e);
      }
    };
    const protocol = electron.protocol;
    const originalHandle = protocol.handle;
    const original = originalHandle.bind(protocol);
    protocol.handle = (scheme, handler) => {
      if (!SCHEMES.has(scheme)) return original(scheme, handler);
      try {
        refreshMods(electron);
      } catch (e) {
        log(`mod load failed: ${e.stack ?? e}`);
      }
      if (!state().dispatch) return original(scheme, handler);
      s.handlerInstalled = true;
      const result = original(scheme, (request) => {
        try {
          return state().dispatch(request, handler);
        } catch {
          return handler(request);
        }
      });
      trySetup();
      return result;
    };
    tx.defer(() => (protocol.handle = originalHandle), "protocol.handle hook");
    electron.app.whenReady().then(() => {
      ready = true;
      trySetup();
    });
    log("cold start hooks installed");
  } catch (e) {
    tx.dispose();
    s.cold = false;
    log(`cold start FAILED: ${e.message}; T3 runs unmodified`);
    throw e;
  }
  // The hooks stay for the life of the process; their undo is kept so Remove modloader can run it.
  s.loaderScope.adopt(tx);
  return { ok: true };
}

/**
 * The AppImage updater starts the new AppImage itself (spawn(destination)).
 * Route that through the launcher so mods survive auto-updates. Returns the undo.
 */
function relaunchThroughLauncher(launcher) {
  if (!fs.existsSync(launcher)) return () => {};
  const cp = require("node:child_process");
  const orig = cp.spawn;
  cp.spawn = function (file, args, opts) {
    if (typeof file === "string" && /\.AppImage$/.test(file) && !(opts?.env ?? process.env).APPIMAGE_EXIT_AFTER_INSTALL && !state().removed && fs.existsSync(launcher)) {
      log(`relaunching ${file} through launcher`);
      return orig.call(this, launcher, ["--appimage", file, ...(Array.isArray(args) ? args : [])], Array.isArray(args) ? opts : args);
    }
    return orig.apply(this, arguments);
  };
  // ESM `import { spawn } from "node:child_process"` reads a snapshot; refresh it.
  require("node:module").syncBuiltinESMExports();
  return () => {
    if (cp.spawn !== orig) cp.spawn = orig;
    require("node:module").syncBuiltinESMExports();
  };
}

// ---- live injection ---------------------------------------------------------

async function live({ reload = true, electron: injected } = {}) {
  const electron = injected ?? require("electron");
  const { protocol, net } = electron;
  const s = state();
  const tx = createScope("loader", { onError: (m) => log(m) }); // loader-owned registrations of this run
  s.createdConfig = null;
  let touched = false; // past this point earlier state may have been changed
  try {
    refreshMods(electron); // assigns state only when it fully succeeded
    let inner = null;
    if (!s.handlerInstalled) {
      // Capture the CSP T3 attaches to its documents before replacing the handler.
      let csp = null;
      try {
        const res = await net.fetch("t3code://app/index.html", { headers: { accept: "text/html" } });
        csp = res.headers.get("content-security-policy");
        await res.arrayBuffer();
      } catch (e) {
        log(`csp capture failed: ${e.message}`);
      }
      if (!csp) throw new Error("could not capture T3's content-security-policy; refusing to replace the handler without it");
      s.csp = csp;
      s.assetDir = assetDirFor(electron);
      inner = makeStaticHandler(s.assetDir, csp);
    }
    touched = true;
    s.removed = false;
    setupMain(electron, tx);
    if (inner) {
      // Last step, so a failure before it leaves T3's own handler in place. unhandle + handle is
      // the one swap that cannot be undone to the original; if handle() throws, a plain static
      // handler (same files, same CSP, no patches) goes in so T3 keeps serving.
      protocol.unhandle("t3code");
      try {
        protocol.handle("t3code", (request) => state().dispatch(request, inner));
      } catch (e) {
        try {
          protocol.handle("t3code", inner);
          log("fell back to a plain static handler");
        } catch (e2) {
          log(`CRITICAL: could not restore a t3code:// handler: ${e2.message}`);
        }
        throw e;
      }
      s.handlerInstalled = true;
      log("live handler installed");
    }
    s.loaderScope.adopt(tx);
    s.loaderError = null;
    forgetCreatedConfig(false);
  } catch (e) {
    if (touched) deactivate(electron, tx, e);
    else {
      tx.dispose();
      s.loaderError = shortReason(e);
      forgetCreatedConfig(true);
      log(`loader FAILED before changing anything: ${s.loaderError}`);
    }
    throw e;
  }

  if (reload) reloadWindows(electron);
  return { status: s.status, log: s.log.slice(-15) };
}

module.exports = { live, cold, _internals: { patchChunk, verifyMods, loadMods, loaderApi, setupMain, refreshMods, failMod, unloadMod, state } };
