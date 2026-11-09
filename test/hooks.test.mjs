// The pre-push hook is tracked and wired to the suite, and bin/setup-hooks.mjs installs it by
// setting core.hooksPath. The installer runs only inside a throwaway git repo here: the real
// repository's git config is never touched.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { env, encoding: "utf8" }).trim();
let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok   ${name}`);
};

test("pre-push hook is executable and runs the suite", () => {
  const f = join(ROOT, ".githooks/pre-push");
  assert.ok(statSync(f).mode & 0o111, "not executable");
  const text = readFileSync(f, "utf8");
  assert.match(text, /^#!\/bin\/sh/);
  assert.match(text, /npm test/);
  assert.equal(git(ROOT, "ls-files", "--stage", ".githooks/pre-push").slice(0, 6), "100755", "git must track it as executable");
});

test("npm test includes the zero-cost gate", () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
  assert.match(scripts.test, /test\/zero-cost\.test\.mjs/);
  assert.match(scripts.test, /test\/hooks\.test\.mjs/);
});

test("CI runs the same suite on push and pull_request, Node 22", () => {
  const y = readFileSync(join(ROOT, ".github/workflows/test.yml"), "utf8");
  assert.match(y, /^on:\s*\n\s+push:\s*\n\s+pull_request:/m);
  assert.match(y, /node-version: 22/);
  assert.match(y, /run: npm test/);
});

test("setup-hooks sets core.hooksPath in the repo it lives in, and --remove undoes it", () => {
  const tmp = mkdtempSync(join(tmpdir(), "t3mod-hooks-"));
  try {
    mkdirSync(join(tmp, "bin"));
    mkdirSync(join(tmp, ".githooks"));
    copyFileSync(join(ROOT, "bin/setup-hooks.mjs"), join(tmp, "bin/setup-hooks.mjs"));
    copyFileSync(join(ROOT, ".githooks/pre-push"), join(tmp, ".githooks/pre-push"));
    git(tmp, "init", "-q");
    const before = (() => { try { return git(ROOT, "config", "--local", "--get", "core.hooksPath"); } catch { return ""; } })();
    execFileSync(process.execPath, [join(tmp, "bin/setup-hooks.mjs")], { env, stdio: "pipe" });
    assert.equal(git(tmp, "config", "--local", "--get", "core.hooksPath"), ".githooks");
    execFileSync(process.execPath, [join(tmp, "bin/setup-hooks.mjs"), "--remove"], { env, stdio: "pipe" });
    assert.throws(() => git(tmp, "config", "--local", "--get", "core.hooksPath"));
    const after = (() => { try { return git(ROOT, "config", "--local", "--get", "core.hooksPath"); } catch { return ""; } })();
    assert.equal(after, before, "the real repo's git config must not change");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`\n${n} tests passed`);
