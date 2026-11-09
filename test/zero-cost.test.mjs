// Zero-cost-with-no-mods gate (ROADMAP "6. Quality"; pre-push hook and CI run it).
//
// WHAT "NO MODS" MEANS HERE
//   No user mods are enabled: mods/ is empty, or holds mods that are installed but not
//   in config.json's `enabled` list. The built-in `core` mod (src/core) is NOT a user
//   mod: it owns the Mods button and window, is always loaded, and is the only way to
//   enable anything, so it is part of the baseline. Everything the loader does on this
//   path is listed below in BASELINE, reviewed by hand. Anything not listed is new work
//   and fails the gate with a diff.
//
// HOW
//   test/helpers/zero-cost-harness.cjs runs the real src/main/loader.cjs against a stub
//   T3 (fake Electron app / ipcMain / protocol / session / net / webContents, a fake
//   client asset directory, all inside a temp directory) in a child process, with timers,
//   emitter listeners, fs writes and watchers, child processes, network, workers, the
//   inspector and signals instrumented. It records and prints one JSON report; this file
//   compares it with the allowlist. No real T3 is needed, nothing outside the temp
//   directory is touched.
//
// CHANGING THE BASELINE
//   If you add work to the no-mods path on purpose, update BASELINE below in the same
//   commit and say why in the commit message. A reviewer reads the diff of this file.
//
// TIMING
//   Startup time is noisy, so it is ADVISORY only: over TIME_BUDGET_MS it prints a
//   warning. Set T3MOD_GATE_TIMING=strict to make it fail. The structure checks are the gate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = join(ROOT, "test/helpers/zero-cost-harness.cjs");
const TIME_BUDGET_MS = 250; // advisory; typical is a few ms
const STRICT_TIMING = process.env.T3MOD_GATE_TIMING === "strict";

// ---- scenarios ---------------------------------------------------------------------------------
// A mod that must never run when disabled: loading its code would set the flag, register a
// handler and start an interval.
const TRAP_MOD = {
  "trap/mod.md": "---\nname: Trap\n---\nInstalled but not enabled.",
  "trap/mod.cjs": `globalThis.__T3MOD_GATE_FIXTURE_RAN = true; setInterval(() => {}, 1000);
module.exports = { patches: [{ id: "x", file: /^main-/, apply: (s) => s + "//trap" }], main({ ipcMain }) { ipcMain.handle("t3mod:trap:x", () => 1); } };`,
};
// A mod that does everything the gate forbids. Used only to prove the detectors can fire.
const NOISY_MOD = {
  "noisy/mod.md": "---\nname: Noisy\n---\nDetector self-test.",
  "noisy/mod.cjs": `module.exports = {
  patches: [{ id: "x", file: /^main-/, apply: (s) => s + "//noisy" }],
  main({ ipcMain }) {
    const fs = require("node:fs"), cp = require("node:child_process"), net = require("node:net"), inspector = require("node:inspector");
    setInterval(() => {}, 1000); setTimeout(() => {}, 5000); setImmediate(() => {});
    process.on("SIGUSR2", () => {});
    ipcMain.handle("t3mod:noisy:x", () => 1);
    fs.watch(__dirname); fs.writeFileSync(require("node:path").join(__dirname, "stray.txt"), "x");
    cp.spawn("sh", ["-c", "true"]); net.connect(1, "127.0.0.1");
    inspector.open(0, "127.0.0.1"); process.kill(process.pid, "SIGUSR1");
  },
};`,
};

const SCENARIOS = {
  "cold, mods/ empty, config says nothing enabled": { run: { kind: "cold" }, fixture: { config: { enabled: [] } } },
  "cold, a mod installed but not enabled": { run: { kind: "cold" }, fixture: { config: { enabled: [] }, mods: TRAP_MOD } },
  "cold, first run (no config.json yet)": { run: { kind: "cold" }, fixture: {} },
  "cold, started by the launcher": { run: { kind: "cold", launcher: "<launcher>" }, fixture: { config: { enabled: [] } } },
  "live injection, mods/ empty": { run: { kind: "live" }, fixture: { config: { enabled: [] } } },
};

// ---- scenario plumbing ---------------------------------------------------------------------
const MAIN_CHUNK = "(0,J.jsx)(Btn,{icon:(0,J.jsx)(Ic,{}),label:`Usage`,onClick:h})";
function stubT3(tmp, { config, mods = {} }) {
  const put = (rel, text) => {
    mkdirSync(dirname(join(tmp, rel)), { recursive: true });
    writeFileSync(join(tmp, rel), text);
  };
  const dist = "client/apps/server/dist/client";
  put(`${dist}/index.html`, "<!doctype html><title>stub t3</title>");
  put(`${dist}/assets/main-abc123.js`, `const sidebar=[${MAIN_CHUNK}];export{sidebar};`);
  put(`${dist}/assets/vendor-def456.js`, "export const v=1;");
  mkdirSync(join(tmp, "mods"), { recursive: true });
  mkdirSync(join(tmp, "cfg"), { recursive: true });
  for (const [rel, text] of Object.entries(mods)) put(`mods/${rel}`, text);
  if (config !== undefined) put("config.json", JSON.stringify(config));
}
function run(scenario, label) {
  const tmp = mkdtempSync(join(tmpdir(), "t3mod-gate-"));
  try {
    stubT3(tmp, scenario.fixture ?? {});
    const env = {
      PATH: process.env.PATH,
      ...(process.env.GATE_DEBUG ? { GATE_DEBUG: "1" } : {}),
      HOME: tmp,
      XDG_CONFIG_HOME: join(tmp, "xdg"),
      T3MOD_MODS_DIR: join(tmp, "mods"),
      T3MOD_CONFIG: join(tmp, "config.json"),
      T3MOD_CONFIG_DIR: join(tmp, "cfg"),
      T3MOD_DATA_DIR: join(tmp, "data"),
    };
    const run = { ...scenario.run, tmp };
    if (run.launcher) {
      run.launcher = join(tmp, "launcher.mjs");
      writeFileSync(run.launcher, "// stub launcher\n");
    }
    const arg = JSON.stringify(run);
    const r = spawnSync(process.execPath, [HARNESS, arg], { env, encoding: "utf8", timeout: 30_000 });
    const line = r.stdout.split("\n").find((l) => l.startsWith("@@REPORT@@"));
    if (!line) throw new Error(`[${label}] harness produced no report (exit ${r.status}):\n${r.stderr}\n${r.stdout}`);
    return JSON.parse(line.slice("@@REPORT@@".length));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.env.T3MOD_GATE_PRINT) {
  // helper for reviewing/updating the baseline: prints the raw reports
  const out = {};
  for (const [name, sc] of Object.entries(SCENARIOS)) out[name] = run(sc, name);
  out["selftest noisy"] = run({ run: { kind: "cold" }, fixture: { config: { enabled: ["noisy"] }, mods: NOISY_MOD } }, "noisy");
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// ---- the reviewed baseline -------------------------------------------------------------
// Everything the loader may do with no user mods enabled. Each key is a category the gate
// watches; an empty list means "nothing, ever". Paths: <root> = the repo, <tmp> = the stub.

// Reads (never writes): list mod folders, read the core mod, check the core patch against T3's main chunk.
const READS = [
  "<root>/src/core", "<root>/src/core/mod.cjs", "<root>/src/core/mod.md", "<root>/src/core/patches.cjs",
  "<root>/src/main/loader.cjs", "<root>/src/main/mods.cjs", "<root>/src/main/paths.cjs", "<root>/src/main/zip.cjs",
  "<tmp>/client/apps/server/dist/client/assets", "<tmp>/client/apps/server/dist/client/assets/main-abc123.js",
  "<tmp>/config.json", "<tmp>/mods",
];
// What the loader does to the stub T3, in order: take over the t3code:// handler and register the Mods
// window's single IPC channel and the sandboxed preload. Nothing else on `electron`.
const COLD_ELECTRON = [
  "app.whenReady()",
  "protocol.handle(t3code, <fn>)",
  "ipcMain.handle(t3mod:core:ops, <fn>)",
  'session.registerPreloadScript({"type":"frame","filePath":"preload.cjs","id":"t3mod-preload"})',
];
const BASE = {
  electron: COLD_ELECTRON,
  timers: [], // no setTimeout / setInterval / setImmediate
  listeners: [], // no EventEmitter listeners (process, streams, ...)
  watchers: [], // no fs.watch / watchFile
  fsWrites: [], // no file writes
  fsChangedUnderTmp: [], // independent check: the temp tree is byte-identical afterwards
  childProcess: [],
  network: [],
  inspector: [], // the inspector is only ever opened by the injector (SIGUSR1), never by the loader
  workers: [],
  signals: [],
  replacedChildProcessSpawn: false,
  newGlobals: ["__t3modMain"], // the loader's one global (its state)
  activeResourcesAdded: 0, // no live timers, sockets, watchers or handles left behind
  builtinRequires: ["electron", "fs", "module", "os", "path", "vm", "zlib"],
  requires: ["<root>/src/main/mods", "<root>/src/main/paths", "<root>/src/main/zip"],
  fsReads: READS,
  log: ["[t3mod] cold start hooks installed", "[t3mod] mod core: ok", "[t3mod] preload registered", "[t3mod] patched main-abc123.js (core)"],
  requests: {
    "index.html": { modified: false }, // T3's document is passed through untouched
    otherChunk: { modified: false }, // a chunk no mod targets is passed through untouched
    mainChunk: { modified: true }, // the one chunk core patches (Mods button + runtime import)
    status: { mods: ["core"] }, // only the built-in core mod exists
  },
  gateFixtureRan: false,
  statusKeys: ["core"],
};
const NO_MODS = Object.keys(SCENARIOS)[0];
const BASELINE = {
  [NO_MODS]: BASE,
  // installed but not enabled: the loader lists it (reads its mod.md) and runs none of its code
  "cold, a mod installed but not enabled": { ...BASE, fsReads: [...READS, "<tmp>/mods/trap", "<tmp>/mods/trap/mod.md"].sort() },
  // KNOWN DEVIATION (flagged in the report, not endorsed): with no config.json yet, readEnabled()
  // creates one ({"enabled": []}). One write, first run only. Fixing it means not persisting an
  // empty default; then delete these two keys and the gate gets stricter.
  "cold, first run (no config.json yet)": { ...BASE, fsWrites: ["mkdirSync <tmp>", "writeFileSync <tmp>/config.json"], fsChangedUnderTmp: ["created config.json"] },
  // the legacy inspector launcher (bin/t3code-launch.mjs) passes `launcher`: cold() then reroutes
  // child_process.spawn so an AppImage auto-update restarts through the launcher
  "cold, started by the launcher": {
    ...BASE,
    replacedChildProcessSpawn: true,
    builtinRequires: [...BASE.builtinRequires, "child_process"].sort(),
    fsReads: [...READS, "<tmp>/launcher.mjs"].sort(),
  },
  // live injection is an explicit user action (the injector opens the inspector, outside this process).
  // The loader then serves T3's files itself, so it reads the client directory.
  "live injection, mods/ empty": {
    ...BASE,
    electron: [
      "net.fetch(t3code://app/index.html)", // capture T3's CSP
      "protocol.unhandle(t3code)",
      "protocol.handle(t3code, <fn>)",
      ...COLD_ELECTRON.slice(2),
    ],
    fsReads: [...READS, "<tmp>/client/apps/server/dist/client/assets/vendor-def456.js", "<tmp>/client/apps/server/dist/client/index.html"].sort(),
    log: ["[t3mod] mod core: ok", "[t3mod] live handler installed", "[t3mod] preload registered", "[t3mod] patched main-abc123.js (core)"],
  },
};

// ---- the gate ---------------------------------------------------------------------------------
let passed = 0;
const failures = [];
const slow = [];
const json = (v) => JSON.stringify(v, null, 2);

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  const report = run(scenario, name);
  const expected = BASELINE[name];
  assert.ok(expected, `no baseline for scenario "${name}"`);
  const bad = Object.keys({ ...expected, ...report })
    .filter((k) => k !== "timeMs")
    .filter((k) => JSON.stringify(expected[k]) !== JSON.stringify(report[k]));
  if (bad.length) {
    failures.push(`FAIL zero-cost gate: ${name}\n` + bad.map((k) => `  ${k}\n    allowed: ${json(expected[k])}\n    actual:  ${json(report[k])}`).join("\n"));
  } else {
    passed++;
    console.log(`ok   no-mods path (${name}): baseline matches, ${report.timeMs.toFixed(1)} ms`);
  }
  if (report.timeMs > TIME_BUDGET_MS) slow.push(`${name}: ${report.timeMs.toFixed(0)} ms`);
}

// Detector self-test: a mod that does everything the gate forbids must light every detector up.
// If one of these stops firing, the gate above has gone blind.
{
  const r = run({ run: { kind: "cold" }, fixture: { config: { enabled: ["noisy"] }, mods: NOISY_MOD } }, "noisy");
  const has = (list, text) => assert.ok(list.some((x) => x.includes(text)), `detector blind: ${text} not seen in ${json(list)}`);
  has(r.timers, "setInterval");
  has(r.timers, "setTimeout");
  has(r.timers, "setImmediate");
  has(r.listeners, "process.on(SIGUSR2)");
  has(r.watchers, "fs.watch");
  has(r.fsWrites, "writeFileSync");
  assert.ok(r.fsChangedUnderTmp.length > 0, "detector blind: tmp tree diff");
  has(r.childProcess, "child_process.spawn");
  has(r.network, "net.Socket.connect");
  has(r.inspector, "inspector.open");
  has(r.signals, "SIGUSR1");
  has(r.electron, "ipcMain.handle(t3mod:noisy:x");
  assert.ok(r.activeResourcesAdded > 0, "detector blind: leaked handles");
  assert.deepEqual(r.requests.status.mods, ["core", "noisy"]);
  passed++;
  console.log("ok   detectors fire on a deliberately noisy mod (timers, listeners, watchers, writes, spawn, network, inspector, signal, ipc, handles)");
}

if (slow.length) {
  const msg = `advisory: startup over the ${TIME_BUDGET_MS} ms budget (timing is noisy, not a failure): ${slow.join("; ")}`;
  if (STRICT_TIMING) failures.push(`FAIL ${msg}`);
  else console.warn(`warn ${msg}`);
}
if (failures.length) {
  console.error("\n" + failures.join("\n\n") + "\n\nThe loader did work on the no-mods path. If it is intentional, add it to BASELINE in test/zero-cost.test.mjs and justify it in the commit.");
  process.exit(1);
}
console.log(`\n${passed} tests passed`);
