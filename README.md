# t3-modloader

Mods for the T3 Code desktop app (Electron), loaded from a `mods/` folder (folders or zips) and managed from a Mods window inside T3.
The installer makes one small, reversible patch to T3's entry file; the live injector (below) changes nothing on disk.

The first mod is **Commit Graph**: a Git Graph-style commit graph that opens as a right-panel surface. It sits in "Open a surface" directly below "Pull request" and has no hotkey.

## Installation

Needs Node 22 or newer and a T3 Code desktop install (Linux AppImage or unpacked build; Windows and macOS paths are written but untested).

1. Clone this repo somewhere it will stay. T3 loads the modloader from this folder.
2. Run the installer:

   ```sh
   node bin/t3mod-install.mjs            # find T3, patch it, add the launcher
   ```

   It looks for T3 itself and asks for its folder or `.AppImage` only if it finds none. `--dir PATH` skips the search; `--yes` skips the confirmation and takes the first T3 found. It shows what it will change and asks before doing it.
3. Quit T3 and start it again. On an AppImage install, start T3 from its desktop entry (the installer repoints it) or run `~/.local/share/t3-modloader/t3code-modded`. Unpacked installs start as usual, and need the installer run again after a T3 update.
4. Open **Mods** in the sidebar footer, right after Usage. Mods in this repo's `mods/` folder show up there. The first run loads everything found; mods you add later start under Available, so stage them with the arrows and click **Confirm**.

Other commands:

```sh
node bin/t3mod-install.mjs status     # what is installed
node bin/t3mod-install.mjs find       # list the T3 installs it can see
node bin/t3mod-install.mjs uninstall  # undo everything, newest change first
```

To uninstall from inside T3, use **Remove modloader…** in the Mods window. Both ways restore T3's files, and your mod files stay where they are. If this repo moves, run the installer again; if it is gone, T3 starts unmodified. To try mods without installing, see "Inject into a running T3 (live)" below.

### What the installer does

Flags: `--dir PATH` (a T3 folder or `.AppImage`, skips the search and the prompt), `--yes`, `--force` (patch builds that enforce asar integrity), `--keep-config` (uninstall only: uninstall removes the enabled list in `config.json` unless you pass this).

The installer looks in `PATH`, the T3 updater's download folder, `~/Applications`, `~/Downloads`, `~/.local/bin`, `/opt`, `/usr/lib`, `/usr/share`, macOS `.app` bundles and the Windows `Programs` folders. If nothing is found it asks for the folder. It reads the entry point from T3's `app.asar` and inserts one marked block (`/*t3mod:begin*/…/*t3mod:end*/`) that calls the loader.

- **Unpacked installs** (folder with `resources/app.asar`): `app.asar` is patched in place and the original is kept as `app.asar.t3mod-backup`.
- **AppImage**: the AppImage itself is never modified. A patched copy is extracted into the data dir (about 600 MB), a `t3code-modded` launcher is written, and desktop entries that ran the AppImage are pointed at it. A new T3 version is re-extracted on its first start.
- Builds with Electron's `EmbeddedAsarIntegrityValidation` fuse on are refused unless `--force`.
- Everything it changes is recorded in `install.json` in the config dir (`~/.config/t3-modloader` on Linux). Uninstall restores desktop entries and the asar byte for byte.

The modloader itself is the built-in `core` mod: it owns the Mods button and window, is always loaded and has a lock in the list. **Remove modloader…** in the Mods window unloads every mod, then removes the Mods window and button, then runs the uninstall above.

## Commit Graph

- Graph lanes with colours that stay stable per branch. Merge commits are muted, and HEAD and uncommitted changes show as hollow nodes.
- Stashes appear as rows above their base commit.
- Ref labels: local branch with its remote, remote-only branches, tags, and stashes.
- Inline commit details:
  - parent links and a selector to compare a merge against parent 1 or 2;
  - a file tree with compacted folders and +/− counts;
  - click a file to open its diff in T3's own diff component (syntax highlighting, folded unchanged lines, Diff / Full file toggle); the "+" in the gutter adds a line comment that lands in the chat composer as a reference;
  - the clock icon at the top right switches to the built-in plain diff (remembered). That plain view is also the automatic fallback when a T3 update moves the anchors the T3 diff needs.
- Toolbar:
  - a Branches filter, saved per repo;
  - a Remotes toggle;
  - Find (Ctrl+F);
  - Fetch and Refresh buttons;
  - a banner with Continue/Abort during a rebase, merge, cherry-pick or revert.
- Right-click menus on commits, branches, remote branches, tags, stashes, uncommitted changes and files:
  - checkout, create, rename and delete branches;
  - push (normal, lease, force) and pull;
  - merge, rebase, cherry-pick and revert;
  - drop a commit, and reset soft, mixed or hard;
  - tag create, push and delete;
  - stash apply, pop, drop and branch;
  - discard and clean;
  - copy hash or name;
  - open a file in T3.
- Updates on its own: it polls a cheap fingerprint every 3 s while visible, and again on window focus.
- Styling uses only T3's CSS variables, so it follows the active theme.

Git runs in T3's main process through a fixed list of operations. The process is started with `execFile` (no shell), `GIT_TERMINAL_PROMPT=0` and SSH `BatchMode`. Every ref, remote, path and stash argument is validated, and `--end-of-options` is used where git supports it. Only the T3 app document can call the IPC channel; browser previews and other frames are refused.

This is an original implementation, not a copy of the Git Graph extension's code.

## Usage

### Inject into a running T3 (live)

```sh
node bin/t3mod-inject.mjs              # inject or hot-reload mods, then reload the window
node bin/t3mod-inject.mjs --no-reload  # update main-process code only
```

How it works:

1. SIGUSR1 opens Node's inspector on `127.0.0.1:9229` inside T3's main process.
2. The script requires `src/main/loader.cjs` over CDP and calls `live()`.
3. It closes the inspector again.

Before sending the signal, it checks that the process catches SIGUSR1, so the signal can never terminate T3. Run it again after editing a mod; module caches are cleared first.

### Start T3 with mods (legacy inspector launcher)

Kept for machines where patching is not wanted; the installer above replaces it.

```sh
bin/install.sh            # rewrites ~/.local/bin/t3code-appimage (the desktop entry's Exec)
bin/install.sh uninstall  # restores the original, kept at t3code-appimage.t3mod-backup
```

The installed script runs `bin/t3code-launch.mjs`:

1. It starts the newest AppImage with `--inspect-brk` on a random localhost port.
2. It breaks on the first line of T3's own code, after Electron's bootstrap.
3. It calls `cold()` there, before T3 registers its protocol.
4. It resumes the app and closes the inspector.

If anything fails (node missing, drive not mounted, inspector timeout, loader error, app exit), the paused process is killed or resumed and plain T3 starts instead. `T3MOD_DISABLE=1` skips mods entirely. Launch results go to `~/.t3/userdata/logs/t3mod-launch.log`.

Auto-updates also go through the launcher. When T3's updater spawns the new `*.AppImage`, `cold()` reroutes that spawn so mods survive an update.

`NODE_OPTIONS=--require …` does not work here: packaged Electron ignores it even with the NodeOptions fuse enabled. That is why the launcher uses the inspector.

## How mods work

```
src/main/loader.cjs   protocol interception, chunk patching, mod asset serving, IPC setup
src/main/mods.cjs     finds mods (folder or zip) and runs their code from memory
src/main/zip.cjs      the zip reader/writer
src/main/preload.cjs  exposes window.t3mod.invoke(channel, payload); channels must match t3mod:<mod>:<name>
src/main/scope.cjs    the disposer stack behind the registration helpers (transactional injection)
src/main/failures.cjs the per-mod "failed" status (phase + short reason) the Mods window reads
src/client/kit.js     renderer-side registration helpers, served at /__t3mod/kit.js
src/core/             built in: the Mods button and modal (always loaded)
mods/                 your mods: one folder or one .zip each
```

- T3 serves its UI from `t3code://app/…`. The loader wraps that protocol handler:
  - it rewrites matching JS chunks on the fly;
  - it serves `/__t3mod/<mod>/…` from the mod's `client/` files;
  - `/__t3mod/status.json` reports each mod's status.
- A patch can be `optional: true`: if its anchor is missing it is skipped and logged, and the mod stays loaded (Commit Graph uses this for T3's diff component).
- Patches are string-anchored. Minified identifiers are captured by regex, not hard-coded. Each mod is verified as a whole against the current bundle before it is enabled: if any required anchor is missing (e.g. after a T3 update), that mod turns itself off and T3 loads unmodified.
- `main({ electron, ipcMain, scope, log, isTrustedSender, loader })` runs in the main process. Everything a mod changes goes through `scope` (see "Mod registration helpers"), so unloading, disabling, hot reload and a failed load all undo it the same way.

## The Mods button

A **Mods** button sits in the sidebar footer, right after Usage. It opens a modal with **Loaded** on the left and **Available** on the right. Selecting a mod previews its `mod.md`; The arrow beside a card (or **Load** / **Unload** in the preview) only stages the move; the card jumps to the other column and is tagged "will load" / "will unload". Nothing changes until you click **Confirm** at the bottom (it shows the counts, e.g. "Confirm +2 −1"), which applies every staged change at once and reloads T3's window once (patches are applied as the client loads). **Discard** drops the staged changes. **Open folder** opens `mods/`; **Rescan** picks up files you just dropped in.

Which mods run is kept in `~/.config/t3-modloader/config.json` (`{ "enabled": [...] }`, or `$T3MOD_CONFIG`). On the first run everything found is enabled. A mod dropped in later starts out **Available**: mods run with full access in T3's main process, so nothing new runs until you load it.

## Writing a mod

A mod is a folder in `mods/`, or the same folder as a `.zip` (or `.t3mod`) file. Both work the same way. A zip is read into memory and its code is compiled from memory; nothing is unpacked. The files may sit at the zip's root or inside one wrapping folder.

```
my-mod/
  mod.md       manifest and description (shown in the modal)
  mod.cjs      optional: module.exports = { patches, main }
  client/      optional: static files, served at /__t3mod/<id>/...
```

`mod.md` is markdown with a small frontmatter. Everything after the frontmatter is the preview in the modal (headings, lists, code, bold/italic; HTML is escaped):

```markdown
---
id: my-mod            # lowercase letters, digits, dashes; defaults to the folder or zip name
name: My Mod
version: 1.0.0
author: you
description: One line for the list.
---

# My Mod
What it does.
```

`mod.cjs` can `require` node built-ins, `electron` and its own files (`./x.cjs`, `./data.json`). It cannot require npm packages; bundle them into a file instead. Pack a folder into a zip with:

```sh
node bin/t3mod-pack.mjs mods/my-mod            # writes mods/my-mod.zip
```

Mods are a folder or a zip, never both under one id; the first one found wins and the other is reported as a duplicate in the modal.

### Mod registration helpers

A mod must change T3 only through these helpers. Each does the change and records its undo, so a mod that fails halfway leaves T3 as if it had never loaded, and unload, disable and hot reload run the same undo.

Main process, `main({ scope })`:

```js
scope.ipcHandle(channel, fn)          // ipcMain.handle; removed on undo (ipcOn / ipcOnce for listeners)
scope.on(emitter, event, fn)          // app, webContents, windows, process...; listener removed
scope.patch(obj, key, (orig) => fn)   // replace a function; original restored (pass-through if someone wrapped it since)
scope.timeout(fn, ms) / scope.interval(fn, ms)
scope.window(() => new BrowserWindow(...))   // destroyed on undo
scope.defer(() => { ... })            // anything else: files, child processes, your own state
```

Renderer, in `client/runtime.js` (`import { scope } from "/__t3mod/kit.js"`):

```js
const S = scope("my-mod");
S.run(() => {                         // a throw or rejection undoes everything below and reports the failure
  S.style(new URL("./style.css", import.meta.url).href);   // or S.style({ css })
  const el = S.add(document.createElement("div"));         // appended to <body>, removed on undo
  S.on(window, "focus", fn);          // S.timeout, S.interval, S.patch, S.defer work as above
  S.global("myMod", api);             // globalThis.__t3mod.myMod, for the patched chunks
});
```

Rules:

- Undo runs newest first. A disposer that throws is logged and the rest still run. Every helper returns its own undo function if you want to release early.
- If `mod.cjs` throws, `main()` throws or rejects, or the renderer setup fails, the mod shows as **failed** in the Mods window with a short reason (`failure: { phase, reason }` in the list data; phase is `load`, `main` or `renderer`). Its main-process and renderer registrations are undone, its patches stop being applied on the next reload, and other mods and T3 keep running.
- Not covered: anything done outside the helpers (top-level code in `mod.cjs` that registers things, a listener added straight on `electron`, a global set by hand, files written without `defer`). The loader cannot see those, so a failing mod can leave them behind.
- If the loader itself cannot inject (no preload script, no usable protocol handler, an exception while setting up), it undoes everything it registered, unloads every mod and passes `t3code://` requests straight through, so T3 runs unmodified. The reason is in `/__t3mod/status.json` under `loader`.

## Skills

`skills/t3-create-mod` walks an agent through making a mod; `skills/t3-mod-styleguide` holds the UI rules it points to. Copy or symlink them into `~/.claude/skills/` (or a project's `.claude/skills/`) to use them.

## Tests

```sh
npm test                                    # git ops against a throwaway repo + bare remote, incl. hostile input; then zip/discovery/config tests; then asar patching and install/uninstall against a synthetic T3; then transactional injection (fixture mods that fail at every stage, against a fake Electron)
node test/patches.test.mjs <client dir>     # anchors + syntax of patched chunks, against an extracted app.asar
```

To get a client dir: `npx @electron/asar extract <mount>/resources/app.asar out`, then use `out/apps/server/dist/client`.

## Limitations

- Works only with local projects: git runs on this machine, so remote T3 environments are unsupported.
- T3 nightlies can move the patch anchors. When that happens, the mod disables itself and `node test/patches.test.mjs` shows which anchor broke.
- Native context menus come from Electron's `Menu`. They match the OS rather than T3's popovers.

## License

[MIT](LICENSE) © 2026 joseph. This covers the modloader and the Commit Graph mod. The bundled third-party assets below keep their own licences.

## Third-party assets

- File-type icons in `mods/commit-graph/client/icons/` come from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) 5.40.0 (MIT, licence alongside them). Regenerate with `node bin/vendor-icons.mjs <extracted package dir>`.
- Toolbar icons (search, fetch, pull, push, refresh, more) are [VS Code Codicons](https://github.com/microsoft/vscode-codicons) 0.0.45, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), inlined in `runtime.js`.
