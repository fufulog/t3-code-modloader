// Exercises every Commit Graph git op against a throwaway repo + bare remote.
//   node test/git.test.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Inherited GIT_DIR / GIT_WORK_TREE (set by git for hooks, or by an agent) would point every
// git call below, including `git init` and `git config`, at the real repository. Drop them.
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const require = createRequire(import.meta.url);
const { dispatch } = require("../mods/commit-graph/git.cjs")._test;

const base = mkdtempSync(join(tmpdir(), "t3cg-git-"));
const remote = join(base, "remote.git");
const cwd = join(base, "work");
const sh = (args, dir = cwd) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const commit = (file, msg) => {
  writeFileSync(join(cwd, file), `${msg}\n${Math.random()}\n`);
  sh(["add", file]);
  sh(["commit", "-qm", msg]);
  return sh(["rev-parse", "HEAD"]);
};

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
const eq = (a, b, msg) => {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const rejects = async (p, re) => {
  try {
    await p;
  } catch (e) {
    if (re && !re.test(e.message)) throw new Error(`wrong error: ${e.message}`);
    return;
  }
  throw new Error("expected rejection");
};
const op = (o, p = {}) => dispatch({ op: o, cwd, ...p });

try {
  sh(["init", "-q", "--bare", "-b", "main", remote], base);
  sh(["init", "-q", "-b", "main", cwd], base);
  sh(["config", "user.name", "t"]);
  sh(["config", "user.email", "t@t"]);
  sh(["remote", "add", "origin", remote]);
  const c1 = commit("a.txt", "first");
  const c2 = commit("b.txt", "second");
  sh(["switch", "-qc", "feature"]);
  const f1 = commit("c.txt", "feature work");
  sh(["switch", "-q", "main"]);
  commit("d.txt", "main work");
  sh(["push", "-q", "-u", "origin", "main"]);

  await step("log + refs", async () => {
    const l = await op("log", { maxCommits: 50 });
    eq(l.commits.length, 4, "commit count");
    eq(l.info.branch, "main", "branch");
    eq(l.refs.remotes.some((r) => r.name === "origin/main"), true, "remote ref");
  });
  await step("createBranch + checkoutBranch", async () => {
    await op("createBranch", { name: "topic", hash: c2, checkout: false });
    await op("checkoutBranch", { name: "topic" });
    eq(sh(["symbolic-ref", "--short", "HEAD"]), "topic", "HEAD");
    await op("checkoutBranch", { name: "main" });
  });
  await step("renameBranch + deleteBranch", async () => {
    await op("renameBranch", { from: "topic", to: "topic2" });
    await op("deleteBranch", { name: "topic2", force: false });
    eq(sh(["branch", "--list", "topic2"]), "", "deleted");
  });
  await step("merge --no-ff", async () => {
    await op("merge", { ref: "refs/heads/feature", noFastForward: true });
    eq(sh(["rev-list", "--parents", "-n1", "HEAD"]).split(" ").length, 3, "merge commit parents");
  });
  await step("details of merge vs parent 2", async () => {
    const head = sh(["rev-parse", "HEAD"]);
    const d1 = await op("details", { hash: head });
    const d2 = await op("details", { hash: head, parent: 2 });
    eq(d1.files.map((f) => f.path).join(), "c.txt", "vs parent 1");
    eq(d2.files.map((f) => f.path).join(), "d.txt", "vs parent 2");
  });
  await step("revert merge (-m 1)", async () => {
    await op("revert", { hash: sh(["rev-parse", "HEAD"]), parent: 1 });
    eq(sh(["log", "-1", "--format=%s"]).startsWith("Revert"), true, "revert commit");
  });
  await step("cherryPick", async () => {
    sh(["reset", "-q", "--hard", "HEAD~2"]);
    await op("cherryPick", { hash: f1, recordOrigin: true });
    eq(sh(["log", "-1", "--format=%B"]).includes("cherry picked from commit"), true, "-x trailer");
  });
  await step("dropCommit", async () => {
    const before = Number(sh(["rev-list", "--count", "HEAD"]));
    await op("dropCommit", { hash: sh(["rev-parse", "HEAD"]) });
    eq(Number(sh(["rev-list", "--count", "HEAD"])), before - 1, "count");
  });
  await step("reset soft/mixed/hard", async () => {
    const head = sh(["rev-parse", "HEAD"]);
    await op("reset", { hash: c2, mode: "soft" });
    eq(sh(["rev-parse", "HEAD"]), c2, "soft moved HEAD");
    await op("reset", { hash: head, mode: "hard" });
    eq(sh(["rev-parse", "HEAD"]), head, "hard restored");
  });
  await step("tags: lightweight, annotated + push + delete on remote", async () => {
    await op("createTag", { name: "v1", hash: c1 });
    await op("createTag", { name: "v2", hash: c2, message: "release 2", pushTo: "origin" });
    eq(sh(["ls-remote", "--tags", "origin"]).includes("refs/tags/v2"), true, "pushed");
    await op("deleteTag", { name: "v2", deleteOnRemote: "origin" });
    eq(sh(["ls-remote", "--tags", "origin"]).includes("refs/tags/v2"), false, "remote deleted");
    await op("pushTag", { name: "v1", remote: "origin" });
  });
  await step("push branch + remote checkout + delete remote branch", async () => {
    await op("pushBranch", { name: "feature", remote: "origin", setUpstream: true, force: "none" });
    await op("deleteBranch", { name: "feature", force: true });
    await op("checkoutRemoteBranch", { remoteBranch: "origin/feature", localName: "feature" });
    eq(sh(["rev-parse", "--abbrev-ref", "feature@{upstream}"]), "origin/feature", "tracking");
    await op("checkoutBranch", { name: "main" });
    await op("deleteRemoteBranch", { remote: "origin", branch: "feature" });
    eq(sh(["ls-remote", "--heads", "origin"]).includes("feature"), false, "remote branch gone");
  });
  await step("fetch + pull", async () => {
    await op("fetch", { prune: true });
    await op("pull", { ffOnly: true });
  });
  await step("uncommitted + stash push/apply/pop/drop/branch", async () => {
    writeFileSync(join(cwd, "a.txt"), "changed\n");
    writeFileSync(join(cwd, "new.txt"), "untracked\n");
    const u = await op("uncommittedDetails");
    eq(u.files.length, 2, "uncommitted files");
    const diff = await op("fileDiff", { hash: "*", path: "new.txt", untracked: true });
    eq(diff.diff.includes("+untracked"), true, "untracked diff");
    // Full-file mode of the diff view: the whole file with the changes marked inline
    const full = await op("fileDiff", { hash: "*", path: "a.txt", full: true });
    eq(full.diff.includes("+changed"), true, "full diff has the change");
    eq((full.diff.match(/^@@/gm) ?? []).length, 1, "full diff is a single hunk");
    const ctxLines = sh(["show", "HEAD:a.txt"]).split("\n").length;
    eq(full.diff.split("\n").filter((l) => l.startsWith(" ") || l.startsWith("-") || l.startsWith("+")).length >= ctxLines - 1, true, "full diff covers every line");
    await rejects(op("fileDiff", { hash: "*", path: "../x", full: true }), /invalid path/);
    // Both sides of a file for T3's own diff renderer
    const sides = await op("fileSides", { hash: "*", path: "a.txt" });
    eq(sides.before, sh(["show", "HEAD:a.txt"]) + "\n", "sides: committed text before");
    eq(sides.after, "changed\n", "sides: working tree after");
    const added = await op("fileSides", { hash: "*", path: "new.txt" });
    eq(added.before, null, "sides: untracked file has no before");
    eq(added.after, "untracked\n", "sides: untracked after");
    writeFileSync(join(cwd, "bin.dat"), Buffer.from([1, 0, 2]));
    eq((await op("fileSides", { hash: "*", path: "bin.dat" })).unavailable, true, "sides: binary is unavailable");
    rmSync(join(cwd, "bin.dat"));
    await rejects(op("fileSides", { hash: "*", path: "../x" }), /invalid path/);
    await op("stashPush", { message: "wip", includeUntracked: true });
    eq((await op("info")).uncommitted, 0, "clean after stash");
    await op("stashApply", { selector: "stash@{0}" });
    await op("resetUncommitted", { mode: "hard" });
    await op("cleanUntracked", { directories: true });
    await op("stashPop", { selector: "stash@{0}" });
    await op("stashPush", { includeUntracked: true });
    await op("stashBranch", { selector: "stash@{0}", name: "from-stash" });
    eq(sh(["symbolic-ref", "--short", "HEAD"]), "from-stash", "stash branch");
    await op("resetUncommitted", { mode: "hard" });
    await op("cleanUntracked", { directories: true });
    await op("checkoutBranch", { name: "main" });
    writeFileSync(join(cwd, "a.txt"), "again\n");
    await op("stashPush", {});
    await op("stashDrop", { selector: "stash@{0}" });
  });
  await step("rebase + abort state", async () => {
    sh(["switch", "-qc", "side", c1]);
    writeFileSync(join(cwd, "b.txt"), "conflict\n");
    sh(["add", "b.txt"]);
    sh(["commit", "-qm", "side conflicting"]);
    await rejects(op("rebase", { ref: "refs/heads/main" }));
    eq((await op("info")).state, "rebasing", "state");
    await op("abortOperation", { state: "rebasing" });
    eq((await op("info")).state, null, "aborted");
    await op("checkoutBranch", { name: "main" });
  });
  await step("checkoutCommit (detached) + log with detached HEAD", async () => {
    await op("checkoutCommit", { hash: c2 });
    eq((await op("info")).branch, null, "detached");
    const l = await op("log", { branches: ["refs/heads/main"] });
    eq(l.commits.length > 0, true, "branch filter");
    await op("checkoutBranch", { name: "main" });
  });
  await step("findRepos: two levels deep, alphabetical, skips submodules and node_modules", async () => {
    const ws = join(base, "ws");
    const mk = (rel) => {
      mkdirSync(join(ws, rel), { recursive: true });
      sh(["init", "-q", "-b", "main", join(ws, rel)], base);
    };
    mk("zeta");
    mk("Alpha");
    mk("group/inner");
    mk("group/deep/too-deep"); // three folders down: not searched
    mk("node_modules/pkg");
    mkdirSync(join(ws, "plain"), { recursive: true });
    mkdirSync(join(ws, "sub"), { recursive: true });
    writeFileSync(join(ws, "sub", ".git"), "gitdir: ../.git/modules/sub\n"); // a submodule's link file
    const r = await dispatch({ op: "findRepos", cwd: ws });
    eq(r.map((x) => x.name).join(","), "Alpha,inner,zeta", "names, sorted case-insensitively");
    eq(r[0].cwd, join(ws, "Alpha"), "cwd of a nested repo is its own folder");
    // A workspace that is itself a repo is listed with its own cwd.
    const own = await dispatch({ op: "findRepos", cwd });
    eq(own.length, 1, "a lone repo is a single entry");
    eq(own[0].cwd, cwd, "the workspace itself");
    await rejects(dispatch({ op: "findRepos", cwd: "relative" }), /absolute/);
    await rejects(dispatch({ op: "findRepos", cwd: join(base, "missing") }), /not found/);
    await rejects(dispatch({ op: "findRepos" }), /invalid cwd/);
  });
  await step("rejects hostile input", async () => {
    await rejects(op("checkoutBranch", { name: "--orphan=x" }), /invalid/);
    await rejects(op("merge", { ref: "--upload-pack=touch /tmp/pwn" }), /invalid/);
    await rejects(op("merge", { ref: "main" }), /invalid ref/);
    await rejects(op("pushBranch", { name: "main", remote: "--exec=x" }), /invalid remote/);
    await rejects(op("pushBranch", { name: "main", remote: "nope" }), /unknown remote/);
    await rejects(op("reset", { hash: c1, mode: "keep" }), /invalid reset mode/);
    await rejects(op("fileDiff", { hash: c1, path: "../x" }), /invalid path/);
    await rejects(op("stashDrop", { selector: "stash@{0}; rm -rf /" }), /invalid stash/);
    await rejects(op("createTag", { name: "bad..name", hash: c1 }), /not a valid tag/);
    await rejects(dispatch({ op: "log", cwd: "relative/path" }), /absolute/);
    await rejects(op("nope"), /unknown op/);
    await rejects(op("__proto__"), /unknown op/);
  });
} finally {
  rmSync(base, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failure(s)` : "\nall git ops ok");
process.exit(failures ? 1 : 0);
