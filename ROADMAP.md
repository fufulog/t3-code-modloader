# Roadmap

What we want to build next, in rough priority order. Tick items off as they land and link the commit or PR.

Status: `[ ]` planned · `[~]` in progress · `[x]` done · `[?]` needs research before we commit to a design

## Ground rules

- **Features only, no borrowed code.** Ideas here come from reading what other T3 projects say they do. We write everything ourselves from the feature description and do not read their source while implementing, so there are no licence questions.
- **Never interrupt the user.** Injection and re-apply must not close, restart or freeze a running T3 or kill an agent run.
- **Zero cost with no mods.** With nothing installed or enabled, the loader adds no work to T3. Enforced by a pre-push and CI test (see section 6), not by good intentions.
- **Fail open.** If anything goes wrong, T3 starts unmodified. A broken mod never takes down T3 or other mods.
- **Reversible.** Every change the loader makes to disk is recorded and can be undone.
- **A tiny test mod per capability.** Each new mod API ships with a fixture mod that uses it and a test that proves it.

## 1. Surviving T3 updates, per platform

The goal is that after T3 updates itself, mods are back without the user doing anything and without a restart they did not choose.

| Platform | Approach | Status |
| --- | --- | --- |
| Linux (incl. Omarchy) | Updating T3 kept the modloader and mods. Confirmed by the owner on Omarchy, 2026-11-08. No watcher needed. | `[x]` done |
| macOS | Probably possible without a standing watcher by hooking the update step like on Linux. Needs research into how the macOS updater swaps the app, code signing, and quarantine. | `[?]` |
| Windows | Needs a watcher. See below. | `[?]` |

### Windows watcher: things to settle first

- **Mechanism.** Per-user scheduled task at logon, startup entry, or a tiny background process. Must work without admin rights.
- **Detect an update.** Watch for the install directory or its entry archive changing, not a fixed path. Handle both per-user and machine-wide installs, and stable and nightly channels.
- **Never interrupt.** Prefer the live injector (no restart) when T3 is running. When T3 is not running, patch directly. Never close T3. If the only option is a restart, ask the user and wait until no agent run is active.
- **Architectures.** x64 and arm64 at least. Do not hard-code install paths.
- **Retry and logging.** Retry failures after a delay, log every attempt, stop after a limit rather than looping.
- **Opt out.** One command to remove the watcher and one setting to disable it.
- **Report.** Optional note in the Mods window of when mods were last re-applied and whether it worked.

## 2. Compatibility and safety

How these three fit together: a mod's state in the Mods window is worked out when the window opens, from three sources. The first is what the mod declares (known-incompatible versions), the second is a check of whether the mod's anchors still exist in the running T3, and the third is whether injection failed. One status, one place.

- [ ] **Compatibility manifest: assume compatible, declare incompatible.** A mod is treated as compatible with every T3 version unless it says otherwise. The manifest lists only known-bad versions, segmented by T3 major version (e.g. "not compatible with 2.x"). We do not make mod authors list every version they tested.
  - Open: exact manifest field and range syntax (major only, or major plus optional minor/patch exclusions).
- [ ] **Failure to inject, with full cleanup.** The simplest and most important failure: a mod could not be injected. Anything that mod already injected must be undone, so a failed mod leaves T3 exactly as if it had never been loaded.
  - Treat each mod's injection as a transaction. Everything it registers (listeners, patched functions, DOM, styles, IPC handlers) records how to undo itself. On failure, undo in reverse order.
  - Other mods and T3 keep running. The failed mod shows as failed in the list, with the reason.
  - Open: how to guarantee cleanup for things a mod does by hand, outside our registration helpers. Likely a rule that mods may only change T3 through the helpers, plus a test mod that fails halfway at each stage.
- [ ] **Anchor-miss detection, evaluated when the Mods window opens.** A mod declares the anchors it depends on in T3 (the places it hooks into). When the window opens, the loader checks them against the running T3 and marks the mod compatible or "anchors missing", naming which anchor is gone. This is the higher-level version of failure handling: the user sees a mod is broken by an update before it misbehaves.
  - A mod with missing anchors does not inject (or falls back where it supports that, like Commit Graph's plain diff), and the Mods window explains what changed.
  - Open: which anchors can be checked without injecting (static checks on the entry file and bundle) and which only exist at runtime (renderer DOM and React props). Runtime-only anchors may need a safe dry run.
- [ ] **Capability list.** Each mod declares what it touches (main process, renderer, network, files, git, running commands). The Mods window shows it before the mod is enabled.
- [ ] **Upstream drift check.** *(Deferred until we have users.)* A scheduled job that tries our anchors against the newest T3 nightly and reports which mods would break.

## 3. Mod management

- [ ] **Per-mod settings.** Mods declare their options (names, types, defaults). The Mods window renders a form. Values are stored in our own config, never inside T3's, so a T3 update cannot wipe them.
- [ ] **Install from a git URL.** Paste a repository link, install the newest release tag, never run build or install scripts.
- [ ] **Update checks.** Daily check for newer mod releases with a manual "Check now" and clear update controls.
- [ ] **Agent-assisted install.** A copy-paste prompt and an AGENTS.md install section so a T3 agent can set up the loader.

## 4. Mod API: extension points

Check which of these mods can already do, then fill the gaps. Prefer a small registry per surface over special cases, and keep each one free when unused.

- [ ] Read-only access to T3's own data from a mod (threads, projects, scheduled tasks) over the app's existing connection
- [ ] Sidebar sections and badges
- [ ] Command palette entries
- [ ] Keybindings
- [ ] Composer commands
- [ ] Custom renderers for timeline items
- [ ] Banners and toasts
- [ ] Themes and CSS
- [ ] Scheduled work from a mod
- [ ] Hooks on agent turns (before and after)

## 5. Platforms

- [ ] **Windows install support.** Find T3 from its installer entry, handle stable and nightly builds, and deal with the single-instance rule (the user has to quit T3 first, or we inject live). Our Windows paths are written but untested.
- [ ] **macOS install support.** Same, plus signing and quarantine. Currently untested.
- [ ] Verify Linux unpacked and AppImage installs on both x64 and arm64.

## 6. Quality

- [ ] **Zero-cost-with-no-mods gate (must have).** A test that fails if the loader does any work when no mods are installed or enabled. It runs as a pre-push check and the same test runs in CI, so a regression cannot be pushed.
  - Test the structure, not just the clock: with no mods, nothing is injected, no listeners, timers, watchers or IPC handlers are registered, and the inspector is never opened. Startup time is noisy, so use it only as a loose budget on top.
  - It should run against a stub T3, so the pre-push hook works on any machine without a T3 install.
  - Open: how the pre-push hook is installed for a fresh clone (a script, or a tracked hooks directory).
- [ ] Simulated-update test for each platform path so we do not need a real T3 update to test re-apply.
- [ ] CI runs the test suite on every push.

## Ideas, not committed

- Per-mod sandboxed UI frames for mods that render untrusted content
- Signed or checksummed mod releases
- A public gallery of mods
