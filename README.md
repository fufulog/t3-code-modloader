# t3-modloader

Mods for the T3 Code desktop app (Electron), injected into the app's main process.
T3 itself is not modified on disk.

The first mod is **Commit Graph**: a Git Graph-style commit graph that opens as a right-panel surface. It sits in "Open a surface" directly below "Pull request" and has no hotkey.

## Commit Graph

- Graph lanes with colours that stay stable per branch. Merge commits are muted, and HEAD and uncommitted changes show as hollow nodes.
- Stashes appear as rows above their base commit.
- Ref labels: local branch with its remote, remote-only branches, tags, and stashes.
- Inline commit details:
  - parent links and a selector to compare a merge against parent 1 or 2;
  - a file tree with compacted folders and +/− counts;
  - click a file to open its unified diff.
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

### Start T3 with mods (cold)

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
src/main/loader.cjs      protocol interception, chunk patching, mod asset serving, IPC setup
src/main/preload.cjs     exposes window.t3mod.invoke(channel, payload); channels must match t3mod:<mod>:<name>
src/mods/<name>/mod.cjs  { patches, main }
```

- T3 serves its UI from `t3code://app/…`. The loader wraps that protocol handler:
  - it rewrites matching JS chunks on the fly;
  - it serves `/__t3mod/<mod>/…` from the mod's `client/` directory;
  - `/__t3mod/status.json` reports each mod's status.
- Patches are string-anchored. Minified identifiers are captured by regex, not hard-coded. Each mod is verified as a whole against the current bundle before it is enabled: if any required anchor is missing (e.g. after a T3 update), that mod turns itself off and T3 loads unmodified.
- `main({ electron, ipcMain, log, isTrustedSender })` runs in the main process to register IPC handlers.

## Tests

```sh
npm test                                    # git ops against a throwaway repo + bare remote, incl. hostile input
node test/patches.test.mjs <client dir>     # anchors + syntax of patched chunks, against an extracted app.asar
```

To get a client dir: `npx @electron/asar extract <mount>/resources/app.asar out`, then use `out/apps/server/dist/client`.

## Limitations

- Works only with local projects: git runs on this machine, so remote T3 environments are unsupported.
- T3 nightlies can move the patch anchors. When that happens, the mod disables itself and `node test/patches.test.mjs` shows which anchor broke.
- Native context menus come from Electron's `Menu`. They match the OS rather than T3's popovers.

## Third-party assets

- File-type icons in `src/mods/commit-graph/client/icons/` come from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) 5.40.0 (MIT, licence alongside them). Regenerate with `node bin/vendor-icons.mjs <extracted package dir>`.
- Toolbar icons (search, fetch, refresh) are [VS Code Codicons](https://github.com/microsoft/vscode-codicons) 0.0.45, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), inlined in `runtime.js`.
