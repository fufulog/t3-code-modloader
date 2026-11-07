#!/usr/bin/env node
// Live-inject the modloader into a running T3 Code main process.
//
// How: Electron's EnableNodeCliInspectArguments fuse is on in T3 Code builds, so
// SIGUSR1 opens the Node inspector inside the main process (127.0.0.1 only). We
// connect over CDP, require src/main/loader.cjs, call live(), then close the
// inspector again so the port is never left open.
//
// Usage:
//   t3mod-inject.mjs                 inject / hot-reload mods, reload the window
//   t3mod-inject.mjs --no-reload     inject without reloading the renderer
//   t3mod-inject.mjs --eval FILE     evaluate FILE (async function body) in main after inject
//   t3mod-inject.mjs --eval-only FILE  skip inject, only evaluate
//   t3mod-inject.mjs --keep-open     leave the inspector open (dev only)
//   --arg KEY=VALUE                  (repeatable) exposed to --eval code as ARGS.KEY
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOADER = resolve(ROOT, "src/main/loader.cjs");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const PORT = Number(opt("--port") ?? 9229);

function findMainPid() {
  const explicit = opt("--pid");
  if (explicit) return Number(explicit);
  const out = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  const candidates = out
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
    .filter(Boolean)
    .filter(([, , cmd]) => /\/t3code(\s|$)/.test(cmd) && !/--type=|--require|bin\.mjs/.test(cmd))
    .map(([, pid]) => Number(pid))
    .filter((pid) => {
      try {
        return readFileSync(`/proc/${pid}/status`, "utf8").includes("State:\tS") ||
          readFileSync(`/proc/${pid}/status`, "utf8").includes("State:\tR");
      } catch {
        return false;
      }
    });
  if (candidates.length !== 1) throw new Error(`expected exactly one T3 Code main process, found ${candidates.length}: ${candidates.join(",")}`);
  return candidates[0];
}

function catchesSigusr1(pid) {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const m = status.match(/SigCgt:\s*([0-9a-f]+)/i);
  return m ? (BigInt("0x" + m[1]) & (1n << 9n)) !== 0n : false;
}

function portOwner(port) {
  try {
    const out = execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" });
    const m = out.match(/pid=(\d+)/);
    return m ? Number(m[1]) : out.trim() ? -1 : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openInspector(pid) {
  const owner = portOwner(PORT);
  if (owner !== null && owner !== pid) throw new Error(`port ${PORT} is held by pid ${owner}, not T3 (${pid})`);
  if (owner === null) {
    // Refuse to send a signal that would terminate the app if the inspector hook is missing.
    if (!catchesSigusr1(pid)) throw new Error(`pid ${pid} does not catch SIGUSR1; refusing to signal (it would kill T3)`);
    process.kill(pid, "SIGUSR1");
  }
  for (let i = 0; i < 50; i++) {
    if (portOwner(PORT) === pid) break;
    await sleep(100);
  }
  if (portOwner(PORT) !== pid) throw new Error("inspector did not come up");
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  if (!list[0]?.webSocketDebuggerUrl) throw new Error("no inspector target");
  return list[0].webSocketDebuggerUrl;
}

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  return {
    ready,
    send(method, params) {
      const mid = ++id;
      ws.send(JSON.stringify({ id: mid, method, params }));
      return new Promise((res) => pending.set(mid, res));
    },
    close: () => ws.close(),
  };
}

const ARGS = Object.fromEntries(
  args.flatMap((a, i) => (a === "--arg" && args[i + 1] ? [args[i + 1].split(/=(.*)/s).slice(0, 2)] : [])),
);

async function evaluate(client, body) {
  const expression = `(async () => { const require = process.getBuiltinModule("module").createRequire(${JSON.stringify(LOADER)}); const ARGS = ${JSON.stringify(ARGS)}; ${body} })()`;
  const res = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    const d = res.result.exceptionDetails;
    throw new Error(d.exception?.description ?? d.text);
  }
  return res.result?.result?.value;
}

const pid = findMainPid();
const wsUrl = await openInspector(pid);
const client = cdp(wsUrl);
await client.ready;
try {
  if (!flag("--eval-only")) {
    const result = await evaluate(
      client,
      `for (const k of Object.keys(require.cache)) if (k.startsWith(${JSON.stringify(ROOT + "/src/")})) delete require.cache[k];
       return await require(${JSON.stringify(LOADER)}).live({ reload: ${!flag("--no-reload")} });`,
    );
    console.log(JSON.stringify(result, null, 2));
  }
  const evalFile = opt("--eval") ?? opt("--eval-only");
  if (evalFile) {
    const out = await evaluate(client, readFileSync(evalFile, "utf8"));
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
  }
} finally {
  if (!flag("--keep-open")) {
    await client.send("Runtime.evaluate", { expression: `setTimeout(() => process.getBuiltinModule("inspector").close(), 50); 0` });
  }
  client.close();
}
