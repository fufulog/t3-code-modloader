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

const path = require("node:path");
const fs = require("node:fs");
const modsLib = require("./mods.cjs");
const paths = require("./paths.cjs");

const ROOT = path.resolve(__dirname, "../..");
const STATE_KEY = "__t3modMain";
const MOD_PREFIX = "/__t3mod/";
const SCHEMES = new Set(["t3code", "t3code-dev"]);
const CORE_ID = "core"; // built-in (src/core): the Mods button and modal. Always loaded, not listed.

function state() {
  const s = (globalThis[STATE_KEY] ??= { log: [], status: {}, csp: null, handlerInstalled: false });
  s.catalog ??= []; // fields added after a live-injected older version created the state
  s.owned ??= {};
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
function loadMods({ all = false, t3Version } = {}) {
  // Lazy: compat.cjs and the T3 version are only touched once a user mod is enabled (zero cost with no mods).
  let version;
  const versionOf = () => (version ??= typeof t3Version === "function" ? t3Version() : t3Version);
  const core = modsLib.inspect(path.join(ROOT, "src/core"));
  core.id = CORE_ID;
  const found = modsLib.discover(modsDir());
  const enabled = all ? null : readEnabled(found);
  const mods = [];
  for (const entry of [core, ...found]) {
    entry.enabled = entry === core || !enabled || enabled.has(entry.id);
    if (!entry.usable || !entry.enabled) continue;
    entry.compat = entry === core ? { compatible: true } : require("./compat.cjs").checkCompat(entry.meta, versionOf(), (m) => log(`mod ${entry.id}: ${m}`));
    if (!entry.compat.compatible) continue; // declared incompatible: stays off, code never loaded
    try {
      const exported = modsLib.loadCode(entry, require);
      mods.push({ name: entry.id, entry, ...exported });
    } catch (e) {
      entry.usable = false;
      entry.problems.push(`failed to load: ${e.message}`);
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
    return new Response(JSON.stringify({ mods: s.status, log: s.log.slice(-30) }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
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

/** The running T3's version (the app's package.json version), or "" when unreadable (checks then fail open). */
function t3VersionOf(electron) {
  try {
    return String(electron.app.getVersion() ?? "");
  } catch {
    return "";
  }
}

function refreshMods(electron, opts) {
  const { mods, found, core } = loadMods({ ...opts, t3Version: () => t3VersionOf(electron) });
  const assetDir = assetDirFor(electron);
  const status = verifyMods(assetDir, mods);
  state().assetDir = assetDir;
  for (const entry of [core, ...found]) {
    if (!entry.usable && entry.enabled) status[entry.id] = { ok: false, problems: entry.problems };
    else if (entry.enabled && entry.compat && !entry.compat.compatible) status[entry.id] = { ok: false, problems: [entry.compat.reason] };
  }
  const s = state();
  s.status = status;
  s.mods = mods;
  s.catalog = [core, ...found].map((m) => ({
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
    compat: m.compat ?? { compatible: true },
    ok: m.enabled ? status[m.id]?.ok === true : null,
    problems: [...m.problems.filter((p) => !status[m.id]?.problems?.includes(p)), ...(status[m.id]?.problems ?? [])],
  }));
  // Route the (possibly older) installed handler through this module's code.
  s.dispatch = (request, inner) => makeWrapped(inner, getMods)(request);
}

/** ipcMain that remembers what a mod registered, so unloading it can take the handlers back. */
function trackedIpc(ipcMain, name) {
  const mine = [];
  const remember = (kind) => (channel, fn) => {
    mine.push([kind, channel, fn]);
    return ipcMain[kind](channel, fn);
  };
  const proxy = new Proxy(ipcMain, {
    get: (t, k) => (k === "handle" || k === "on" || k === "once" ? remember(k) : typeof t[k] === "function" ? t[k].bind(t) : t[k]),
  });
  state().owned[name] = mine;
  return proxy;
}

function releaseIpc(ipcMain, name) {
  for (const [kind, channel, fn] of state().owned[name] ?? []) {
    if (kind === "handle") ipcMain.removeHandler(channel);
    else ipcMain.removeListener(channel, fn);
  }
  delete state().owned[name];
}

function setupMain(electron) {
  const { ipcMain, session } = electron;
  const active = new Set(getMods().map((m) => m.name));
  for (const name of Object.keys(state().owned)) if (!active.has(name) || !state().status[name]?.ok) releaseIpc(ipcMain, name);
  for (const mod of getMods()) {
    if (!state().status[mod.name]?.ok || typeof mod.main !== "function") continue;
    releaseIpc(ipcMain, mod.name);
    try {
      mod.main({ electron, ipcMain: trackedIpc(ipcMain, mod.name), log: (...a) => log(`[${mod.name}]`, ...a), isTrustedSender, loader: loaderApi(electron) });
    } catch (e) {
      log(`mod ${mod.name} main() failed: ${e.stack ?? e}`);
    }
  }
  const preload = path.join(__dirname, "preload.cjs");
  const s = state();
  if (!s.preloadId) {
    try {
      s.preloadId = session.defaultSession.registerPreloadScript({ type: "frame", filePath: preload, id: "t3mod-preload" });
      log("preload registered");
    } catch (e) {
      log(`preload registration failed: ${e.message}`);
    }
  }
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
        releaseIpc(electron.ipcMain, m.id);
        step(`Unloaded ${m.name}`);
      }
      if (!loaded.length) step("No mods were loaded");
      s.removed = true;
      s.mods = [];
      s.status = {};
      for (const name of Object.keys(s.owned)) releaseIpc(electron.ipcMain, name);
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

function cold({ launcher } = {}) {
  if (process.type !== "browser") return { skipped: "not the main process" };
  const electron = require("electron");
  const s = state();
  if (s.cold) return { skipped: "already" };
  s.cold = true;
  if (launcher) relaunchThroughLauncher(launcher);

  // Mod main() needs both an app that is ready and verified mods (verification
  // happens when T3 registers its protocol, usually inside whenReady).
  let ready = false, setupDone = false;
  const trySetup = () => {
    if (setupDone || !ready || !state().dispatch) return;
    setupDone = true;
    try {
      setupMain(electron);
    } catch (e) {
      log(`setup failed: ${e.stack ?? e}`);
    }
  };
  const protocol = electron.protocol;
  const original = protocol.handle.bind(protocol);
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
  electron.app.whenReady().then(() => {
    ready = true;
    trySetup();
  });
  log("cold start hooks installed");
  return { ok: true };
}

/**
 * The AppImage updater starts the new AppImage itself (spawn(destination)).
 * Route that through the launcher so mods survive auto-updates.
 */
function relaunchThroughLauncher(launcher) {
  if (!fs.existsSync(launcher)) return;
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
}

// ---- live injection ---------------------------------------------------------

async function live({ reload = true } = {}) {
  const electron = require("electron");
  const { protocol, net } = electron;
  const s = state();
  s.removed = false;
  refreshMods(electron);

  if (!s.handlerInstalled) {
    // Capture the CSP T3 attaches to its documents before replacing the handler.
    try {
      const res = await net.fetch("t3code://app/index.html", { headers: { accept: "text/html" } });
      s.csp = res.headers.get("content-security-policy");
      await res.arrayBuffer();
    } catch (e) {
      log(`csp capture failed: ${e.message}`);
    }
    if (!s.csp) throw new Error("could not capture T3's content-security-policy; refusing to replace the handler without it");
    s.assetDir = assetDirFor(electron);
    const inner = makeStaticHandler(s.assetDir, s.csp);
    protocol.unhandle("t3code");
    protocol.handle("t3code", (request) => state().dispatch(request, inner));
    s.handlerInstalled = true;
    log("live handler installed");
  }
  setupMain(electron);

  if (reload) reloadWindows(electron);
  return { status: s.status, log: s.log.slice(-15) };
}

module.exports = { live, cold, _internals: { patchChunk, verifyMods, loadMods, loaderApi } };
