"use strict";
// Commit Graph: a VS Code Git Graph-style surface for T3 Code's right panel.
//
// Client side: patches.cjs adds a `commit-graph` surface kind to the right-panel
// store, the "Open a surface" launcher (below "Pull request", no hotkey), the
// tab title/icon switches and the surface renderer. The UI lives in client/.
// Main side: git.cjs answers whitelisted git operations over IPC.
module.exports = {
  patches: require("./patches.cjs"),
  anchors: require("./anchors.cjs"), // what this mod depends on in T3; see docs/design/anchors.md
  main: require("./git.cjs").register,
};
