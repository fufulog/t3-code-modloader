---
name: t3-create-mod
description: Create a mod for the T3 Code modloader in this repo (mod.md manifest, patches.cjs chunk anchors, main-process IPC, client runtime and CSS). Use when asked to make, add, scaffold, port or debug a T3 mod, a T3 Code UI change or extension, or anything under mods/.
---

# Create a T3 mod

A mod is a folder in `mods/` (or the same folder zipped: `.zip` / `.t3mod`). Read the README sections "How mods work" and "Writing a mod" first if you have not. All UI must follow [t3-mod-styleguide](../t3-mod-styleguide/SKILL.md); read it before writing any markup or CSS.

## Layout

```
mods/<id>/
  mod.md       frontmatter (id, name, version, author, description) + markdown shown in the Mods window
  mod.cjs      module.exports = { patches, main }   (both optional)
  patches.cjs  chunk rewrites (required by mod.cjs when the mod changes T3's UI)
  client/      runtime.js, style.css, assets: served at /__t3mod/<id>/...
```

`id` is lowercase letters, digits and dashes. `mod.cjs` may `require` node built-ins, `electron` and its own relative files, never npm packages (bundle them into a file).

Optional frontmatter field `incompatible-t3-majors: 2, 3` lists T3 major versions the mod is known NOT to work with (also `[2, 3]` or a single `2`). Leave it out by default: a mod is assumed compatible with every T3 version. Add it only once you know a major breaks the mod; the loader then keeps the mod off on that major and the Mods window says "Not compatible with T3 2.x". A malformed value is ignored (fails open).

## Workflow

1. Decide the parts: UI inside T3 (patches + client runtime), privileged work (main + IPC), or both. Keep the mod as small as the feature.
2. Scaffold the folder and write `mod.md`. The body is the user's preview, so say what it does and what it changes in T3.
3. **Patches.** Each entry is `{ id, file: /^chunk-[\w-]+\.js$/, apply(src) => src }`. Rules:
   - `file` matches a chunk's base name and must match exactly one chunk.
   - Anchor on string literals T3 itself uses (labels, kinds). Capture minified identifiers with regex groups; never hard-code them.
   - Each anchor matches exactly once. Throw otherwise; the loader then disables the whole mod and T3 runs unmodified, which is the intended failure mode after a T3 update.
   - Prepend `import "/__t3mod/<id>/runtime.js";` once (check `includes` so a second pass is a no-op).
   - Copy `replaceOnce` and `jsxAlias` from `mods/commit-graph/patches.cjs`.
   Find anchors by extracting the client: `npx @electron/asar extract <app.asar> out`, then grep `out/apps/server/dist/client/assets`.
4. **Runtime** (`client/runtime.js`, an ES module): `const NS = (globalThis.__t3mod ??= {}); if (!NS.<id>) { ... }` so a second import does nothing. Load the stylesheet with a `<link>` built from `import.meta.url`. Prefer plain DOM in one host element over depending on T3's React internals. Prefix every CSS class with a short mod-specific prefix.
5. **Main** (`main({ electron, ipcMain, log, isTrustedSender, loader })`): register one handler on `t3mod:<id>:<name>` (the preload only allows `^t3mod:[a-z0-9-]+:[a-zA-Z0-9-]+$`). Always check `isTrustedSender(event)`, switch over a fixed list of ops, validate every field, never build shell strings from input, and reply `{ ok: true, data }` or `{ ok: false, error }`. The renderer calls `window.t3mod.invoke(channel, payload)`. Handlers are released when the mod unloads.
6. **Verify live**, then test:
   - `node bin/t3mod-inject.mjs` hot-loads the repo into the running T3 and reloads the window. Never kill or restart T3 to test.
   - Drive the UI through `--eval-only FILE` (main-process script using `webContents.executeJavaScript` and `capturePage`) and look at a screenshot.
   - `node test/patches.test.mjs <client dir>` checks every anchor and the syntax of each patched chunk. Add unit tests for any logic in `main` (see `test/git.test.mjs`); run `npm test`.
7. Test lifecycle in the Mods window: Rescan, stage Load, Confirm, Unload. A new mod starts under Available by design. Remove any throwaway test mod and restore `~/.config/t3-modloader/config.json` afterwards.
8. Package with `node bin/t3mod-pack.mjs mods/<id>` if it should ship as a zip. Commit each verified change (`feat(<id>): ...`); never push unasked.

## Rules of thumb

- A mod runs with full main-process access: keep IPC narrow, whitelisted and validated.
- Unloading must leave T3 as it was. Keep state in the renderer or in files you own.
- Change only what the feature needs; do not alter T3's existing behaviour for people who never open the mod.
