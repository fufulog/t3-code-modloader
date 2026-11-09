#!/usr/bin/env node
// One-time, per clone: point git at the tracked hooks directory (.githooks), so the pre-push
// hook runs the test suite (including the zero-cost-with-no-mods gate) before every push.
//
//   node bin/setup-hooks.mjs            install
//   node bin/setup-hooks.mjs --remove   unset core.hooksPath again
//
// This sets `core.hooksPath` in the repository's local git config. Worktrees share that config.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(root, ".githooks", "pre-push");
// A hook running git inside a hook would otherwise inherit GIT_DIR and friends.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8" }).trim();

if (!existsSync(hook)) {
  console.error(`missing ${hook}`);
  process.exit(1);
}
try {
  git("rev-parse", "--git-dir");
} catch {
  console.error(`${root} is not a git repository`);
  process.exit(1);
}
if (process.argv.includes("--remove")) {
  try {
    git("config", "--local", "--unset", "core.hooksPath");
  } catch {} // not set: nothing to undo
  console.log("core.hooksPath unset; git hooks are back to .git/hooks");
} else {
  git("config", "--local", "core.hooksPath", ".githooks");
  console.log("core.hooksPath = .githooks (pre-push now runs `npm test`). Undo with: node bin/setup-hooks.mjs --remove");
}
