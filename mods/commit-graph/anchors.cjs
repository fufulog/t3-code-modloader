"use strict";
// Where Commit Graph hooks into T3. Format and checking rules: docs/design/anchors.md.
//
// Static anchors are checked by the loader in the main process; the two renderer anchors are
// checked by the Mods window's read-only probe when it opens. A required anchor that is gone keeps
// the mod from injecting; one with a `fallback` leaves it injected on its documented fallback.

const patch = (name, description, extra = {}) => ({ name, kind: "patch", patch: name, description, ...extra });

module.exports = [
  // ---- T3 client chunks (one entry per patch in patches.cjs) -------------------------------------
  patch("store-factory", "right-panel store: builds a commit-graph surface (rightPanelStore chunk)"),
  patch("store-validator", "right-panel store: accepts commit-graph in the closed-tab history"),
  patch("panel-title", "tab title for the surface (PanelLayoutControls chunk)"),
  patch("panel-icon", "tab icon for the surface"),
  patch("panel-launcher", 'entry in the empty-state "Open a surface" list, below "Pull request"'),
  patch("panel-add-menu", 'entry in the tab strip "+" menu'),
  patch("panel-kbd", "hides the empty shortcut pill for items without a hotkey"),
  patch("chat-opener", "chat view: captures the thread ref and the right-panel store (_chat chunk)"),
  patch("chat-render", "chat view: renders the Commit Graph surface and hands it the thread's props"),
  patch("diff-section", "T3's own diff section component (DiffPanel chunk)", { fallback: "the built-in plain diff view" }),
  patch("diff-parse", "T3's diff parser and theme lookup (diffRendering chunk)", { fallback: "the built-in plain diff view" }),

  // ---- main process: what git.cjs registers with ------------------------------------------------
  { name: "ipc-handle", kind: "main-export", module: "electron", path: "ipcMain.handle", type: "function", description: "the git IPC channel is registered here" },
  { name: "ipc-remove-handler", kind: "main-export", module: "electron", path: "ipcMain.removeHandler", type: "function", description: "re-registering the git channel after a reload" },

  // ---- renderer, runtime only -----------------------------------------------------------------
  {
    name: "desktop-bridge-context-menu",
    kind: "renderer-global",
    path: "desktopBridge.showContextMenu",
    type: "function",
    description: "T3's native context menu bridge, used for every right-click menu",
    fallback: "right-click menus do nothing",
  },
  {
    name: "surface-props",
    kind: "renderer-reported",
    description: "environmentId, projectId, composerDraftTarget and workspaceRoot arrive as props of T3's chat view; they only exist while the surface renders",
  },
];
