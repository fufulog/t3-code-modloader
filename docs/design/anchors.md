# Anchors: what a mod depends on in T3, and how we check it

An **anchor** is a place in T3 a mod hooks into: a string in a client chunk, an export of a module in the main process, an element or global in the page. When a T3 update moves one, the mod should not misbehave. The Mods window says which mod is affected and which anchor is gone, and it works that out when the window opens.

Code: `src/main/anchors.cjs` (declarations and checks), `src/main/status.cjs` (the unified status), `src/core/client/probe.js` (the renderer probe), wiring in `src/main/loader.cjs` (`computeCatalog`, `applyStatuses`, `probeAnchors`), `src/main/failures.cjs` and `src/main/compat.cjs` (the other two inputs).

## Declaring anchors

A mod lists them in the `anchors` export of its `mod.cjs`. `mod.md` frontmatter is flat text and cannot hold regexes or checkers, so the declaration lives next to the patches; Commit Graph keeps its list in `anchors.cjs` and re-exports it.

```js
module.exports = {
  patches,
  anchors: [
    { name: "store-factory", kind: "patch", description: "right-panel store builds the surface" },
    { name: "diff-section", kind: "patch", fallback: "the built-in plain diff view" },
    { name: "ipc-handle", kind: "main-export", module: "electron", path: "ipcMain.handle", type: "function" },
    { name: "context-menu", kind: "renderer-global", path: "desktopBridge.showContextMenu", type: "function", fallback: "right-click menus do nothing" },
  ],
  main,
};
```

Common fields: `name` (required, lowercase letters, digits, `.` `-` `_`, unique within the mod, shown to the user), `kind` (required), `description`, `optional: true`, `fallback: "text"` (a documented fallback; implies `optional`). Anything wrong with a declaration (bad name, unknown kind, duplicate, bad field) becomes an anchor with state `unknown` and the reason, never an exception and never a false "missing".

| kind | phase | extra fields | present when |
| --- | --- | --- | --- |
| `patch` | static | `patch` (a patch id, default: the anchor's name) | that patch still applies to T3's chunk (the check `verifyMods` already ran) |
| `chunk` | static | `file` (RegExp on chunk file names), `contains` (string or RegExp), `min` (default 1), `max` | at least one chunk matches `file` and `contains` occurs between `min` and `max` times in total |
| `main-export` | static | `module` (`"electron"` or a node built-in), `path` (dotted), `type` (`any` default, `function`, `object`, ...) | the export exists with that type, read in the main process |
| `check` | static | `check({ require, chunkNames, readChunk })` returning `true`, `false`, or `{ ok, reason }` | the mod's own function says so (runs in the main process, where the mod already runs) |
| `renderer-selector` | runtime | `selector` (CSS, max 200 chars), `min` (default 1), `max` | the selector matches between `min` and `max` elements in T3's page |
| `renderer-global` | runtime | `path` (dotted, under `window`), `type` | the path exists and has the type |
| `renderer-reported` | runtime | none | never checked from outside; documents a dependency only the mod can see (see below) |

**Patches are anchors.** Every patch in `patches` is an anchor even if the mod declares nothing: it shows up under its patch id (`optional` follows the patch). Declaring `{ kind: "patch", patch: id }` only adds a description or a fallback note; it cannot make an optional patch blocking.

**Required vs optional.** A *missing required* anchor means the mod does not inject. A missing *optional* anchor (any with a `fallback`, or `optional: true`, or an optional patch) leaves the mod injected: it runs its own documented fallback, as Commit Graph falls back to its plain diff view.

## Results

`checkStatic(mod, ctx)` returns one result per anchor, in declaration order:

```
{ name, kind, phase: "static"|"runtime", state: "present"|"missing"|"unknown",
  reason?, optional, fallback?, description? }
```

- `present`: found.
- `missing`: **definitely** gone (this is the only state that ever affects a mod).
- `unknown`: could not be checked. Runtime anchors before they are probed, `renderer-reported`, a checker that threw, an invalid declaration, `require("electron")` failing. Shown as "not verifiable", never blocks.

Nothing in `anchors.cjs` throws; the tests feed it garbage and hostile objects.

## What can and cannot be checked without injecting

"Injecting" means patching a chunk, registering a handler, or putting anything into the page. Nothing below does.

| anchor | checked how | needs injection? |
| --- | --- | --- |
| `patch` (chunk code the mod rewrites) | the patch is applied to the chunk's source in memory (dry run); the result is thrown away | no, static |
| `chunk` | the chunk files in T3's client directory are read and searched | no, static |
| `main-export` | `require(module)` and read the property chain in the main process | no, static (built-ins and `electron` only; reading may run a getter of that built-in, never a function) |
| `check` | the mod's function, in the main process | no, static |
| `renderer-global` | the probe, in the Mods window's own page | runtime only: the page must be loaded, but nothing is injected |
| `renderer-selector` | the probe | runtime only, same |
| `renderer-reported` (React props the chat view passes into the surface, state that only exists while rendering, behaviour of a T3 component given our props) | cannot be checked from outside | runtime only, and not even probeable: a prop is only visible inside the render that receives it |

Not statically checkable, by construction: anything a T3 chunk computes at run time, the *shape* of React props, and whether a T3 component still accepts the props a mod gives it. A patch anchor proves the *insertion point* exists, not that what runs there still behaves. These stay `unknown` and the mod's own code must keep its fallback paths (Commit Graph's `loadT3Diff` returns `null` and the plain diff takes over).

Limits worth knowing:

- **Only enabled mods are checked.** Reading `patches` and `anchors` means running the mod's `mod.cjs`, which the loader will not do until the user has loaded the mod (mods run with full access in the main process). A mod under *Available* shows no anchor status. If that turns out to matter, a purely declarative `anchors.json` could be read without running code.
- **A runtime anchor is checked each time the window opens.** Until the first open after T3 starts, a mod with a gone runtime anchor still injects. Once the probe reports it, the main side is undone immediately (`unloadMod`, the same disposal as for a failure); renderer code already patched into the page only goes away at the next reload, and the loader never reloads by itself.

## The safe probe

`createProbe({ document, window }).run(specs)` takes plain-data specs (the loader builds them with `runtimeSpecs`; no functions or regexes cross the IPC boundary) and returns `{ [name]: { state, reason? } }`.

What it does: `document.querySelectorAll(selector).length` for selectors, and a walk of `Object.getOwnPropertyDescriptor` along the prototype chain for window paths.

What it never does: write to any object, create, move or listen on nodes, dispatch events, call a function it finds (`desktopBridge.showContextMenu` is looked up, never called), run a getter (an accessor at the end of a path counts as present when no type was asked for, otherwise `unknown`; in the middle of a path it is `unknown`), `import()` a module, or load a script. Paths must match a dotted-identifier pattern (no brackets, calls or `__proto__` tricks beyond plain identifiers), selectors are capped at 200 characters, at most 64 specs run per call, and every spec is wrapped so a hostile page yields `unknown`, not an exception.

`test/probe.test.mjs` proves it against a page stub that logs every read and throws on every write.

The loader treats probe output as untrusted (`sanitizeProbe`): only anchors it asked for, only the three valid states, reasons clipped.

## One status per mod

`computeStatus({ anchors, declaredIncompatible, injectionFailure })` in `src/main/status.cjs` gives the state the Mods window shows. States and **precedence** (first that holds wins; the others are listed in `also`):

1. `incompatible`: the mod declares it does not support this T3. It is not injected.
2. `failed`: injection was tried and failed (with the reason; everything the mod registered was undone). The mod is not active.
3. `anchors-missing`: one or more anchors gone, named in `missing`. `injects` is `false` if any is required, `true` if every missing one has a fallback.
4. `compatible`.

Reasoning: a declaration is the author's explicit word and prevents injection, so older probe or failure data must not hide it. A failure is a concrete event with a reason, which beats an inference from anchors. Anchors come last because they are the only source that can be partial (`unknown` is never `missing`).

The result also carries `checked` (anchors were evaluated; false for a mod that is not loaded), `reason` (one line), `missing`, `unverified` (the `unknown` ones) and `present` (a count). The Mods window shows a tag per state, lists the missing anchors with their reasons and fallbacks, and lists the unverifiable ones in a muted line.

### Where the three inputs come from

There is one computation, `computeCatalog` in `src/main/loader.cjs`, which calls `computeStatus` for every enabled user mod and builds both `s.status` (which mods inject, served as `status.json`) and the Mods window catalog from the result. It runs after every scan, after the window reports its probe results, and when a mod fails, so nothing else decides whether a mod is active.

- `declaredIncompatible` is the compatibility manifest's verdict (`src/main/compat.cjs`), computed once when the mod is loaded and kept as `entry.compat`; `inputsFor` in `status.cjs` only reshapes it (`{ reason }`, e.g. `Not compatible with T3 2.x`). The T3 version is read once, lazily, by the loader (`t3VersionOf`) for that check, so `status.cjs` needs no version of its own. An incompatible mod's code is never loaded, so it has no anchors to check.
- `injectionFailure` is the mod's record in `src/main/failures.cjs` (`{ phase, reason, at }`, phase `load`, `main` or `renderer`). Its `reason` line is `main setup failed: <why>`. `load` and `main` failures are re-derived on every scan (the mod is tried again); a `renderer` failure is kept until the mod is loaded or unloaded again. A failed mod stays out: `injects` is `false`, the probe and later scans cannot bring it back, and its main-process side was already undone by `unloadMod`.
- A runtime anchor reported gone by the probe takes the mod's main side away through the same `unloadMod` (its scope is disposed: handlers, listeners, timers, windows), not through a separate release path.

With no user mod enabled nothing is evaluated: `status.cjs`, `anchors.cjs` and `failures.cjs` are not even loaded (the zero-cost gate), and the catalog's `status` is `null` for the built-in core and for mods that are not enabled.

## Commit Graph's anchors

See `mods/commit-graph/anchors.cjs`: its 11 patches (9 required, 2 optional with the plain-diff fallback), two required main-process exports (`electron.ipcMain.handle`, `.removeHandler`), one optional runtime global (`desktopBridge.showContextMenu`, fallback: right-click menus do nothing), and `surface-props` (reported only).
