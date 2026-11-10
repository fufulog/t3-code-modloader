# AGENTS.md

Working notes for any AI agent (or person) changing this repo. `CLAUDE.md` imports this file, so Claude Code, Codex and others all read the same rules. The README is the user-facing manual; this file is how to work here.

## What this repo is

A mod loader for the **T3 Code desktop app** (Electron). It patches T3's own client chunks on the fly, serves mod files from `/__t3mod/…`, and adds a **Mods** button and window. The first mod, **Commit Graph** (`mods/commit-graph`), is a Git Graph-style surface in T3's right panel. MIT licensed, no dependencies, Node 22+.

Read these before changing anything non-trivial:

| File | Why |
| --- | --- |
| `README.md` | install, mod format, registration helpers (`scope`), tests, gate, CI |
| `ROADMAP.md` | what is planned and the ground rules (never interrupt the user, zero cost with no mods, fail open, reversible) |
| `docs/design/anchors.md` | what an "anchor" is and how a missing one is reported |
| `docs/design/update-survival.md` | how mods survive T3 updates per OS |
| `skills/t3-create-mod/SKILL.md`, `skills/t3-mod-styleguide/SKILL.md` | how to make a mod and its UI rules (T3 CSS variables only, outline buttons, stage-then-apply for reloads) |

## Repo map

```
bin/t3mod-inject.mjs     live-inject into the RUNNING T3 (no restart), and run scripts inside it (--eval-only)
bin/t3mod-install.mjs    installer / uninstaller (patches T3's entry file; reversible)
bin/t3mod-pack.mjs       zip a mod folder
src/main/loader.cjs      protocol interception, chunk patching, /__t3mod serving, IPC, mod status
src/main/{mods,zip,scope,anchors,compat,failures,status,paths,preload}.cjs   see README "How mods work"
src/core/                built-in "core" mod: Mods button + window (always loaded, protected)
src/client/kit.js        renderer-side registration helpers
src/install/             asar patching, install/uninstall, finding T3
mods/<id>/               user mods: mod.md (manifest), mod.cjs ({patches, anchors, main}), client/ (served files)
mods/commit-graph/       git.cjs (all git ops, main process), patches.cjs, client/runtime.js (the UI, plain DOM inside one React host)
test/                    plain node tests, no framework: `npm test`
```

`mods/commandcode-usage/` and `mods/hover-thread-row/` may appear untracked in a working tree: they belong to other threads of work. Do not commit or delete them unless asked.

## How the patching works (the part that is easy to get wrong)

- T3 serves its UI from `t3code://app/…` chunks with **hashed, minified** names (`DiffPanel-CImibJyV.js`, `_chat-DhzpME9m.js`). The names and all identifiers change every T3 build.
- A mod's `patches.cjs` is a list of `{ id, file: RegExp, apply(src) }`. `file` matches the chunk name without the hash; `apply` rewrites the source with a regex whose **captures** pick up the minified identifiers. Never hard-code a minified name. Use the `replaceOnce` pattern in `mods/commit-graph/patches.cjs`: the anchor must match exactly once or it throws.
- A required patch that cannot apply disables the whole mod (T3 then runs unmodified). `optional: true` patches are skipped and logged instead; the mod must work without them (Commit Graph's use of T3's own diff component is optional; its plain diff is the fallback).
- Every patch must be declared as an anchor in the mod's `anchors` (patches count automatically), see `docs/design/anchors.md`.
- To find or re-find an anchor: extract T3's client and grep it. `npx @electron/asar extract <app.asar> <empty dir>`, chunks are in `<dir>/apps/server/dist/client/assets`. The running T3's path is `require("electron").app.getAppPath()` from a `--eval-only` script (below). Minified files make `grep -o` explode; use a short Python `re` script to print context around a string.
- Reusing T3's own modules from a mod: append an export alias to the chunk with an optional patch (`export{Jt as __t3mod_X};`), list chunk names via `/__t3mod/chunks.json`, then `import(`/assets/${name}`)` in the runtime. That gives the same module instance T3 uses. Commit Graph does this for T3's diff section, then renders it through a React portal from its Surface (so T3's context, composer drafts and "+" comment button work).
- After a T3 update: `node test/patches.test.mjs <client dir>` against the new extracted client tells you which anchor moved.

## The development loop (how work is actually done here)

1. Edit. Mod UI is in `mods/<id>/client/runtime.js` and `style.css`; main-process code in `git.cjs` / `mod.cjs`.
2. `npm test` (all tests, including the zero-cost gate). For patch changes also `node test/patches.test.mjs <client dir>`.
3. **Look at the real app.** You can, and you should, verify UI changes in the running T3 instead of guessing:

   ```sh
   node bin/t3mod-inject.mjs                      # inject / hot-reload mods into the running T3, reload its window
   node bin/t3mod-inject.mjs --eval-only FILE --arg out=/some/dir   # run FILE in T3's main process, nothing else
   ```

   The inject script finds the T3 main process, opens the Node inspector on 127.0.0.1 through SIGUSR1, runs your code, and closes the inspector. It checks the process catches SIGUSR1 first, so it can never kill T3. `FILE` is the body of an async function: `require` works (`require("electron")`), `ARGS.out` holds `--arg out=…`, `return` a string for output, top-level `await` is fine.

   Examples of every kind of check (open the Mods window, screenshot a panel, click the diff "+", extract T3's asar) are in `dev/scratchpad/` (index in its README); copy and adapt one. Write new throwaway scripts in your scratchpad or a temp dir, not in the repo. The pattern they all use:

   ```js
   const { webContents } = require("electron");
   const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("t3code://"));
   const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
   const ev = (js) => wc.executeJavaScript(js);            // runs inside T3's page, can click, query, read state
   await ev(`document.querySelector('.some-button').click()`);
   await sleep(800);                                        // let React render / data load
   const z = wc.getZoomFactor();                            // screenshots are in device pixels: multiply CSS rects by this
   const r = await ev(`(()=>{const r=document.querySelector('.some-panel').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
   const img = await wc.capturePage({ x: Math.round(r[0]*z), y: Math.round(r[1]*z), width: Math.round(r[2]*z), height: Math.round(r[3]*z) });
   require("fs").writeFileSync(ARGS.out + "/shot.png", img.toPNG());   // then read the PNG with your image tool
   return JSON.stringify(await ev(`({ n: document.querySelectorAll('.row').length })`));
   ```

   Tips learned the hard way:
   - Do the open-and-click in **one** script; UI state does not carry between runs reliably.
   - After `t3mod-inject.mjs` the window reloads; wait a few seconds before the next script, or it throws "Script failed to execute".
   - Plain `.click()` works for most buttons. Libraries that listen to pointer events (the diff view's "+" gutter) need `dispatchEvent(new PointerEvent("pointermove", {bubbles:true, composed:true, ...}))` first. Shadow DOM: query through `el.shadowRoot`.
   - To change React-controlled inputs, set the value with the native setter (`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set`) and dispatch an `input` event.
   - An error like "expected exactly one T3 Code main process" means T3 is not running, is mid-launch, or two copies run. Ask the owner to start it; do not start or restart it yourself.
   - Remove anything your test creates in the user's real state (comments, drafts, config) before finishing. Example: the test comment added to the composer was deleted through its "Delete comment" button.
4. Commit (rules below). Report the hash.

## Rules from the owner (follow exactly)

- **Commit each verified change on `main`** without asking. Conventional Commits, lowercase subject: `feat(commit-graph): …`, `fix(…)`, `style(…)`, `docs(…)`, `test(…)`, `ci(…)`.
- **Never push unless asked.** Origin is `https://github.com/fufulog/t3-code-modloader.git` (public). SSH is rejected here; push over HTTPS: `git -c credential.helper= -c credential.helper='!gh auth git-credential' push`. A pre-push hook runs the suite (install with `node bin/setup-hooks.mjs`).
- **Commit identity is `joseph <fufulog@users.noreply.github.com>`.** The owner's real email must never appear in commits, files or docs. Check `git config user.email` before committing.
- **Never kill or restart T3.** The live injector exists so nothing restarts. Do not run the installer against the owner's real desktop entry or data dir without their go-ahead; installer tests use temp dirs.
- **No terminal git UIs** (lazygit, tig, etc.) and do not suggest them.
- **No screenshots, PNGs or temp test artifacts in the repo** (`*.png` is gitignored; delete stray zips such as a packed `mods/*.zip`, which would show up as a duplicate mod).
- **Zero cost with no mods** (`test/zero-cost.test.mjs`): do not add work to the loader's no-mods path. If you must, update `BASELINE` in that file in the same commit and say why.
- **Fail open and reversible.** A broken mod must never break T3 or other mods; every change to disk is recorded and undoable. Mods change T3 only through the `scope` / `kit.js` helpers.
- **Own the work, don't borrow it.** Features are written from descriptions; do not copy other T3 mod projects' source or the Git Graph extension's code.
- Prefer the owner's wording over yours in user-facing UI text, keep icons Lucide-style and UI on T3's CSS variables (see the styleguide skill).
- When unsure about something outward-facing (pushing, deleting a repo, force-push, history rewrites), ask first. History was already rewritten once to remove the real email; an old commit (`a0e6206`) may still exist on GitHub until the owner decides what to do.

## Things that look like bugs but are not

- A mod that "does nothing" after a T3 update is usually a required anchor that moved. The Mods window shows "anchors missing" and names it; run `node test/patches.test.mjs <client dir>`.
- Two mods with the same id (a folder and a zip) are reported as duplicates; the first found wins.
- A new mod dropped into `mods/` starts under Available on purpose: mods run with full access, so nothing new runs until the owner loads it.
- Changes in the Mods window are staged and only applied (with one window reload) when **Confirm** is pressed.
- A mod's menu entry or tab title vanishes after the mod is removed and re-added in the Mods window, even though status.json says it is enabled with all anchors present: a stale cache. While the mod was off T3 served the chunk (e.g. `PanelLayoutControls`) unpatched and Chromium cached it, so the reload after re-adding reused the unpatched copy. `reloadWindows` in `src/main/loader.cjs` must `await` `session.clearCache()` and `clearCodeCaches({})` before `reloadIgnoringCache()`; the test in `test/mods.test.mjs` checks that order. Do not make it fire-and-forget again. To repair a live window that already has a stale chunk, run the same sequence from an `--eval-only` script (awaited clears, then `wc.reloadIgnoringCache()`). Confirm by checking the chunk was requested in the loader log.
- A T3 started by the legacy launcher leaves its Node inspector open (for example `127.0.0.1:38755`, `--inspect-brk`), so a plain `t3mod-inject.mjs` fails with "inspector did not come up" on 9229. Pass `--port <port> --pid <that process's pid> --keep-open` (find both with `pgrep -af t3code`).
- `git.cjs` validates every ref/path/hash and runs git with `execFile` (no shell). Keep it that way; add a hostile-input test for any new git op.

## Where things live outside the repo

- Enabled mods list: `~/.config/t3-modloader/config.json` (or `$T3MOD_CONFIG`). Installer manifest: `install.json` in the same dir. AppImage installs keep a patched copy under the data dir plus a `t3code-modded` launcher.
- Logs: `/__t3mod/status.json` (loader log and per-mod status) and `~/.t3/userdata/logs/t3mod-launch.log` for the legacy launcher.
- Agent-specific memory (Claude's `~/.claude/projects/…/memory`) is **not** part of the repo; anything another agent needs must be in this file.
