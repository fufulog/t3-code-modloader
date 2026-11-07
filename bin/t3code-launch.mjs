#!/usr/bin/env node
// Start T3 Code with mods loaded from the first line of its main process.
//
//   t3code-launch.mjs [--appimage PATH] [-- app args...]
//
// 1. Picks the AppImage (--appimage, else newest in the updater's pending dir,
//    else $T3MOD_APPIMAGE).
// 2. Starts it with --inspect-brk on a random 127.0.0.1 port (Electron's
//    EnableNodeCliInspectArguments fuse is on in T3 builds).
// 3. Connects, requires src/main/loader.cjs, calls cold(), resumes, and closes
//    the inspector so the port is gone a moment after launch.
// Any failure: the paused process is killed and T3 is started unmodified.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync, appendFileSync, mkdirSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOADER = join(ROOT, "src/main/loader.cjs");
const LAUNCHER = process.env.T3MOD_LAUNCHER ?? join(homedir(), ".local/bin/t3code-appimage");
const LOG_DIR = join(homedir(), ".t3/userdata/logs");
const PENDING = join(homedir(), ".cache/t3code-updater/pending");

function logLine(msg) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, "t3mod-launch.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

const argv = process.argv.slice(2);
let appImage = process.env.T3MOD_APPIMAGE;
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--appimage") appImage = argv[++i];
  else if (argv[i] === "--") passthrough.push(...argv.slice(i + 1)), (i = argv.length);
  else passthrough.push(argv[i]);
}
if (!appImage && existsSync(PENDING)) {
  appImage = readdirSync(PENDING)
    .filter((f) => /^T3-Code-.*\.AppImage$/.test(f))
    .map((f) => join(PENDING, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
if (!appImage || !existsSync(appImage)) {
  console.error("t3code-launch: no T3 Code AppImage found (use --appimage PATH)");
  process.exit(1);
}

const freePort = () =>
  new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startPlain(reason) {
  logLine(`starting unmodified: ${reason}`);
  const child = spawn(appImage, passthrough, { detached: true, stdio: "ignore" });
  child.unref();
}

async function inject(port) {
  let target;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list[0]?.webSocketDebuggerUrl;
    } catch {}
    if (!target) await sleep(100);
  }
  if (!target) throw new Error("inspector did not come up");
  const ws = new WebSocket(target);
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m), pending.delete(m.id);
    else if (m.method) for (const w of waiters.splice(0)) w.test(m) ? w.res(m) : waiters.push(w);
  });
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", () => rej(new Error("inspector websocket failed")));
  });
  const send = (method, params) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const next = (test) => new Promise((res) => waiters.push({ test, res }));

  // --inspect-brk stops inside Electron's bootstrap, before require() works.
  // Break again on the first line of the app's own code and inject there:
  // modules are usable and T3 has not registered its protocol yet.
  await send("Runtime.enable");
  await send("Debugger.enable");
  const bp = await send("Debugger.setBreakpointByUrl", { urlRegex: String.raw`[/\\]resources[/\\]app(\.asar)?[/\\]`, lineNumber: 0 });
  const hit = next((m) => m.method === "Debugger.paused" && m.params.hitBreakpoints?.length);
  await send("Runtime.runIfWaitingForDebugger");
  await send("Debugger.resume");
  const paused = await hit;
  const frame = paused.params.callFrames[0];
  const expr = `(() => { try { const r = process.getBuiltinModule("module").createRequire(${JSON.stringify(LOADER)}); return JSON.stringify(r(${JSON.stringify(LOADER)}).cold({ launcher: ${JSON.stringify(LAUNCHER)} })); } catch (e) { return "ERR " + (e && e.stack || e); } })()`;
  const res = await send("Debugger.evaluateOnCallFrame", { callFrameId: frame.callFrameId, expression: expr, returnByValue: true });
  const value = res.result?.result?.value ?? `ERR ${JSON.stringify(res.result?.exceptionDetails ?? res.error)}`;
  await send("Debugger.removeBreakpoint", { breakpointId: bp.result.breakpointId });
  await send("Debugger.resume");
  await send("Debugger.disable");
  await send("Runtime.evaluate", { expression: `setTimeout(() => process.getBuiltinModule("inspector").close(), 0); 0` });
  ws.close();
  return `${value} at ${frame.url}:${frame.location.lineNumber + 1}`;
}

const port = await freePort();
const child = spawn(appImage, [`--inspect-brk=127.0.0.1:${port}`, ...passthrough], {
  detached: true,
  // T3MOD_CHILD_LOG=file captures the app's stdout/stderr (debugging only).
  stdio: process.env.T3MOD_CHILD_LOG ? ["ignore", ...Array(2).fill(openSync(process.env.T3MOD_CHILD_LOG, "a"))] : "ignore",
});
child.on("error", (e) => logLine(`spawn failed: ${e.message}`));
const exited = new Promise((_, rej) => child.on("exit", (code) => rej(new Error(`app exited during injection (code ${code})`))));
exited.catch(() => {});
try {
  const result = await Promise.race([inject(port), exited, sleep(20_000).then(() => Promise.reject(new Error("timed out")))]);
  if (typeof result === "string" && result.startsWith("ERR")) logLine(`loader error (T3 resumed unmodified): ${result}`);
  else logLine(`mods loaded into ${appImage} (${result})`);
  child.unref();
  process.exit(0);
} catch (e) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  await sleep(500);
  startPlain(e.message);
  process.exit(0);
}
