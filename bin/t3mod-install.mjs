#!/usr/bin/env node
// Install the modloader into T3 Code, or take it out again. Every change is recorded
// and reversible.
//
//   t3mod-install.mjs [install] [--dir PATH] [--yes] [--force]
//   t3mod-install.mjs uninstall [--yes] [--keep-config]
//   t3mod-install.mjs status
//   t3mod-install.mjs find
//
// install finds T3 Code on PATH and in the usual places for this OS. If it finds
// none it asks for the folder (or .AppImage). `--dir` skips the search.
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";

const require = createRequire(import.meta.url);
const { findTargets, resolveTarget, describe } = require("../src/install/targets.cjs");
const installer = require("../src/install/install.cjs");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const dirAt = argv.indexOf("--dir");
const cmd = argv.find((a, i) => !a.startsWith("-") && i !== (dirAt < 0 ? -1 : dirAt + 1)) ?? "install";
const yes = flag("--yes") || flag("-y");
const say = (s) => console.log(s);

let rl;
const ask = async (q) => {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  // end of input (no terminal, ctrl-D) counts as an empty answer instead of hanging
  const eof = new Promise((res) => rl.once("close", () => res("")));
  return (await Promise.race([rl.question(q), eof])).trim();
};
const confirm = async (q) => yes || /^y(es)?$/i.test(await ask(`${q} [y/N] `));
const done = (code = 0) => {
  rl?.close();
  process.exit(code);
};

async function chooseTarget() {
  const dir = opt("--dir");
  if (dir) {
    const t = resolveTarget(dir);
    if (!t) throw new Error(`${dir} does not look like a T3 Code install (no resources/app.asar, and not an .AppImage)`);
    return t;
  }
  const found = findTargets();
  if (found.length === 1 || (found.length > 1 && yes)) {
    say(`Found T3 Code: ${describe(found[0])}`);
    return found[0];
  }
  if (found.length > 1) {
    say("Found several T3 Code installs:");
    found.forEach((t, i) => say(`  ${i + 1}. ${describe(t)}`));
    for (;;) {
      const n = Number(await ask(`Which one? [1-${found.length}] `));
      if (n >= 1 && n <= found.length) return found[n - 1];
    }
  }
  if (!process.stdin.isTTY && !rl) throw new Error("T3 Code was not found; pass --dir PATH");
  say("T3 Code was not found in PATH or the usual install locations.");
  for (;;) {
    const p = await ask("Where is it? (install folder or .AppImage, empty to cancel) ");
    if (!p) throw new Error("cancelled");
    const t = resolveTarget(p.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
    if (t) return t;
    say(`  ${p} is not a T3 Code install. Look for a folder containing resources/app.asar, or an .AppImage file.`);
  }
}

try {
  if (cmd === "find") {
    const found = findTargets();
    found.forEach((t) => say(describe(t)));
    if (!found.length) say("no T3 Code install found");
  } else if (cmd === "status") {
    const s = installer.status();
    if (!s.installed) say("Not installed.");
    else {
      say(`Installed ${s.installedAt} into ${describe(s.target)}`);
      say(`Modloader: ${s.repo}`);
      for (const c of s.changes) say(`  ${c.present ? "ok     " : "MISSING"} ${c.type}  ${c.asar ?? c.file ?? c.root}`);
    }
  } else if (cmd === "prepare") {
    // used by the launcher when T3 updated to a new AppImage
    const app = argv[argv.indexOf("prepare") + 1];
    const tree = installer.prepareTree(app, (m) => console.error(`t3mod: ${m}`));
    installer.pruneTrees([tree]);
  } else if (cmd === "uninstall") {
    const s = installer.status();
    if (!s.installed) say("Nothing is installed.");
    else if (await confirm(`Restore T3 Code (${describe(s.target)}) and remove the modloader's changes?`)) {
      const steps = installer.uninstall({ log: () => {}, keepConfig: flag("--keep-config") });
      steps.forEach((x) => say(`${x.ok ? "✓" : "✗"} ${x.label}${x.detail ? ` (${x.detail})` : ""}`));
      say("Done. Your mod files in mods/ were not touched. Restart T3 to run it unmodified.");
      if (steps.some((x) => !x.ok)) done(1);
    }
  } else if (cmd === "install") {
    const target = await chooseTarget();
    say(`\nThis will modify: ${describe(target)}`);
    say(
      target.kind === "appimage"
        ? "  - extract a copy of the AppImage (~600 MB) and patch the copy; the AppImage itself is not touched\n  - add a launcher and point T3's desktop entry at it"
        : "  - patch resources/app.asar (the original is kept as app.asar.t3mod-backup)",
    );
    say("Undo any time with: node bin/t3mod-install.mjs uninstall   (or the Remove modloader button in the Mods window)\n");
    if (!(await confirm("Install?"))) {
      say("Cancelled; nothing was changed.");
      done(0);
    }
    installer.install(target, { force: flag("--force"), log: (m) => say(`  ${m}`) });
    say(target.kind === "appimage" ? "\nInstalled. Start T3 Code from its desktop entry; the first start of each new T3 version extracts a fresh copy." : "\nInstalled. Restart T3 Code. After a T3 update, run this again.");
  } else {
    throw new Error(`unknown command "${cmd}" (install, uninstall, status, find)`);
  }
  done(0);
} catch (e) {
  console.error(`error: ${e.message}`);
  done(1);
}
