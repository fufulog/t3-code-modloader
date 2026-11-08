"use strict";
// Finds T3 Code installs. A target is one of:
//   { kind: "appimage", file }            a Linux AppImage (read-only; installs patch an extracted copy)
//   { kind: "dir", root, asar, binary }   an unpacked install (Linux /opt, Windows, macOS .app): patched in place
// Each also carries { version } read from the app's package.json.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const asar = require("./asar.cjs");

const NAME = /t3[\s_-]*code/i;

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const list = (dir) => {
  try {
    return fs.readdirSync(dir).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
};

function appInfo(asarFile) {
  try {
    const pkg = JSON.parse(asar.readFile(asarFile, "package.json").toString("utf8"));
    return { name: pkg.name, version: pkg.version, main: pkg.main };
  } catch {
    return null;
  }
}

/** Turn a user-supplied or discovered path into a target, or null when it is not T3 Code. */
function resolveTarget(input) {
  const p = real(input);
  if (!p) return null;
  if (isFile(p)) {
    if (/\.AppImage$/i.test(p)) return { kind: "appimage", file: p, version: "" };
    if (path.basename(p) === "app.asar") return resolveTarget(path.dirname(path.dirname(p)));
    // a launcher binary inside an install dir
    return resolveTarget(path.dirname(p));
  }
  if (!isDir(p)) return null;
  const asarAt = [path.join(p, "resources", "app.asar"), path.join(p, "Contents", "Resources", "app.asar"), path.join(p, "app.asar")].find(isFile);
  if (asarAt) {
    const info = appInfo(asarAt);
    if (!info?.main) return null;
    const root = p;
    const binary = [path.join(p, "t3code"), path.join(p, "T3 Code"), path.join(p, "T3 Code.exe"), path.join(p, "Contents", "MacOS", "T3 Code")].find(isFile) ?? null;
    return { kind: "dir", root, asar: asarAt, binary, version: info.version ?? "" };
  }
  // the user gave a parent such as /opt: look one level down for something named like T3 Code
  for (const child of list(p)) if (NAME.test(path.basename(child)) && isDir(child)) {
    const t = resolveTarget(child);
    if (t) return t;
  }
  return null;
}

/** Everything that looks like a T3 Code install on this machine, best first. */
function findTargets(env = process.env) {
  const home = os.homedir();
  const found = [];
  const add = (p) => {
    // A running AppImage is FUSE-mounted at /tmp/.mount_* (and put on PATH): read-only and temporary.
    if (p && !/[\\/]\.mount_[^\\/]+/.test(p)) found.push(p);
  };

  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const n of ["t3code", "t3-code", "T3Code", "t3code.AppImage", "T3 Code"]) {
      const f = path.join(dir, n);
      if (isFile(f)) add(f);
    }
  }
  if (process.platform === "linux") {
    const appImages = (dir) => list(dir).filter((f) => NAME.test(path.basename(f)) && /\.AppImage$/i.test(f) && isFile(f));
    const newest = (arr) => arr.map((f) => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t).map((x) => x.f);
    for (const f of newest(appImages(path.join(home, ".cache", "t3code-updater", "pending")))) add(f);
    for (const d of [path.join(home, "Applications"), path.join(home, "Downloads"), path.join(home, ".local", "bin"), path.join(home, "bin"), path.join(home, "Desktop")]) for (const f of newest(appImages(d))) add(f);
    for (const base of ["/opt", "/usr/lib", "/usr/lib64", "/usr/share", "/usr/local/lib", "/usr/local/share", path.join(home, ".local", "share"), path.join(home, ".local", "opt")]) {
      for (const d of list(base)) if (NAME.test(path.basename(d)) && isDir(d)) add(d);
    }
  } else if (process.platform === "darwin") {
    for (const base of ["/Applications", path.join(home, "Applications")]) for (const d of list(base)) if (NAME.test(path.basename(d)) && d.endsWith(".app")) add(d);
  } else if (process.platform === "win32") {
    const bases = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs"), env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean);
    for (const base of bases) for (const d of list(base)) if (NAME.test(path.basename(d)) && isDir(d)) add(d);
  }

  const seen = new Set();
  const targets = [];
  for (const p of found) {
    const t = resolveTarget(p);
    if (!t) continue;
    const key = t.kind === "appimage" ? t.file : t.asar;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(t);
  }
  return targets;
}

const describe = (t) => (t.kind === "appimage" ? `AppImage ${t.file}` : `install at ${t.root}`) + (t.version ? ` (v${t.version})` : "");

module.exports = { findTargets, resolveTarget, describe, appInfo };
