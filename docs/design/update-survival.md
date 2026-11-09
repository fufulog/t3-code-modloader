# Surviving T3 updates on Windows and macOS

Status: design only, nothing here is implemented. Written 2026-11-08 against ROADMAP.md section 1 ("Surviving T3 updates, per platform") and section 5 (platform install support).

Goal, from the roadmap: after T3 updates itself, mods are back without the user doing anything and without a restart they did not choose. Ground rules that bind this design: never interrupt a running T3, zero cost with no mods, fail open, everything reversible, every new capability gets a fixture and a test.

How to read the evidence. Each platform claim is tagged:

- **[doc]** stated by an official Electron / electron-builder / Squirrel / Microsoft / Node / Apple page that was read for this document (sources at the end).
- **[repo]** read in this repository.
- **[unverified]** from memory, inferred, or the official page was silent or unreachable. Nothing tagged this way should be built on before the matching spike in section 8 has been run on a real machine.

## 1. Summary of conclusions

1. **Windows needs the watcher, and it should be a small resident Node process started from the per-user `HKCU\...\Run` key.** No admin rights, trivially reversible, one line in `install.json`. A scheduled task is the alternative, but whether a standard user can create a logon task is not settled by Microsoft's pages, and it cannot do the job a resident process does (see 3.1).
2. **The patched `app.asar` can never be replaced under a running T3, on any platform.** `replaceFile` re-lays out the archive (new header, shifted data start), and Electron reads the archive lazily by offset. So "T3 is running" always means: do not touch the file. Use live injection now, and patch the file after T3 exits.
3. **macOS probably does not need a standing watcher.** An update there is observable in-process through the documented `autoUpdater` event `before-quit-for-update`. The loader can start a short-lived helper at that moment. A launchd agent is an optional safety net, not the base. But macOS has a bigger problem than updates: patching `app.asar` inside the signed bundle breaks the code-signature seal, and three things depend on that (Gatekeeper first launch, Squirrel.Mac validation, the "App Management" permission). Those need a spike before the in-place patch is trusted there.
4. **One platform-neutral core does the work on all platforms** (`fingerprint`, `detect`, `decide`, `reapply`, `report`), with the OS-specific parts behind injected dependencies. A simulated update is just "swap the synthetic asar for a v2 one and call `tick()`", so every decision path runs on Linux CI without a real T3 update.
5. **Existing code has a reversibility hazard that must be fixed first.** After a Windows/macOS update, the stale `app.asar.t3mod-backup` and the `asar` change in `install.json` describe the OLD version. Today `uninstall()` would rename that old backup over the NEW app.asar. See 2.3.

## 2. What exists today and what carries over

### 2.1 The Linux mechanism (confirmed working by the owner, not redesigned here)

**[repo]** Linux AppImage survival is three pieces working together:

- The installer never modifies the AppImage. It extracts a patched copy (`prepareTree`, `src/install/install.cjs`) and writes a launcher plus desktop-entry rewrites, all recorded in `install.json`.
- The bootstrap block `/*t3mod:begin*/…/*t3mod:end*/` in the entry file loads the loader (`cold()`). `cold()` wraps `child_process.spawn` (`relaunchThroughLauncher`, `src/main/loader.cjs`) so when T3's updater spawns the new `*.AppImage`, it is routed through the launcher, which patches the new version on its first start.
- Uninstall walks `install.json` newest first and restores each change.

The spawn reroute works because T3's Linux updater is in-process JavaScript calling `child_process.spawn`. The `APPIMAGE_EXIT_AFTER_INSTALL` env check and the `~/.cache/t3code-updater/pending` path in the repo are the shape of electron-updater's AppImage updater, so T3 appears to use electron-updater **[repo, inferred; confirm with `resources/app-update.yml` of a real Windows/macOS build]**.

### 2.2 What carries over to dir installs (Windows, macOS, unpacked Linux)

| Piece | Carries over? | Notes |
| --- | --- | --- |
| `install.json` change log, reverse-order uninstall | Yes, extended | New change types and fields in 4.7. |
| Marker block + `inject`/`strip`/`isPatched` | Yes, unchanged | `isPatched(asar) === false` is the cheapest "an update replaced the file" signal. |
| `readFuses` / `--force` refusal | Yes, but must run on every re-apply, on the NEW executable | A fuse can flip between T3 versions. Auto re-apply never uses force. |
| `targets.findTargets` / `resolveTarget` | Yes | Already searches `%LOCALAPPDATA%\Programs`, `ProgramFiles`, `.app` bundles. Re-used for re-discovery. |
| Spawn reroute (`relaunchThroughLauncher`) | Windows: possible but not needed. macOS: not applicable | See 3.7 and 5.3. |
| Launcher, patched tree, desktop entries, `prepare` | No | AppImage-specific. The tree idea is the template for the "copy mode" fallback in 3.8. |

Note: the README says unpacked **Linux** installs "need the installer run again after a T3 update". The Linux status "done" in the roadmap covers AppImage. The neutral core below fixes unpacked Linux for free (a manual `reapply` command first, a watcher only if wanted).

### 2.3 The stale-backup hazard (fix before anything else)

**[repo]** A dir install records `{ type: "asar", asar, backup, entry }` and keeps the original as `app.asar.t3mod-backup`. After T3 updates:

- `app.asar` is the new, pristine file (the installer overwrote our patched one). **[unverified]** The electron-builder pages read for this document do not say whether the NSIS installer replaces the whole install directory or deletes stray files, so the old `.t3mod-backup` may or may not survive.
- If it survives, `uninstall()` hits `fs.existsSync(c.backup)` and runs `renameSync(c.backup, c.asar)`, putting the OLD version's app.asar over the NEW app, which would leave T3 broken.
- `install()` throws if the backup exists ("move it away first"), so naive re-install fails too.

Required change, independent of the watcher: each `asar` change records `version`, `originalSha256` (of the backup), and `patchedHeaderSha256`. Uninstall restores the backup only if `sha256(backup)` equals the recorded value AND the live `app.asar` is the patched file we wrote (header hash match). Otherwise it strips the marker from the live archive (the code path `uninstall` already has for "no backup found"). Re-apply replaces the stale backup with the new original (4.4).

## 3. Windows

### 3.1 Mechanism decision

Options from the roadmap, assessed:

| Option | No admin | Detects a relaunched T3 and live-injects | Flash of console window | Verdict |
| --- | --- | --- | --- | --- |
| Per-user scheduled task at logon | **[unverified]**. Microsoft's `schtasks /create` page says `/ru` defaults to the current user and `/rl` defaults to LIMITED, but also "Only Administrators can schedule tasks, regardless of the value of the /ru parameter" (in its SYSTEM-account section; it is not stated whether this applies to a logon task for yourself). The Task Scheduler logon-trigger sample registers under `Builtin\Administrators` **[doc]**. | Only as a repeating task (a process spawn per interval), or one shot at logon, which misses a T3 that relaunches mid-session | A console-subsystem `node.exe` in a task shows a window unless hidden **[unverified]** | Keep as an owner option, not the default. |
| Startup folder shortcut | Yes | Same as Run key | Same | Needs `.lnk` creation (COM or PowerShell). More moving parts than a registry value. |
| **HKCU `Run` value** | HKCU is the per-user hive; the page says the keys "can be set for the user or the machine" and notes admin only for HKLM RunOnce **[doc]**; admin-free for HKCU is therefore expected but not stated **[unverified]** | Yes, if the started process stays resident | Brief; mitigated in 3.1.2 | **Chosen.** |
| Resident process, however it is started | Yes | Yes | None after start | The runtime shape of the chosen option. |

Why resident rather than a logon-only sweep: after an in-app update, electron-updater (**[doc]**: "the updater spawns the installer as a detached process while the app is exiting"; `onNextLaunch` "installs silently and restarts the app") starts the NEW T3 within seconds. That T3 is unpatched and already running, so the only way to give the user mods without a restart is live injection into a process that did not exist a moment ago. Something must be alive to notice it. A once-at-logon task cannot. A repeating task can, at the cost of spawning a Node process every interval.

Cost: a Node process idle at an estimate of tens of MB **[unverified, measure in spike W6]**. This is the price of "no restart, no user action". To honour "zero cost with no mods", the watcher exits at start when no mod is enabled in `config.json`, and `loaderApi.setEnabledMany` (and the install/uninstall commands) call `watch.sync()` to start or stop it, so enabling the first mod starts it.

#### 3.1.1 Details of the Run entry

- Value name `t3mod-watch` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Written and removed with `reg.exe` (no dependencies). Command: `"<node.exe>" "<LOCALAPPDATA>\t3-modloader\watch.mjs"`.
- The page limits the command to 260 characters **[doc]**, so the entry points at a tiny shim in the local data dir that `import()`s the real `bin/t3mod-watch.mjs` by absolute path. Install checks the length and fails with a clear message if it is over.
- `node.exe` is recorded as an absolute path at install time (the installer already runs under Node 22+, `process.execPath`). The watcher re-validates it at each logon; if it vanished the entry is inert, logs once, and `status` says so. T3 is unaffected (fail open).
- Per-user: HKCU only. The design never writes HKLM, never self-elevates.

#### 3.1.2 No console flash

`node.exe` is a console program, so starting it from `Run` can flash a window **[unverified]**. Mitigation: stage one of `watch.mjs` immediately re-spawns itself with `detached: true, windowsHide: true` (both documented `child_process` options) and exits. If the flash still shows in spike W4, fall back to `powershell.exe -WindowStyle Hidden` as the launcher. VBScript hosts are not used (their deprecation is a risk; **[unverified]** here).

#### 3.1.3 Single instance and state location

- A lock file `watch.lock` (create with `wx`, holds pid and start time) guarantees one watcher. Stale detection: pid is dead or start time does not match.
- Everything the watcher writes (lock, state, logs, shim) goes in `%LOCALAPPDATA%\t3-modloader` (`paths.dataDir()`), not `%APPDATA%`. `paths.configDir()` on Windows is the **roaming** profile; locks, logs and absolute local paths do not belong in a profile that can sync to another machine. `install.json` stays where it is today (it already holds machine-specific paths; flagged as an open question, 7.9).

### 3.2 Detecting an update

The watcher does not care how the update arrived (in-app updater, a setup.exe run by hand, a repair). It compares state, so it needs no knowledge of the installer's internals.

**Fingerprint** of an install (pure function of the files, `src/survive/fingerprint.cjs`):

```
{ asarPath, size, mtimeMs,
  headerSha256,        // hash of the asar header JSON; small read, changes whenever any file in the archive changes
  appVersion,          // package.json inside the asar (existing targets.appInfo)
  marked,              // isPatched(asar): our block present in the entry
  exeSha?: skipped }   // not needed
```

`install.json` stores, per asar change, `applied = { version, patchedHeaderSha256 }` written when we last patched.

**Detection verdict** (`detect(applied, current)`):

| Verdict | Condition | Meaning |
| --- | --- | --- |
| `ok` | `marked` and `headerSha256 == applied.patchedHeaderSha256` | Our patch is in place. Nothing to do. |
| `updated` | not `marked` and `appVersion != applied.version` | An update replaced the file. Re-apply. |
| `reverted` | not `marked` and same version | Reinstall/repair/AV restore. Re-apply, log the odd cause. |
| `foreign` | `marked` but header hash differs | Someone else changed an archive carrying our block. Do not touch; report. |
| `missing` | asar gone | Moved or uninstalled. Re-discover (below); else give up with a report. |

**No hard-coded paths.** The target is the asar path recorded at install. If it is missing the watcher calls `findTargets()` and accepts a candidate only if it matches the recorded identity (product name from the executable name, channel, same scope). Extra hint source: the Windows uninstall registry keys. electron-builder registers the uninstall entry under `Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>` **[doc]**; which hive depends on per-user vs per-machine and whether an `InstallLocation` value is written by default are **not stated [doc]**. So `reg query` over HKCU and HKLM for a `DisplayName` matching `/t3[\s_-]*code/i` is added to `findTargets` as a best-effort hint (spike W5), never as the only source.

**Per-user vs machine-wide.** electron-builder's `perMachine` defaults to false, but an assisted installer lets the user choose and per-machine updates need UAC **[doc]**. The watcher handles scope with one rule: *write probe*. It tries to create a temp file next to `app.asar`. If that fails with EACCES/EPERM the verdict is `needs-admin`: the watcher reports it and does nothing else. It never elevates. Machine-wide installs therefore do not get automatic re-apply unless the owner picks copy mode (3.8).

**Stable vs nightly.** **[unverified]** whether T3's nightly is a separate application (own install directory and uninstall key) or the same app on another update channel. electron-builder infers a channel from the version's pre-release part (`0.12.1-alpha.1` is `alpha`) but the channel mechanism is not documented on the pages read **[doc, not stated]**. The design works for both: if separate apps, each is its own asar change in `install.json` and the watcher loops over all of them; if the same app, it is just a version change. This requires `install` to accept several dir targets (open question 7.6).

**x64 and arm64.** Nothing patched is architecture-dependent: the unit is `app.asar`, which is JavaScript. The architecture only matters for (a) finding the right executable name, (b) `readFuses` which scans for a sentinel and is arch-neutral, (c) which `node.exe` runs the watcher (an x64 Node under emulation on arm64 Windows is fine for this). electron-builder says a single installer installs "the appropriate arch" automatically, with install paths "not stated" **[doc]**, so the design never derives a path from the architecture.

**When is the update "finished"?** NSIS writes many files over seconds. The watcher acts only when the fingerprint is stable across two checks at least 5 s apart AND the asar passes a structural check (header parses; `dataStart + max(offset+size)` equals the file size; `package.json` readable) AND the exe can be opened. A half-written archive fails the structural check and is simply re-examined next tick; this does not count as an attempt.

**Cost of watching.** One tick = a few `stat` calls and one small header read, every 30 s while idle (60 s after a quiet hour). `fs.watch` is deliberately not used for detection: its own page says it is "not 100% consistent across platforms" and unreliable on network/virtual file systems **[doc]**. On Windows it is implemented by watching a directory, so replacing a file reports on the new file, which would also work, but polling is simpler to test and has no failure modes.

### 3.3 Re-apply without ever closing T3

Decision table (`decide`, a pure function; inputs: verdict, `running`, `liveAvailable`, `attempts`, policy):

| T3 running? | Live inject available? | Action |
| --- | --- | --- |
| No | n/a | **Direct patch** (3.3.1). Next start has mods. |
| Yes | Yes | **Live inject now** (mods active this session, nothing on disk changes), then **queue the direct patch** for the first moment T3 is not running. |
| Yes | No | **Queue the direct patch** only. Mods return at T3's next natural start. Log it; no prompt. |
| Yes, and the fuse blocks disk patching | Yes | Live inject only, permanently (see 3.4). |
| Yes, and the fuse blocks disk patching | No | Nothing possible. Report. T3 runs unmodified. |

**Never restart.** Section 3.6 explains why a restart request is not part of the baseline.

#### 3.3.1 Direct patch (transactional)

1. Take `install.lock` (the same lock `uninstall` takes, so the two cannot interleave).
2. Re-run `isRunning` immediately before touching anything (race with the user launching T3).
3. Check fuses on the *current* executable. `EmbeddedAsarIntegrityValidation` on means stop.
4. Write the patched archive to `app.asar.t3mod-new` (existing `patchedAsar`), `chmod` to match.
5. Replace the stale backup with the pristine new file: `rename(app.asar, app.asar.t3mod-backup)` (overwrite of the stale one is explicit and logged), then `rename(new, app.asar)`. If the second rename fails, rename the backup back and delete the temp.
6. Record the new `applied` values in `install.json`, append to `history`, write `lastReapply`.

On Windows a rename onto or from an open file fails. That is used as an extra safety net, not the primary check: a sharing-violation error (EBUSY/EPERM/EACCES) is classified as `locked` and treated as "T3 is running", i.e. queue and retry later, not as a failed attempt.

#### 3.3.2 Is T3 running?

`isRunning(target)` has two implementations combined with OR:

- **Lock probe**: try `fs.openSync(exe, "r+")`. A running Windows executable cannot be opened for writing, so EBUSY/EPERM means running (or being installed). Cheap, no child process, no dependency.
- **Process list**: only needed when we want the PID (live injection). One PowerShell call (`Get-CimInstance Win32_Process` filtered by `ExecutablePath` equal to the recorded exe). The main process is the one without `--type=`. `wmic` is not used (I believe it is being removed from newer Windows **[unverified]**).

#### 3.3.3 Live injection on Windows: the open problem

**[repo]** `bin/t3mod-inject.mjs` is Linux-only today: `ps -eo`, `/proc/<pid>/status` for `SigCgt`, `ss` for the port, and `SIGUSR1` to open the inspector. Node's documentation says "`SIGUSR1` is not available on Windows" **[doc]** and `inspector.open()` can only be called by the process itself **[doc]**. The Electron fuse page says that with `EnableNodeCliInspectArguments` off, "`SIGUSR1` signal does not initialize the main process inspector" **[doc]**, and the roadmap/README state the fuse is on in T3 builds **[repo]**.

So there is **no documented way to open the inspector of an already-running Windows T3**. Candidate mechanisms, all **[unverified]**:

1. `process._debugProcess(pid)` from our Node. It is not in the Node docs read for this document (searched the process page; not found), so it is an undocumented API. If it works inside Electron it likely creates a remote thread in the target process, which security software may flag. Spike W2 decides whether it works at all, and the owner decides whether it is acceptable.
2. Having T3 started through our launcher (inspector via `--inspect-brk`, as `t3code-launch.mjs` does on Linux). Not usable after an update: the updater relaunches T3 itself, not through our launcher.
3. A named pipe or loopback listener created by an earlier loaded loader. Not usable: after an update there is no loader in the new process.

Consequence: until W2 passes, Windows delivers "mods return at T3's next start after it has been closed once" (the patch-at-exit path), which already needs no restart the user did not choose. If W2 passes, live injection is added and is strictly better. The code is arranged so the decision table above degrades correctly when `liveAvailable` is false.

The CDP half of the injector (WebSocket client, `evaluate`) is platform-neutral and moves to `src/inject/cdp.cjs`. Only `findMainPid`, `canOpenInspector` and `openInspector` get per-platform files (`posix.cjs`, `win32.cjs`).

### 3.4 When the asar-integrity fuse is on

**[doc]** `EnableEmbeddedAsarIntegrityValidation` is supported on macOS (Electron 16+) and on Windows (Electron 30+). It hashes the archive **header** (Info.plist `ElectronAsarIntegrity` on macOS, an `Integrity`/`ElectronAsar` resource on Windows); on any mismatch or missing hash "the app will forcefully terminate". The docs recommend enabling `OnlyLoadAppFromAsar` with it, since otherwise the check can be bypassed through the app search path.

Our patch rewrites the header, so a patched archive on a fuse-on build would kill T3 at start. Therefore:

- `reapply` checks the fuse on the new executable every time. On: refuse the disk patch, record `blocked: "asar-integrity-fuse"`, never force.
- Editing the embedded hash (the exe's resources / Info.plist) is rejected: it invalidates the code signature on both platforms and defeats the point of the fuse.
- Live injection does not touch disk, so it keeps working if the inspector fuse is still on. This is the main reason to make the Windows live-injection spike (W2) a priority.

### 3.5 Retry, backoff, give-up

- One attempt state per `(target, headerSha256)` of the file we want to fix, kept in `watch.state.json`.
- Failure classes:
  - `transient`: locked file, partial write, structural check failed, T3 started between the check and the rename, antivirus holding the file. Short inner retry (5 times, 1 s apart) inside the attempt, then counts as one failed attempt.
  - `permanent`: fuse blocks it, entry is not CommonJS, needs admin, header unparseable twice, `foreign`. No retries: record the reason and stop at once.
  - `waiting`: T3 running and no live path. Not a failure, not counted, no limit; costs one stat-level probe per tick.
- Backoff for transient failures: 30 s, 2 min, 10 min, 30 min, 2 h. That is 5 attempts; then `gave-up` is recorded for that fingerprint and the watcher stops trying for it. It tries again only when the fingerprint changes (another update), at the next logon (one attempt), or on a manual `t3mod-install.mjs reapply`.
- `nextDelay(attempts)` is a pure function, tested directly.

### 3.6 Restart: baseline is never

Roadmap: "If the only option is a restart, ask the user and wait until no agent run is active." Analysis:

- A restart is the only option when live injection is unavailable (inspector fuse off, or W2 fails) AND the user wants mods this session.
- In exactly that case there is no loader in the running T3, so the watcher has no in-app UI and cannot read T3's own state. It could show an operating-system notification, but no verified way for an out-of-process watcher to know "no agent run is active" exists. The honest signals available outside T3 (child processes of the provider CLIs, recent writes in the T3 data dir) are heuristics **[unverified]**.
- So the baseline is: no prompt, mods come back at the next natural start. A restart request is a later phase (6) and the code reserves its seam: `activity(): "idle" | "busy" | "unknown"`. Policy when built: ask only; act only on an explicit yes; wait for `idle` on two consecutive probes 30 s apart; `unknown` means never.
- The best long-term source for `activity()` is the roadmap item "read-only access to T3's own data" (section 4). It becomes available inside a live-injected T3, which is the case where no restart is needed anyway.

### 3.7 The in-process hook: considered, not chosen

The same `cp.spawn` wrap that reroutes the AppImage could also see the NSIS installer being spawned and start a helper. It is **not** chosen for Windows because: (a) it only covers in-app updates, not a setup.exe run by hand; (b) whether electron-updater's NSIS path goes through the patched `spawn` binding in T3's bundle is **[unverified]**; (c) the resident watcher already covers it, and the relaunched T3 still has to be noticed by something. It stays an option as a latency optimisation (hint file `update-pending.json` to make the watcher poll fast).

### 3.8 Per-machine installs: copy mode (option, not baseline)

If the owner wants machine-wide installs supported without admin, the Linux AppImage idea ports: copy the install directory to `%LOCALAPPDATA%\t3-modloader\t3code\<version>`, patch the copy, repoint the user's shortcuts. Costs: hundreds of MB per version **[unverified size]**, `.lnk` rewriting through COM/PowerShell, and the copy must be regenerated on every update of the original. Not recommended for phase 1.

### 3.9 Logging

- `%LOCALAPPDATA%\t3-modloader\logs\watch.log`, JSON lines `{ts, level, target, event, detail}`; rotate at 256 KB, keep 2 files. Idle ticks write nothing; an hourly heartbeat line is the only periodic write. Every state change, attempt, outcome, backoff step and give-up is logged.
- `lastReapply` (also in `install.json`): `{ at, ok, from, to, mode: "patch"|"live"|"patch+live"|"queued", error? }`.
- Never log environment, command lines beyond the recorded exe path, or file contents.

### 3.10 Opt-out and uninstall

- Command: `node bin/t3mod-install.mjs watch off | on | status`. `off` deletes the Run value, writes `watcher: false` to `config.json`, and asks a running watcher to exit by deleting its lock / writing `watch.stop` (never kills it).
- Setting: `config.json` key `"watcher": false`. The watcher re-reads it every tick, so flipping it by hand or from the Mods window stops it within a minute. It also stops if `install.json` disappears.
- Install asks once: "Keep mods working after T3 updates (adds a small background process at login)? [Y/n]" and defaults to yes on Windows. `--no-watch` skips the question.
- `uninstall()` removes the Run value first (before restoring any asar, so a late tick cannot re-patch), signals the watcher to stop and waits up to 5 s, takes `install.lock`, then continues in the existing reverse order. It deletes the shim, state, lock and logs last.

## 4. install.json changes (Windows and shared)

Schema `version: 2`; readers must accept `1` and treat missing fields as absent.

```jsonc
{
  "version": 2,
  "installedAt": "...",
  "repo": "...",
  "target": { ... },                      // primary target, unchanged
  "node": "C:\\Program Files\\nodejs\\node.exe",   // recorded for the watcher
  "watch": { "enabled": true, "kind": "run-key" },
  "lastReapply": { "at": "...", "ok": true, "from": "1.2.0", "to": "1.3.0", "mode": "patch", "error": null },
  "changes": [
    { "type": "asar", "asar": "...", "backup": "...", "entry": "...",
      "version": "1.3.0", "originalSha256": "...", "patchedHeaderSha256": "...",
      "history": [ { "at": "...", "from": "1.2.0", "to": "1.3.0", "mode": "patch" } ] },
    { "type": "watch-files", "files": [".../watch.mjs"] },
    { "type": "autostart", "platform": "win32",
      "key": "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "name": "t3mod-watch",
      "value": "<exact string written>", "previous": null }
  ]
}
```

Rules:

1. Re-apply **updates the existing `asar` change in place** (same path) and appends to its `history`. It does not append a second asar change, so uninstall has exactly one thing to undo per file.
2. `autostart` undo: delete the value only if it still equals `value`; restore `previous` if one was overwritten; otherwise leave it and report.
3. Ordering keeps uninstall safe: `autostart` is recorded after the files it points at, so reverse order removes the entry first.
4. State that changes often (`attempts`, `nextTryAt`, `gaveUp`) does **not** go in `install.json`; it lives in `watch.state.json` so the manifest is only rewritten when something durable changes.

## 5. macOS

### 5.1 What the official docs establish

**[doc]**

- Electron's built-in `autoUpdater` on macOS is Squirrel.Mac; the app **must be signed**: "Your application must be signed for automatic updates on macOS. This is a requirement of Squirrel.Mac." electron-updater uses Squirrel.Mac on macOS, requires the `zip` target, and also states that the app must be signed.
- Squirrel.Mac README: "When your application terminates, any downloaded update will be automatically installed." Electron: a downloaded update "will still be applied the next time the application starts". `quitAndInstall()` "will close all application windows first, and automatically call `app.quit()`". `before-quit-for-update` "is emitted after a user calls `quitAndInstall()`" (and `before-quit` is not).
- electron-builder: Squirrel.Mac "natively stages downloaded updates and applies them on relaunch".
- Fuse and integrity facts as in 3.4, with macOS support since Electron 16 and the hash in `Info.plist` `ElectronAsarIntegrity`.
- Apple: Gatekeeper "verifies that the software ... hasn't been altered" and requests approval before opening downloaded software the first time; a notarization ticket can be stapled "without invalidating the signature". Apple Platform Security does not say what the signature seals, and the Developer documentation pages on updating signed bundles and Hardened Runtime did not render in this session.
- launchd: user agents live in the user's `Library/LaunchAgents`, run only while that user is logged in, must be owned by the user and not group/world-writable; `WatchPaths` starts the job "whenever any of the paths being watched have changed"; jobs are skipped while the machine sleeps or is off (Apple archive docs, last updated 2016).

### 5.2 What the docs do NOT establish (all **[unverified]**)

- How ShipIt swaps the bundle. Neither Electron's pages nor Squirrel.Mac's README say how the bundle is replaced, whether the installed app's signature is validated, how write access is obtained, or anything about quarantine or Gatekeeper. One community source I could not treat as official states ShipIt checks the update against the *installed* app's designated requirement.
- Whether an `app.asar` edited inside a signed, notarized bundle still launches on Apple silicon, and whether Squirrel.Mac then still updates it.
- App translocation behaviour. Apple's pages read here do not document it; only forum answers from Apple DTS do, and they describe it as undocumented.
- The macOS "App Management" privacy permission (Ventura and later), which I believe stops one app from modifying another app's bundle unless the user grants it. The Apple support page could not be found in this session.

### 5.3 Is a standing watcher needed? Decision: no

The update is applied by Squirrel.Mac when T3 quits, and the in-process loader of the *old, patched* T3 can see it coming through a documented event:

1. The loader (already running in T3's main process) subscribes to `electron.autoUpdater.on("before-quit-for-update")` and to `app.on("will-quit")`. Electron's own `autoUpdater` exists on macOS whatever wrapper T3 uses, so this does not depend on how T3 calls it **[unverified for T3's wiring: spike M3]**.
2. On the event it spawns a **short-lived detached helper**: `node bin/t3mod-watch.mjs --after-update --wait-pid <T3 pid>`. The helper runs the same `tick()` loop as the Windows watcher, with the same retry/give-up rules, until the update is resolved.
3. What the helper does: wait for T3 to exit; wait for the bundle to settle (fingerprint stable, `Info.plist` version read, structural check); then `decide`:
   - T3 not running: patch the bundle (subject to 5.4) or, if that is not allowed, do nothing and wait for the relaunch.
   - T3 running (Squirrel.Mac relaunched it, which happens in the `quitAndInstall` case): **live inject**, since signals work on macOS (SIGUSR1 opens the inspector; `bin/t3mod-inject.mjs` needs `ps`, `lsof` and a fuse read from the binary instead of `/proc`/`ss`). Then queue the disk patch for the next quit through the injected loader's own `will-quit` handler, which spawns the helper again with `--after-exit`.
4. The helper exits after resolution or after the give-up limit. Between updates nothing runs.

**Gap**: an update not initiated from a patched running T3 (T3 closed, user installs a new copy from a disk image by hand) is not seen. Options, owner's choice (7.4): (a) accept it and re-run `t3mod-install.mjs reapply`; (b) opt-in LaunchAgent with `WatchPaths` on the bundle's `Contents/Info.plist` plus `RunAtLoad`, which calls `t3mod-watch --tick` and then exits. launchd calls it only on change, so there is no resident process. Default off to keep the base free of anything outside T3 and the repo. The archived docs read here do not document `RunAtLoad` or `ThrottleInterval` **[unverified; check `man launchd.plist`]**.

### 5.4 Signing, quarantine, translocation: what the design assumes

- **Patching `Contents/Resources/app.asar` changes a file inside the signed bundle.** Whether the signature seal covers it is not stated by the pages read, but code-signing practice says resources are sealed in `_CodeSignature/CodeResources` **[unverified]**. Consequences to test, none assumed:
  - Gatekeeper's first-launch assessment on a still-quarantined copy may report the app as damaged. After the user's first approved launch, a later edit may or may not matter.
  - Squirrel.Mac validates the *incoming* update; if it also validates the installed app, a broken seal could block the update (spike M2).
  - Ad-hoc re-signing after the patch is **rejected**: an ad-hoc signature pins one build's hash, so later releases cannot satisfy the installed app's requirement, which would break T3's own auto-update. This matches what the Electron docs say about unsigned/ad-hoc apps behaving inconsistently, but the exact Squirrel.Mac requirement check is not stated **[unverified]**.
- **Quarantine / translocation.** A downloaded app carries the quarantine attribute until first approval. If macOS runs it translocated, `process.execPath` and `app.getAppPath()` point at a randomised path **[doc, DTS]**. The installer, watcher and helper therefore only ever use the **recorded real bundle path** (never `process.execPath` or `getAppPath()` of a running T3) to find the file to patch, and the first re-apply refuses to run on a bundle that still carries the quarantine attribute (stop with a message: launch T3 once from Finder and approve it).
- **App Management.** A background node process writing into `/Applications/T3 Code.app` may be denied **[unverified]**. The design treats EPERM on that write as `permanent: needs-permission`, not as a transient failure, and falls back to live injection only. A launchd agent or helper has its own TCC identity separate from Terminal, so a permission granted when the user ran the installer in Terminal would not carry over **[unverified]**.
- **Integrity fuse.** As in 3.4. If it ever turns on in a macOS build, disk patching is off for good and live injection is the only route.

### 5.5 Recommendation for macOS

1. First, run spikes M1 to M4 on a real Mac. The result decides between:
   - **Plan A (in-place patch + hook helper)**: if the patched bundle launches and Squirrel.Mac still updates it. Same behaviour as Windows, plus the hook instead of a resident process.
   - **Plan B (bundle untouched)**: if the seal break causes any problem. Run T3 through an inspector launcher (`bin/t3code-launch.mjs` already does this for AppImage; it needs a macOS port) and live-inject after updates. No bundle writes, so signing, quarantine, translocation and App Management stop mattering. The cost is that starting T3 from the Dock bypasses mods unless the user starts it through our launcher or the opt-in agent injects after start.
2. Do not build either before M1 to M4 are answered. The hook helper and the shared core are the same for both plans.

## 6. Platform-neutral core and test seams

Proposed layout (all CommonJS like `src/install`; none of it exists yet):

```
src/survive/
  fingerprint.cjs   snapshot(target) -> Fingerprint           (reads asar header + package.json only)
  detect.cjs        detect(applied, current) -> verdict       (pure)
  decide.cjs        decide(input) -> Action; nextDelay(n)     (pure)
  reapply.cjs       reapply(target, deps) -> Result           (the transaction in 3.3.1; extracted from install())
  store.cjs         watch.state.json read/write, install.lock
  tick.cjs          tick(deps) -> Report                      (one pass over every recorded target)
  platform/
    win32.cjs       runKey add/remove/read, lockProbe, listProcesses, registryHints
    darwin.cjs      launchAgentPlist(), listProcesses, quarantineAttr
    posix.cjs       signals, ps
src/inject/
  cdp.cjs           CDP client + evaluate (shared)
  posix.cjs         findMainPid, canOpenInspector, openInspector via SIGUSR1   (from bin/t3mod-inject.mjs)
  win32.cjs         per spike W2
bin/t3mod-watch.mjs resident loop (Windows) / --tick / --after-update (macOS)
```

The seams, as plain function arguments (`deps`), so tests pass fakes:

| Seam | Signature | Real implementation | Test double |
| --- | --- | --- | --- |
| detect update | `snapshot(target) -> Fingerprint`, `detect(applied, fp) -> Verdict` | file reads | none needed, pure |
| decide safe to act | `isRunning(target) -> bool`, `liveAvailable(target) -> bool`, `activity() -> idle/busy/unknown`, `fuses(exe)` | lock probe / process list / `readFuses` | scripted booleans |
| re-apply (disk) | `patch(target)`: the transaction | `patchedAsar` + renames | real temp dirs plus a wrapper `fs` that can throw EBUSY/EPERM at chosen steps |
| re-apply (live) | `inject(pid) -> {ok, status}` | CDP over the inspector | records calls, returns canned status |
| report | `report(event)` | log file + `install.json` | in-memory array |
| time | `now()`, `sleep(ms)` | `Date`, timers | fake clock that advances on `sleep` |
| discovery | `findTargets()` | existing function | returns a prepared list |

`tick(deps)` never reads globals. The Windows watcher is `while (!stopped) { tick(real); await sleep(interval) }` and the macOS helper is `tick(real)` in a bounded loop, so the platform backends contain no decision logic.

Tests (all run on Linux CI, using the existing synthetic-T3 builder in `test/install.test.mjs` which already builds asar archives with `asar.build`):

1. **Simulated update.** Install into a synthetic v1, then overwrite `app.asar` with a pristine v2 (optionally delete or keep the stale `.t3mod-backup`, to cover both installer behaviours), call `tick()`. Expect: detect `updated`, direct patch, `app.asar` marked, backup is v2's original byte for byte, `install.json` `applied.version` is v2, `history` has one entry, uninstall restores v2 byte for byte (this test fails on today's code: see 2.3).
2. **Running T3.** `isRunning` true, `liveAvailable` true: expect `inject` called once, no disk write, patch queued. T3 "exits" (fake flips): next tick patches.
3. **Running, no live path:** expect queued, no prompt, no attempt counted, no `inject` call.
4. **Locked file.** Wrapped `fs` throws EBUSY on the second rename: expect rollback (asar and backup exactly as before), classified `transient`.
5. **Half-written update.** Truncated asar: structural check fails, no attempt counted, then a complete asar appears: patched.
6. **Backoff and give-up.** Five scripted transient failures with the fake clock: delays 30 s, 2 min, 10 min, 30 min, 2 h, then `gave-up`; a new fingerprint resets; `reapply` command resets.
7. **Permanent failures** (fuse on, ESM entry, `needs-admin`, `foreign`): zero retries, reason recorded, T3 file untouched.
8. **Fuse flip.** v1 has the fuse off, v2's synthetic exe has it on: refuse, `blocked` recorded. (Synthetic exe: a file containing the sentinel and the flag bytes, as `readFuses` expects.)
9. **Opt-out.** `watcher:false` in config: `tick` is a no-op; `watch off` removes the (fake) Run value and signals stop; uninstall removes the entry before touching the asar (assert call order).
10. **Windows backend with a fake `reg`:** Run command string under 260 characters, value round trip, `previous` restored, undo skipped when the value was changed by someone else.
11. **macOS backend:** the LaunchAgent plist generator is a pure function; test the exact XML and the `WatchPaths` entry. The `before-quit-for-update` handler is tested against a fake `autoUpdater` (an `EventEmitter`) and a stubbed `spawn`.
12. **Zero-cost gate:** with no enabled mods, `watch.sync()` must not create the Run entry and a started watcher exits before its first tick. This is part of the section 6 quality gate in the roadmap.

What cannot be tested on Linux and needs the spikes below: the real Run key, real file locks, the installer's behaviour, Squirrel.Mac, TCC, and the Windows live-injection mechanism.

## 7. Open questions for the owner

1. **Windows watcher shape.** Resident Node process from the Run key (recommended) or a logon-only sweep plus the in-process hook (nothing resident, but a manual setup.exe update and a relaunched T3 are only picked up at next logon / by the hook)? The resident cost needs measuring (W6).
2. **Is `process._debugProcess` acceptable** for live injection on Windows if it works (undocumented, creates a remote thread in T3, may trip security software)? If not, Windows is patch-at-exit only.
3. **Restart policy.** Keep "never restart, mods return at next natural start" as the Windows baseline, or build the ask-then-wait-for-idle flow later (needs `activity()`, which needs the T3-data API)?
4. **macOS safety net.** Hook only (default), or also offer the opt-in LaunchAgent? And Plan A or Plan B after the spikes?
5. **Per-machine / Program Files installs.** Report `needs-admin` and stop (baseline), or build copy mode (3.8)?
6. **Multiple installs (stable and nightly side by side).** Allow `install` to record and watch several targets? This changes the installer prompt and `status`.
7. **Windows installer prompt.** Default-on watcher with a question at install (proposed), or default-off with a flag? Per your weakness list: nothing starts at login without a visible consent and a one-line way out.
8. **Machine without Node.** The watcher needs Node 22+ (as the installer does). Fine to require it permanently on Windows, or should the install refuse to add the watcher when Node is not on a stable path (for example a version-manager shim)?
9. **`install.json` location on Windows.** It sits in the roaming `%APPDATA%` today. Move it (and `config.json`) to `%LOCALAPPDATA%`, or leave it and accept stale paths if a profile roams?
10. **Facts about T3 to confirm.** Please check whether T3's nightly is a separate app or a channel, and whether T3 uses electron-updater on Windows and macOS (a look at `resources/app-update.yml` of each build answers both; I did not open the real install).

## 8. Spikes (real machines, before the matching phase)

| ID | Question | Why it matters | Needs |
| --- | --- | --- | --- |
| W1 | Can a standard user create the Run value and a per-user logon task? | 3.1 | Windows VM, standard user |
| W2 | Does `process._debugProcess(pid)` open the inspector in T3's main process, with the nodeCliInspect fuse on? | 3.3.3, decides live path on Windows | Windows with a throw-away copy of T3 |
| W3 | While T3 runs, what happens on rename/open of `app.asar` and the exe? What does the NSIS installer do to extra files in the install dir (stale `.t3mod-backup`)? | 2.3, 3.3.1 | Windows VM, two T3 versions |
| W4 | Does starting `node.exe` from Run flash a console window with the `windowsHide` re-spawn? | 3.1.2 | Windows VM |
| W5 | Which uninstall-key values (`InstallLocation`, `DisplayIcon`) do T3's installs write, in which hive? | 3.2 | Windows VM |
| W6 | Idle memory and CPU of the watcher over a day | 3.1, question 7.1 | Windows VM |
| M1 | Does a bundle with an edited `app.asar` launch (quarantined, then approved), on Apple silicon? | 5.4 | Mac |
| M2 | Does Squirrel.Mac still update a bundle with an edited `app.asar`? | 5.4 | Mac, two signed T3 versions |
| M3 | Does `before-quit-for-update` fire in T3's real update path, and how soon after the swap does the new T3 start? | 5.3 | Mac |
| M4 | Can a launchd-started node process write into `/Applications/T3 Code.app` (App Management)? Does SIGUSR1 open the inspector with the fuse on? | 5.3, 5.4 | Mac |

## 9. Proposed implementation order

Each step lands with its own tests and a commit; each is useful alone.

0. **Fix the stale-backup hazard** (2.3): record `version`, `originalSha256`, `patchedHeaderSha256`; make `uninstall` verify before restoring. Test 1's uninstall half. Small, and it protects the owner's real installs today.
1. **Core without any watcher**: `fingerprint`, `detect`, `decide`, `reapply`, `store`, `tick` with fakes, tests 1 to 8. Ship `node bin/t3mod-install.mjs reapply` (manual, all platforms). This replaces "run the installer again" for Windows, macOS and unpacked Linux, and is the first user-visible gain.
2. **Windows watcher**: `bin/t3mod-watch.mjs`, Run-key backend, `watch on|off|status`, install prompt, logging, state, tests 9 and 10, `install.json` v2. Patch-at-exit path only. Then run W1, W3, W4, W5, W6.
3. **Live injection off Linux**: split `t3mod-inject.mjs` into `src/inject/*`; macOS pid/port via `ps`/`lsof` and the fuse read from the binary; Windows after spike W2. Wire `liveAvailable` into `decide`.
4. **macOS hook helper** (`before-quit-for-update` + `will-quit`, `--after-update`), after M1 to M4. Then the optional LaunchAgent (test 11).
5. **Report in the Mods window**: `loaderApi.list()` returns `{ lastReapply, watch }` from `install.json`; the core UI shows one line ("Re-applied after T3 1.3.0 at 14:02, ok" or the failure reason).
6. Later, only if the owner wants them: restart-ask flow, copy mode for per-machine installs, multi-install support.

Steps 0 and 1 are small enough to start now and need no Windows or macOS machine.

## Sources

Official pages read for this document (2026-11-08):

- Electron: [autoUpdater API](https://www.electronjs.org/docs/latest/api/auto-updater), [Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates), [ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity), [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- electron-builder: [Auto Update](https://www.electron.build/docs/features/auto-update/), [electron-updater](https://www.electron.build/docs/api/electron-updater/), [NSIS](https://www.electron.build/docs/nsis) and [NsisOptions](https://www.electron.build/docs/api/app-builder-lib.interface.nsisoptions/), [Windows](https://www.electron.build/docs/win/). These pages are labelled as documenting the unreleased v27.
- Squirrel.Mac: [README](https://github.com/Squirrel/Squirrel.Mac)
- Microsoft: [Run and RunOnce registry keys](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys), [schtasks create](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create), [Task Scheduler start page](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page), [logon trigger example](https://learn.microsoft.com/en-us/windows/win32/taskschd/logon-trigger-example--scripting-)
- Node.js: [process](https://nodejs.org/api/process.html), [inspector](https://nodejs.org/api/inspector.html), [debugging guide](https://nodejs.org/en/learn/getting-started/debugging), [fs](https://nodejs.org/api/fs.html)
- Apple: [Gatekeeper and runtime protection](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web), [App code signing process](https://support.apple.com/guide/security/app-code-signing-process-sec3ad8e6e53/web), [launchd jobs (archive)](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html). Apple Developer Forums DTS replies were consulted for app translocation; they are informal, so the claim is tagged unverified. The Apple pages on updating signed bundles, Hardened Runtime, packaging, and App Management did not load.

No code or documentation from other T3 mod or plugin projects was read.
