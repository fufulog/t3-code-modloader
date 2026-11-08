"use strict";
// Installing the modloader into a T3 Code install, and taking it out again.
//
// What "installed" means: T3's Electron entry (the `main` of its app.asar) starts with
// one guarded line that loads src/main/loader.cjs from this repo. From there the
// loader patches the client as it loads and runs mods. Nothing else of T3 changes.
//
//   dir installs   (Windows, macOS, unpacked Linux)   app.asar is patched in place; the original is kept next to it.
//   AppImage       the AppImage is read-only, so it is extracted once into the modloader's data dir,
//                  that copy is patched, and the desktop entry launches it through a small launcher.
//
// Every change is written to install.json as it is made; uninstall() undoes them in reverse.

const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const asar = require("./asar.cjs");
const targets = require("./targets.cjs");
const paths = require("../main/paths.cjs");

const ROOT = path.resolve(__dirname, "../..");
const LOADER = path.join(ROOT, "src/main/loader.cjs");
const BEGIN = "/*t3mod:begin*/";
const END = "/*t3mod:end*/";
const FUSE_SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";

const manifestFile = () => path.join(paths.configDir(), "install.json");
const treeRoot = () => path.join(paths.dataDir(), "t3code");
const launcherFile = () => path.join(paths.dataDir(), "t3code-modded");
const backupDir = () => path.join(paths.configDir(), "backups");

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestFile(), "utf8"));
  } catch {
    return null;
  }
}
function writeManifest(m) {
  fs.mkdirSync(path.dirname(manifestFile()), { recursive: true });
  fs.writeFileSync(manifestFile(), JSON.stringify(m, null, 2) + "\n");
}

// ---- the bootstrap line ----------------------------------------------------------------

const bootstrap = (launcher) => `${BEGIN}try{require(${JSON.stringify(LOADER)}).cold(${JSON.stringify({ launcher: launcher || undefined })})}catch(e){}${END}\n`;

function strip(src) {
  const a = src.indexOf(BEGIN);
  if (a < 0) return src;
  const b = src.indexOf(END, a);
  if (b < 0) throw new Error("found the start of a t3mod block but not its end; refusing to guess");
  return src.slice(0, a) + src.slice(b + END.length).replace(/^\r?\n/, "");
}

/** Add the bootstrap at the top of `src` (after a leading "use strict", so strict mode survives). */
function inject(src, launcher) {
  const clean = strip(src);
  const m = clean.match(/^(\s*(?:\/\/[^\n]*\n\s*)*["']use strict["'];?[ \t]*\r?\n)/);
  const at = m ? m[0].length : 0;
  return clean.slice(0, at) + bootstrap(launcher) + clean.slice(at);
}

// ---- electron fuses ------------------------------------------------------------------------

const FUSES = ["RunAsNode", "CookieEncryption", "NodeOptionsEnvVar", "NodeCliInspect", "EmbeddedAsarIntegrityValidation", "OnlyLoadAppFromAsar"];
/** Read the fuse flags baked into an Electron binary: { EmbeddedAsarIntegrityValidation: true, ... } or null. */
function readFuses(binary) {
  try {
    const buf = fs.readFileSync(binary);
    const i = buf.indexOf(FUSE_SENTINEL);
    if (i < 0) return null;
    const len = buf[i + FUSE_SENTINEL.length + 1];
    const out = {};
    FUSES.forEach((name, n) => {
      if (n < len) out[name] = buf[i + FUSE_SENTINEL.length + 2 + n] === 0x31;
    });
    return out;
  } catch {
    return null;
  }
}

// ---- patching an app.asar ---------------------------------------------------------------------

/** Write a patched copy of `asarFile` to `dest`. Returns the entry file that was patched. */
function patchedAsar(asarFile, dest, launcher) {
  const { main } = targets.appInfo(asarFile) ?? {};
  if (!main || !/\.cjs$|\.js$/.test(main)) throw new Error(`cannot patch this T3 build: entry point is ${main ?? "unknown"}, expected a CommonJS file`);
  const src = asar.readFile(asarFile, main);
  if (!src) throw new Error(`entry ${main} not found in ${asarFile}`);
  asar.replaceFile(asarFile, dest, main, Buffer.from(inject(src.toString("utf8"), launcher), "utf8"));
  return main;
}

const isPatched = (asarFile) => {
  try {
    const { main } = targets.appInfo(asarFile) ?? {};
    return !!main && asar.readFile(asarFile, main).toString("utf8").includes(BEGIN);
  } catch {
    return false;
  }
};

// ---- AppImage: patched extracted copy ------------------------------------------------------------

function treeFor(appImage) {
  return path.join(treeRoot(), path.basename(appImage).replace(/\.AppImage$/i, ""));
}

/** Extract `appImage` (once) into the data dir and patch the copy. Returns the tree dir. */
function prepareTree(appImage, log = () => {}) {
  const tree = treeFor(appImage);
  const asarFile = path.join(tree, "resources", "app.asar");
  if (fs.existsSync(asarFile) && isPatched(asarFile)) return tree;
  fs.mkdirSync(treeRoot(), { recursive: true });
  const stage = fs.mkdtempSync(path.join(treeRoot(), ".stage-"));
  try {
    try {
      fs.accessSync(appImage, fs.constants.X_OK);
    } catch {
      throw new Error(`${appImage} is not executable (chmod +x it), so it cannot extract itself`);
    }
    log(`extracting ${path.basename(appImage)} (about 600 MB)`);
    execFileSync(appImage, ["--appimage-extract"], { cwd: stage, stdio: "ignore", timeout: 5 * 60 * 1000 });
    const extracted = path.join(stage, "squashfs-root");
    const inner = path.join(extracted, "resources", "app.asar");
    if (!fs.existsSync(inner)) throw new Error("the AppImage did not contain resources/app.asar");
    const out = inner + ".t3mod-new";
    patchedAsar(inner, out, launcherFile());
    fs.renameSync(out, inner);
    fs.rmSync(tree, { recursive: true, force: true });
    fs.renameSync(extracted, tree);
    return tree;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** Keep the two newest patched trees; each is ~600 MB. */
function pruneTrees(keep) {
  try {
    const dirs = fs.readdirSync(treeRoot()).filter((n) => !n.startsWith(".")).map((n) => path.join(treeRoot(), n));
    dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const d of dirs.slice(2)) if (!keep.includes(d)) fs.rmSync(d, { recursive: true, force: true });
  } catch {}
}

function launcherScript(nodePath) {
  return `#!/bin/bash
# t3mod launcher (written by the modloader installer; undo with: node bin/t3mod-install.mjs uninstall)
# Starts T3 Code from a patched copy of the newest AppImage. If anything is missing or
# fails, it starts the original AppImage untouched.
INSTALLER=${JSON.stringify(path.join(ROOT, "bin/t3mod-install.mjs"))}
DATA=${JSON.stringify(treeRoot())}
if [[ "$1" == "--appimage" ]]; then
  APP="$2"; shift 2
else
  APP=$(ls -t "$HOME/.cache/t3code-updater/pending/T3-Code-"*.AppImage 2>/dev/null | head -n1)
  [[ -z "$APP" ]] && APP=${JSON.stringify(readManifest()?.target?.file ?? "")}
fi
[[ -n "$APP" && -x "$APP" ]] || { echo "t3mod launcher: no T3 Code AppImage found" >&2; exit 1; }
if [[ -z "$T3MOD_DISABLE" ]]; then
  TREE="$DATA/$(basename "$APP" .AppImage)"
  if [[ ! -x "$TREE/AppRun" ]]; then
    for NODE in "$T3MOD_NODE" ${JSON.stringify(nodePath)} /usr/bin/node "$HOME/.local/share/mise/shims/node"; do
      [[ -n "$NODE" && -x "$NODE" && -f "$INSTALLER" ]] && { "$NODE" "$INSTALLER" prepare "$APP" >&2 || true; break; }
    done
  fi
  [[ -x "$TREE/AppRun" ]] && exec "$TREE/AppRun" "$@"
fi
exec "$APP" "$@"
`;
}

// ---- desktop entries (AppImage installs) -----------------------------------------------------------

function desktopEntries() {
  const dir = path.join(process.env.XDG_DATA_HOME || path.join(require("node:os").homedir(), ".local", "share"), "applications");
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".desktop"))
      .map((n) => path.join(dir, n))
      .filter((f) => /t3[\s_-]*code/i.test(fs.readFileSync(f, "utf8")) && /^Exec=/m.test(fs.readFileSync(f, "utf8")));
  } catch {
    return [];
  }
}

/** Rewrite a file by renaming a new one over it, so a read-only file (0444 desktop entries exist) still works. Keeps its mode. */
function rewrite(file, text) {
  const mode = fs.statSync(file).mode & 0o7777;
  const tmp = `${file}.t3mod-tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

/** Replace the program in every `Exec=` line, keeping its arguments (%U etc.). */
function retarget(text, program) {
  return text.replace(/^(Exec=)("[^"]*"|\S+)(.*)$/gm, (_m, k, _prog, rest) => `${k}"${program}"${rest}`);
}

// ---- install / uninstall -----------------------------------------------------------------------------

function install(target, { force = false, log = () => {} } = {}) {
  if (readManifest()) {
    log("already installed; reinstalling");
    uninstall({ log, keepConfig: true });
  }
  const manifest = { version: 1, installedAt: new Date().toISOString(), repo: ROOT, target, changes: [] };
  const save = (change) => {
    manifest.changes.push(change);
    writeManifest(manifest);
  };
  try {
    if (target.kind === "dir") {
      const fuses = target.binary && readFuses(target.binary);
      if (fuses?.EmbeddedAsarIntegrityValidation && !force) {
        throw new Error("this build validates app.asar integrity (an Electron fuse), so a patched asar would not start. Re-run with --force to try anyway.");
      }
      const asarFile = target.asar;
      if (isPatched(asarFile)) throw new Error(`${asarFile} already carries a t3mod block from an earlier install; restore its .t3mod-backup first`);
      const next = asarFile + ".t3mod-new";
      const backup = asarFile + ".t3mod-backup";
      try {
        const entry = patchedAsar(asarFile, next, null);
        fs.chmodSync(next, fs.statSync(asarFile).mode);
        if (fs.existsSync(backup)) throw new Error(`${backup} exists already; move it away first`);
        fs.renameSync(asarFile, backup);
        fs.renameSync(next, asarFile);
        save({ type: "asar", asar: asarFile, backup, entry });
        log(`patched ${asarFile} (entry ${entry}); original kept as ${path.basename(backup)}`);
      } catch (e) {
        fs.rmSync(next, { force: true });
        if (e.code === "EACCES" || e.code === "EPERM") throw new Error(`no permission to change ${asarFile}: ${e.message}. Re-run with the rights to write there (e.g. sudo).`);
        throw e;
      }
    } else if (target.kind === "appimage") {
      if (process.platform !== "linux") throw new Error("AppImage installs are Linux only");
      const tree = prepareTree(target.file, log);
      const fuses = readFuses(path.join(tree, "t3code"));
      log(`patched copy at ${tree}${fuses ? "" : " (could not read Electron fuses)"}`);
      save({ type: "tree", root: treeRoot() });
      fs.writeFileSync(launcherFile(), launcherScript(process.execPath), { mode: 0o755 });
      save({ type: "launcher", file: launcherFile() });
      log(`launcher ${launcherFile()}`);
      fs.mkdirSync(backupDir(), { recursive: true });
      for (const entry of desktopEntries()) {
        const text = fs.readFileSync(entry, "utf8");
        if (text.includes(launcherFile())) continue;
        const backup = path.join(backupDir(), path.basename(entry));
        fs.writeFileSync(backup, text);
        rewrite(entry, retarget(text, launcherFile()));
        save({ type: "desktop", file: entry, backup, wrote: launcherFile() });
        log(`desktop entry ${entry} now starts the launcher`);
      }
      // an older t3mod install pointed ~/.local/bin/t3code-appimage at the inspector launcher; put the original back
      // (last, so a failed install leaves it alone; uninstall puts the older launcher back exactly as it was)
      const wrapper = path.join(require("node:os").homedir(), ".local", "bin", "t3code-appimage");
      const old = wrapper + ".t3mod-backup";
      if (fs.existsSync(old) && fs.existsSync(wrapper) && /t3mod/.test(fs.readFileSync(wrapper, "utf8"))) {
        const keep = path.join(backupDir(), "t3code-appimage.legacy");
        fs.copyFileSync(wrapper, keep);
        fs.copyFileSync(old, keep + ".original");
        save({ type: "wrapper", file: wrapper, backup: keep, original: keep + ".original", sidecar: old });
        fs.renameSync(old, wrapper);
        log(`restored the original ${wrapper} (replaced an older t3mod launcher)`);
      }
      pruneTrees([treeFor(target.file)]);
    } else {
      throw new Error(`unknown target kind ${target.kind}`);
    }
  } catch (e) {
    log(`install failed: ${e.message}; undoing`);
    uninstall({ log, keepConfig: true });
    throw e;
  }
  return manifest;
}

/** True when this very process runs out of `dir` (so deleting it now would pull files from under T3). */
const inUse = (dir) => process.execPath.startsWith(dir + path.sep);

function removeLater(dir) {
  if (process.platform === "win32") return false;
  const child = spawn("/bin/sh", ["-c", `while kill -0 ${process.pid} 2>/dev/null; do sleep 1; done; rm -rf "$1"`, "sh", dir], { detached: true, stdio: "ignore" });
  child.unref();
  return true;
}

/**
 * Undo everything install() did, newest change first. Returns [{ label, ok, detail? }].
 * `keepConfig` leaves config.json (the enabled list) alone.
 */
function uninstall({ log = () => {}, keepConfig = false } = {}) {
  const manifest = readManifest();
  const steps = [];
  const step = (label, ok = true, detail) => {
    steps.push({ label, ok, ...(detail ? { detail } : {}) });
    log(`${ok ? "ok" : "FAILED"}  ${label}${detail ? `: ${detail}` : ""}`);
  };
  if (!manifest) {
    step("Nothing to restore: this T3 was not set up by the installer");
    return steps;
  }
  for (const c of [...manifest.changes].reverse()) {
    try {
      if (c.type === "asar") {
        if (fs.existsSync(c.backup)) {
          fs.renameSync(c.backup, c.asar);
          step(`Restored the original ${path.basename(c.asar)}`);
        } else if (fs.existsSync(c.asar) && isPatched(c.asar)) {
          const out = c.asar + ".t3mod-new";
          const main = c.entry;
          asar.replaceFile(c.asar, out, main, Buffer.from(strip(asar.readFile(c.asar, main).toString("utf8")), "utf8"));
          fs.renameSync(out, c.asar);
          step(`Removed the t3mod block from ${path.basename(c.asar)} (no backup was found)`);
        } else {
          step(`${path.basename(c.asar)} is already original`);
        }
      } else if (c.type === "launcher") {
        fs.rmSync(c.file, { force: true });
        step("Removed the launcher");
      } else if (c.type === "desktop") {
        if (fs.existsSync(c.file) && fs.readFileSync(c.file, "utf8").includes(c.wrote)) {
          rewrite(c.file, fs.readFileSync(c.backup, "utf8"));
          step(`Restored the desktop entry ${path.basename(c.file)}`);
        } else {
          step(`Desktop entry ${path.basename(c.file)} no longer starts the launcher; left as it is`);
        }
      } else if (c.type === "wrapper") {
        if (fs.existsSync(c.file) && /t3mod/.test(fs.readFileSync(c.file, "utf8"))) {
          step(`${path.basename(c.file)} is still the older launcher`);
        } else if (fs.existsSync(c.backup)) {
          fs.copyFileSync(c.file, c.sidecar); // the original becomes the sidecar again
          fs.copyFileSync(c.backup, c.file); // and the older t3mod launcher comes back
          step(`Put the older launcher ${path.basename(c.file)} back`);
        } else {
          step(`No saved copy of ${path.basename(c.file)}; left as it is`);
        }
      } else if (c.type === "tree") {
        if (inUse(c.root)) {
          step(removeLater(c.root) ? "The patched T3 copy is in use; it will be deleted when T3 quits" : "The patched T3 copy is in use; delete it after quitting T3", true, c.root);
        } else {
          fs.rmSync(c.root, { recursive: true, force: true });
          step("Deleted the patched T3 copy");
        }
      }
    } catch (e) {
      step(`Could not undo ${c.type}`, false, e.message);
    }
  }
  fs.rmSync(manifestFile(), { force: true });
  fs.rmSync(backupDir(), { recursive: true, force: true });
  if (!keepConfig) fs.rmSync(path.join(paths.configDir(), "config.json"), { force: true });
  for (const d of [paths.configDir(), paths.dataDir()]) {
    try {
      fs.rmdirSync(d);
    } catch {}
  }
  return steps;
}

function status() {
  const m = readManifest();
  if (!m) return { installed: false };
  const checks = m.changes.map((c) => {
    if (c.type === "asar") return { ...c, present: fs.existsSync(c.asar) && isPatched(c.asar), backup: fs.existsSync(c.backup) };
    if (c.type === "tree") return { ...c, present: fs.existsSync(c.root) };
    return { ...c, present: fs.existsSync(c.file) };
  });
  return { installed: true, installedAt: m.installedAt, target: m.target, repo: m.repo, changes: checks };
}

module.exports = { install, uninstall, status, prepareTree, pruneTrees, readFuses, rewrite, inject, strip, isPatched, readManifest, manifestFile, launcherFile, treeFor, BEGIN, END };
