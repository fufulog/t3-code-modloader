"use strict";
// Command Code Usage: adds Command Code's plan usage to T3's Usage panel.
//
// Renderer: patches.cjs appends a `commandcode` provider to the provider map
// (label/colour, and it joins the provider list), appends our account to the
// usage module's account array (so T3's own pool/window maths renders it), and
// hooks the usage refresh command so the numbers update with T3's.
// Main: main.cjs reads Command Code's usage from its API using the existing CLI
// login and returns it over one narrow IPC channel.
module.exports = {
  patches: require("./patches.cjs"),
  anchors: require("./anchors.cjs"),
  main: require("./main.cjs").register,
};
