"use strict";
// Git backend for the Commit Graph surface (main process).
//
// The renderer sends { op, cwd, ...params } over `t3mod:commit-graph:git`. Only
// the ops below exist, every argument is validated, and git is always invoked
// with an argv array (no shell), so a compromised renderer cannot smuggle flags
// such as `-c core.sshCommand=...` or `--upload-pack=...`.

const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CHANNEL = "t3mod:commit-graph:git";
const US = "\x1f";
const RS = "\x1e";

class UserError extends Error {}

function gitEnv(extra) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", ...extra };
  delete env.NODE_OPTIONS;
  if (!env.GIT_SSH_COMMAND && !env.GIT_SSH) env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  return env;
}

function git(cwd, args, { timeout = 60_000, allowFail = false, maxBuffer = 256 * 1024 * 1024, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "color.ui=false", "-c", "core.quotepath=false", "-c", "log.showSignature=false", ...args],
      { cwd, timeout, maxBuffer, env: gitEnv(env), windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !allowFail) {
          const msg = (stderr || stdout || err.message || "").trim();
          reject(new UserError(msg || `git ${args[0]} failed`));
        } else resolve({ stdout, stderr, code: err ? (typeof err.code === "number" ? err.code : 1) : 0 });
      },
    );
  });
}

// ---- validation -------------------------------------------------------------

const HASH = /^[0-9a-f]{7,64}$/i;
const STASH = /^stash@\{\d{1,5}\}$/;

function str(v, name, max = 1000) {
  if (typeof v !== "string" || v.length === 0 || v.length > max || v.includes("\0")) throw new UserError(`invalid ${name}`);
  return v;
}
function hash(v) {
  if (typeof v !== "string" || !HASH.test(v)) throw new UserError("invalid commit hash");
  return v;
}
function noDash(v, name) {
  str(v, name, 400);
  if (v.startsWith("-")) throw new UserError(`invalid ${name}`);
  return v;
}
async function branchName(cwd, v) {
  noDash(v, "branch name");
  const r = await git(cwd, ["check-ref-format", "--branch", v], { allowFail: true });
  if (r.code !== 0) throw new UserError(`'${v}' is not a valid branch name`);
  return v;
}
async function tagName(cwd, v) {
  noDash(v, "tag name");
  const r = await git(cwd, ["check-ref-format", `refs/tags/${v}`], { allowFail: true });
  if (r.code !== 0) throw new UserError(`'${v}' is not a valid tag name`);
  return v;
}
async function remote(cwd, v) {
  noDash(v, "remote");
  const { stdout } = await git(cwd, ["remote"]);
  if (!stdout.split("\n").includes(v)) throw new UserError(`unknown remote '${v}'`);
  return v;
}
/** A full ref under heads/remotes/tags, or a hash; must resolve to a commit. */
async function commitish(cwd, v) {
  str(v, "ref", 400);
  if (!HASH.test(v) && !/^refs\/(heads|remotes|tags)\/[^\0]+$/.test(v)) throw new UserError("invalid ref");
  const r = await git(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${v}^{commit}`], { allowFail: true });
  if (r.code !== 0) throw new UserError(`'${v}' does not resolve to a commit`);
  return v;
}
function stash(v) {
  if (typeof v !== "string" || !STASH.test(v)) throw new UserError("invalid stash");
  return v;
}
function mainline(v) {
  if (v === undefined || v === null) return [];
  if (!Number.isInteger(v) || v < 1 || v > 16) throw new UserError("invalid parent number");
  return ["-m", String(v)];
}
function relPath(v) {
  str(v, "path", 4096);
  if (path.isAbsolute(v) || v.split(/[\\/]/).includes("..")) throw new UserError("invalid path");
  return v;
}

const toplevelCache = new Map();
async function repoRoot(cwd) {
  str(cwd, "cwd", 4096);
  if (!path.isAbsolute(cwd)) throw new UserError("workspace path must be absolute");
  if (toplevelCache.has(cwd)) return toplevelCache.get(cwd);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new UserError(`folder not found on this machine: ${cwd}`);
  const r = await git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (r.code !== 0) throw new UserError("not a git repository");
  const root = r.stdout.trim();
  toplevelCache.set(cwd, root);
  return root;
}

// ---- read ops ---------------------------------------------------------------

async function gitDir(root) {
  return path.resolve(root, (await git(root, ["rev-parse", "--git-dir"])).stdout.trim());
}

async function info(root, cwd) {
  const [head, sym, remotes, status, dir] = await Promise.all([
    git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true }),
    git(root, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true }),
    git(root, ["remote"]),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    gitDir(root),
  ]);
  const state = fs.existsSync(path.join(dir, "rebase-merge")) || fs.existsSync(path.join(dir, "rebase-apply"))
    ? "rebasing"
    : fs.existsSync(path.join(dir, "MERGE_HEAD"))
      ? "merging"
      : fs.existsSync(path.join(dir, "CHERRY_PICK_HEAD"))
        ? "cherry-picking"
        : fs.existsSync(path.join(dir, "REVERT_HEAD"))
          ? "reverting"
          : null;
  return {
    root,
    cwd,
    name: path.basename(root),
    headHash: head.stdout.trim() || null,
    branch: sym.code === 0 ? sym.stdout.trim() : null,
    remotes: remotes.stdout.split("\n").filter(Boolean),
    uncommitted: parseStatus(status.stdout).length,
    state,
  };
}

function parseStatus(out) {
  const parts = out.split("\0");
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const x = p[0];
    const y = p[1];
    const file = p.slice(3);
    let oldPath;
    if (x === "R" || x === "C") oldPath = parts[++i];
    files.push({ x, y, path: file, oldPath });
  }
  return files;
}

async function refs(root) {
  const { stdout } = await git(root, [
    "for-each-ref",
    "--format=%(objectname)%1f%(*objectname)%1f%(refname)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(objecttype)",
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]);
  const out = { heads: [], remotes: [], tags: [] };
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const [obj, peeled, ref, headMark, upstream, track, type] = line.split(US);
    const target = peeled || obj;
    if (ref.startsWith("refs/heads/")) out.heads.push({ name: ref.slice(11), ref, hash: target, current: headMark === "*", upstream: upstream || null, track: track || null });
    else if (ref.startsWith("refs/remotes/")) {
      const short = ref.slice(13);
      if (short.endsWith("/HEAD")) continue;
      const slash = short.indexOf("/");
      out.remotes.push({ name: short, ref, hash: target, remote: short.slice(0, slash), branch: short.slice(slash + 1) });
    } else out.tags.push({ name: ref.slice(10), ref, hash: target, annotated: type === "tag" });
  }
  return out;
}

async function log(root, p) {
  const max = Number.isInteger(p.maxCommits) && p.maxCommits > 0 && p.maxCommits <= 100_000 ? p.maxCommits : 300;
  const [r, inf, stashOut] = await Promise.all([
    refs(root),
    info(root, p.cwd),
    p.showStashes === false
      ? Promise.resolve({ stdout: "" })
      : git(root, ["stash", "list", `--format=%H${US}%P${US}%gd${US}%at${US}%an${US}%ae${US}%s`], { allowFail: true }),
  ]);
  let revs;
  if (Array.isArray(p.branches) && p.branches.length) {
    revs = [];
    for (const b of p.branches.slice(0, 200)) revs.push(await commitish(root, b));
  } else {
    revs = ["--branches", "--tags"];
    if (p.showRemoteBranches !== false) revs.push("--remotes");
    if (inf.headHash) revs.push("HEAD");
  }
  if (!inf.headHash && !r.heads.length && !r.remotes.length) {
    return { info: inf, refs: r, commits: [], stashes: [], hasMore: false };
  }
  const order = p.order === "topo" ? "--topo-order" : p.order === "author-date" ? "--author-date-order" : "--date-order";
  const { stdout } = await git(root, ["log", order, `--max-count=${max + 1}`, `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%s${RS}`, ...revs, "--"]);
  const commits = [];
  for (const rec of stdout.split(RS)) {
    const line = rec.replace(/^\n/, "");
    if (!line) continue;
    const [h, parents, an, ae, at, subject] = line.split(US);
    commits.push({ hash: h, parents: parents ? parents.split(" ") : [], author: an, email: ae, date: Number(at), subject });
  }
  const hasMore = commits.length > max;
  if (hasMore) commits.length = max;
  const stashes = stashOut.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [h, parents, selector, at, an, ae, subject] = l.split(US);
      return { hash: h, base: parents.split(" ")[0], selector, date: Number(at), author: an, email: ae, subject };
    });
  return { info: inf, refs: r, commits, stashes, hasMore };
}

function parseNameStatus(out) {
  const parts = out.split("\0");
  const files = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (!status) continue;
    const kind = status[0];
    if (kind === "R" || kind === "C") files.push({ status: kind, oldPath: parts[i++], path: parts[i++] });
    else files.push({ status: kind, path: parts[i++] });
  }
  return files;
}

function parseNumstat(out) {
  // -z format: "add\tdel\tpath\0" or, for renames, "add\tdel\t\0old\0new\0"
  const map = new Map();
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const m = p.match(/^(-|\d+)\t(-|\d+)\t(.*)$/s);
    if (!m) continue;
    let file = m[3];
    if (file === "") {
      i++; // old path
      file = parts[++i];
    }
    map.set(file, { additions: m[1] === "-" ? null : Number(m[1]), deletions: m[2] === "-" ? null : Number(m[2]) });
  }
  return map;
}

async function details(root, p) {
  const h = hash(p.hash);
  const { stdout } = await git(root, ["show", "-s", `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%cn${US}%ce${US}%ct${US}%B`, h, "--"]);
  const [full, parents, an, ae, at, cn, ce, ct, ...body] = stdout.split(US);
  const parentList = parents ? parents.split(" ") : [];
  const base = Number.isInteger(p.parent) && p.parent >= 1 && p.parent <= parentList.length ? parentList[p.parent - 1] : parentList[0];
  const range = base ? [base, full] : ["--root", full];
  const diffArgs = base ? ["diff", "-M", "-z"] : ["diff-tree", "-r", "-M", "-z", "--no-commit-id"];
  const [ns, num] = await Promise.all([
    git(root, [...diffArgs, "--name-status", ...range, "--"]),
    git(root, [...diffArgs, "--numstat", ...range, "--"]),
  ]);
  const stats = parseNumstat(num.stdout);
  const files = parseNameStatus(ns.stdout).map((f) => ({ ...f, ...(stats.get(f.path) ?? {}) }));
  return {
    hash: full,
    parents: parentList,
    author: an,
    email: ae,
    date: Number(at),
    committer: cn,
    committerEmail: ce,
    committerDate: Number(ct),
    body: body.join(US).replace(/\n+$/, ""),
    comparedTo: base ?? null,
    files,
  };
}

async function uncommittedDetails(root) {
  const [st, num, head] = await Promise.all([
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(root, ["diff", "HEAD", "-M", "-z", "--numstat", "--"], { allowFail: true }),
    git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true }),
  ]);
  const stats = parseNumstat(num.stdout);
  const files = parseStatus(st.stdout).map((f) => {
    const code = f.x === "?" ? "U" : f.x === "R" || f.y === "R" ? "R" : f.x === "D" || f.y === "D" ? "D" : f.x === "A" ? "A" : f.x === "U" || f.y === "U" ? "C" : "M";
    return { status: code === "U" ? "U" : code, path: f.path, oldPath: f.oldPath, staged: f.x !== " " && f.x !== "?", ...(stats.get(f.path) ?? {}) };
  });
  return { hash: "*", parents: head.stdout.trim() ? [head.stdout.trim()] : [], files };
}

const DIFF_LIMIT = 4 * 1024 * 1024;
async function fileDiff(root, p) {
  const file = relPath(p.path);
  const old = p.oldPath ? relPath(p.oldPath) : null;
  const paths = old && old !== file ? [old, file] : [file];
  let out;
  if (p.hash === "*") {
    if (p.untracked) {
      const abs = path.join(root, file);
      const r = await git(root, ["diff", "--no-index", "--", "/dev/null", abs], { allowFail: true });
      out = r.stdout.replace(abs, file);
    } else out = (await git(root, ["diff", "-M", "HEAD", "--", ...paths], { maxBuffer: DIFF_LIMIT * 4 })).stdout;
  } else {
    const h = hash(p.hash);
    const base = p.base ? hash(p.base) : null;
    out = base
      ? (await git(root, ["diff", "-M", base, h, "--", ...paths], { maxBuffer: DIFF_LIMIT * 4 })).stdout
      : (await git(root, ["show", "-M", "--format=", h, "--", ...paths], { maxBuffer: DIFF_LIMIT * 4 })).stdout;
  }
  return { diff: out.length > DIFF_LIMIT ? out.slice(0, DIFF_LIMIT) : out, truncated: out.length > DIFF_LIMIT };
}

/** The whole file at a commit (or the working-tree file for hash "*"), for the diff view's Full mode. */
async function fileContent(root, p) {
  const file = relPath(p.path);
  let text;
  if (p.hash === "*") {
    let real;
    let rootReal;
    try {
      [real, rootReal] = await Promise.all([fs.promises.realpath(path.join(root, file)), fs.promises.realpath(root)]);
    } catch {
      return { missing: true };
    }
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new UserError("invalid path");
    const st = await fs.promises.stat(real);
    if (!st.isFile()) return { missing: true };
    const fh = await fs.promises.open(real, "r");
    try {
      const buf = Buffer.alloc(Math.min(st.size, DIFF_LIMIT));
      await fh.read(buf, 0, buf.length, 0);
      text = buf.toString("utf8");
    } finally {
      await fh.close();
    }
    if (st.size > DIFF_LIMIT) return { content: text.includes("\0") ? null : text, binary: text.includes("\0"), truncated: true };
  } else {
    const r = await git(root, ["show", `${hash(p.hash)}:${file}`], { allowFail: true, maxBuffer: DIFF_LIMIT * 4 });
    if (r.code !== 0) return { missing: true };
    text = r.stdout;
  }
  if (text.includes("\0")) return { binary: true };
  return text.length > DIFF_LIMIT ? { content: text.slice(0, DIFF_LIMIT), truncated: true } : { content: text };
}

async function fingerprint(root) {
  const dir = await gitDir(root);
  const [r, head, st, stashes] = await Promise.all([
    git(root, ["for-each-ref", "--format=%(objectname) %(refname)"]),
    git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true }),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(root, ["stash", "list", "--format=%H"], { allowFail: true }),
  ]);
  let symbolic = "";
  try {
    symbolic = fs.readFileSync(path.join(dir, "HEAD"), "utf8");
  } catch {}
  return crypto.createHash("sha1").update([r.stdout, head.stdout, st.stdout, stashes.stdout, symbolic].join("\0")).digest("hex");
}

// ---- write ops ----------------------------------------------------------------

const LONG = { timeout: 10 * 60_000 };

const actions = {
  async checkoutBranch(root, p) {
    await git(root, ["switch", "--end-of-options", await branchName(root, p.name)]);
  },
  async checkoutRemoteBranch(root, p) {
    const name = await branchName(root, p.localName);
    const ref = await commitish(root, `refs/remotes/${noDash(p.remoteBranch, "remote branch")}`);
    await git(root, ["switch", "-c", name, "--track", ref.slice(13)]);
  },
  async checkoutCommit(root, p) {
    await git(root, ["switch", "--detach", hash(p.hash)]);
  },
  async createBranch(root, p) {
    const name = await branchName(root, p.name);
    const at = hash(p.hash);
    if (p.checkout) await git(root, ["switch", ...(p.force ? ["-C"] : ["-c"]), name, at]);
    else await git(root, ["branch", ...(p.force ? ["-f"] : []), name, at]);
  },
  async deleteBranch(root, p) {
    await git(root, ["branch", p.force ? "-D" : "-d", "--end-of-options", await branchName(root, p.name)]);
    if (p.deleteOnRemotes && Array.isArray(p.deleteOnRemotes)) {
      for (const r of p.deleteOnRemotes) await git(root, ["push", await remote(root, r), "--delete", p.name], LONG);
    }
  },
  async renameBranch(root, p) {
    await git(root, ["branch", "-m", "--end-of-options", await branchName(root, p.from), await branchName(root, p.to)]);
  },
  async deleteRemoteBranch(root, p) {
    await git(root, ["push", await remote(root, p.remote), "--delete", await branchName(root, p.branch)], LONG);
  },
  async pushBranch(root, p) {
    const args = ["push"];
    if (p.setUpstream) args.push("--set-upstream");
    if (p.force === "lease") args.push("--force-with-lease");
    else if (p.force === "force") args.push("--force");
    args.push(await remote(root, p.remote), await branchName(root, p.name));
    await git(root, args, LONG);
  },
  async pullIntoCurrent(root, p) {
    const args = ["pull"];
    if (p.noFastForward) args.push("--no-ff");
    if (p.squash) args.push("--squash");
    args.push(await remote(root, p.remote), await branchName(root, p.branch));
    await git(root, args, LONG);
  },
  async pull(root, p) {
    await git(root, ["pull", ...(p.ffOnly ? ["--ff-only"] : []), ...(p.rebase ? ["--rebase"] : [])], LONG);
  },
  async fetch(root, p) {
    await git(root, ["fetch", "--all", ...(p.prune ? ["--prune"] : []), ...(p.pruneTags ? ["--prune-tags"] : [])], LONG);
  },
  async merge(root, p) {
    const target = await commitish(root, p.ref);
    const args = ["merge"];
    if (p.squash) args.push("--squash");
    else if (p.noFastForward) args.push("--no-ff");
    if (p.noCommit) args.push("--no-commit");
    if (!p.squash && !p.noCommit) args.push("--no-edit");
    await git(root, [...args, "--end-of-options", target]);
  },
  async rebase(root, p) {
    await git(root, ["rebase", ...(p.ignoreDate ? ["--ignore-date"] : []), "--end-of-options", await commitish(root, p.ref)]);
  },
  async cherryPick(root, p) {
    await git(root, ["cherry-pick", ...(p.noCommit ? ["--no-commit"] : []), ...(p.recordOrigin ? ["-x"] : []), ...mainline(p.parent), hash(p.hash)]);
  },
  async revert(root, p) {
    await git(root, ["revert", "--no-edit", ...mainline(p.parent), hash(p.hash)]);
  },
  async dropCommit(root, p) {
    const h = hash(p.hash);
    const anc = await git(root, ["merge-base", "--is-ancestor", h, "HEAD"], { allowFail: true });
    if (anc.code !== 0) throw new UserError("commit is not on the current branch");
    await git(root, ["rebase", "--onto", `${h}^`, h]);
  },
  async reset(root, p) {
    const mode = { soft: "--soft", mixed: "--mixed", hard: "--hard" }[p.mode];
    if (!mode) throw new UserError("invalid reset mode");
    await git(root, ["reset", mode, hash(p.hash)]);
  },
  async createTag(root, p) {
    const name = await tagName(root, p.name);
    const at = hash(p.hash);
    if (p.message) await git(root, ["tag", "-a", name, "-m", str(p.message, "message", 20_000), at]);
    else await git(root, ["tag", name, at]);
    if (p.pushTo) await git(root, ["push", await remote(root, p.pushTo), `refs/tags/${name}`], LONG);
  },
  async deleteTag(root, p) {
    const name = await tagName(root, p.name);
    await git(root, ["tag", "-d", name]);
    if (p.deleteOnRemote) await git(root, ["push", await remote(root, p.deleteOnRemote), "--delete", `refs/tags/${name}`], LONG);
  },
  async pushTag(root, p) {
    await git(root, ["push", await remote(root, p.remote), `refs/tags/${await tagName(root, p.name)}`], LONG);
  },
  async stashPush(root, p) {
    const args = ["stash", "push"];
    if (p.includeUntracked) args.push("--include-untracked");
    if (p.message) args.push("-m", str(p.message, "message", 2000));
    await git(root, args);
  },
  async stashApply(root, p) {
    await git(root, ["stash", "apply", ...(p.reinstateIndex ? ["--index"] : []), stash(p.selector)]);
  },
  async stashPop(root, p) {
    await git(root, ["stash", "pop", ...(p.reinstateIndex ? ["--index"] : []), stash(p.selector)]);
  },
  async stashDrop(root, p) {
    await git(root, ["stash", "drop", stash(p.selector)]);
  },
  async stashBranch(root, p) {
    await git(root, ["stash", "branch", await branchName(root, p.name), stash(p.selector)]);
  },
  async resetUncommitted(root, p) {
    const mode = { mixed: "--mixed", hard: "--hard" }[p.mode];
    if (!mode) throw new UserError("invalid reset mode");
    await git(root, ["reset", mode, "HEAD"]);
  },
  async cleanUntracked(root, p) {
    await git(root, ["clean", "-f", ...(p.directories ? ["-d"] : [])]);
  },
  async abortOperation(root, p) {
    const cmd = { rebasing: "rebase", merging: "merge", "cherry-picking": "cherry-pick", reverting: "revert" }[p.state];
    if (!cmd) throw new UserError("nothing to abort");
    await git(root, [cmd, "--abort"]);
  },
  async continueOperation(root, p) {
    const cmd = { rebasing: "rebase", "cherry-picking": "cherry-pick", reverting: "revert" }[p.state];
    if (!cmd) throw new UserError("nothing to continue");
    await git(root, [cmd, "--continue"], { env: { GIT_EDITOR: "true" } });
  },
};

const reads = {
  info: (root, p) => info(root, p.cwd),
  log,
  details,
  uncommittedDetails,
  fileDiff,
  fileContent,
  fingerprint,
};

async function dispatch(payload) {
  if (!payload || typeof payload !== "object") throw new UserError("bad request");
  const { op } = payload;
  const root = await repoRoot(payload.cwd);
  if (Object.hasOwn(reads, op)) return reads[op](root, payload);
  if (Object.hasOwn(actions, op)) {
    await actions[op](root, payload);
    return { done: true };
  }
  throw new UserError(`unknown op ${op}`);
}

module.exports.register = ({ ipcMain, isTrustedSender, log: say }) => {
  ipcMain.removeHandler(CHANNEL);
  ipcMain.handle(CHANNEL, async (event, payload) => {
    if (!isTrustedSender(event)) return { ok: false, error: "untrusted sender" };
    const started = Date.now();
    try {
      const data = await dispatch(payload);
      if (Object.hasOwn(actions, payload.op)) say(`${payload.op} ok (${Date.now() - started}ms)`);
      return { ok: true, data };
    } catch (e) {
      if (!(e instanceof UserError)) say(`${payload?.op} crashed: ${e.stack ?? e}`);
      return { ok: false, error: e.message || String(e) };
    }
  });
};
module.exports._test = { dispatch, parseNumstat, parseNameStatus, parseStatus };
