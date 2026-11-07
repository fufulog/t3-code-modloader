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

const ROOT = path.resolve(__dirname, "../..");
const STATE_KEY = "__t3modMain";
const MOD_PREFIX = "/__t3mod/";
const SCHEMES = new Set(["t3code", "t3code-dev"]);

function state() {
  if (!globalThis[STATE_KEY]) globalThis[STATE_KEY] = { log: [], status: {}, csp: null, handlerInstalled: false };
  return globalThis[STATE_KEY];
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

function loadMods() {
  const modsDir = path.join(ROOT, "src/mods");
  const mods = [];
  for (const name of fs.readdirSync(modsDir).sort()) {
    const entry = path.join(modsDir, name, "mod.cjs");
    if (!fs.existsSync(entry)) continue;
    delete require.cache[entry];
    const mod = require(entry);
    mods.push({ name, dir: path.join(modsDir, name), ...mod });
  }
  return mods;
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
    for (const p of targets) next = p.apply(next);
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
    for (const p of mod.patches ?? []) {
      const hits = files.filter((f) => p.file.test(f));
      if (hits.length !== 1) {
        problems.push(`${p.id}: expected 1 chunk matching ${p.file}, found ${hits.length}`);
        continue;
      }
      try {
        p.apply(fs.readFileSync(path.join(assets, hits[0]), "utf8"));
      } catch (e) {
        problems.push(`${p.id}: ${e.message}`);
      }
    }
    verdicts[mod.name] = { ok: problems.length === 0, problems };
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

/** Serve /__t3mod/<mod>/<file> from a mod's `client/` directory. */
function serveModAsset(pathname, mods) {
  const rest = pathname.slice(MOD_PREFIX.length);
  if (rest === "status.json") {
    const s = state();
    return new Response(JSON.stringify({ mods: s.status, log: s.log.slice(-30) }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const [modName, ...fileParts] = rest.split("/");
  const mod = mods.find((m) => m.name === modName);
  if (!mod || state().status[modName]?.ok !== true) return new Response(null, { status: 404 });
  const clientDir = path.join(mod.dir, "client");
  const file = path.resolve(clientDir, fileParts.join("/"));
  if (!file.startsWith(clientDir + path.sep) || !fs.existsSync(file)) return new Response(null, { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "content-type": contentType(file), "cache-control": "no-store" } });
}

function makeWrapped(inner, getMods) {
  return async (request) => {
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

function refreshMods(electron) {
  const mods = loadMods();
  state().status = verifyMods(assetDirFor(electron), mods);
  state().mods = mods;
  // Route the (possibly older) installed handler through this module's code.
  state().dispatch = (request, inner) => makeWrapped(inner, getMods)(request);
}

function setupMain(electron) {
  const { ipcMain, session } = electron;
  for (const mod of getMods()) {
    if (!state().status[mod.name]?.ok || typeof mod.main !== "function") continue;
    try {
      mod.main({ electron, ipcMain, log: (...a) => log(`[${mod.name}]`, ...a), isTrustedSender });
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
    if (typeof file === "string" && /\.AppImage$/.test(file) && !(opts?.env ?? process.env).APPIMAGE_EXIT_AFTER_INSTALL) {
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
  const { protocol, net, webContents } = electron;
  const s = state();
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

  if (reload) {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.getType() === "window" && wc.getURL().startsWith("t3code://app/")) {
        wc.session.clearCache?.().catch(() => {});
        wc.reloadIgnoringCache();
      }
    }
  }
  return { status: s.status, log: s.log.slice(-15) };
}

module.exports = { live, cold, _internals: { patchChunk, verifyMods, loadMods } };
