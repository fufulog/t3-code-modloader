"use strict";
// What Command Code Usage depends on in T3. See docs/design/anchors.md.
//
// Patches are anchors by themselves; this file only documents what each one is
// for and what happens if it is gone.

const patch = (name, description) => ({ name, kind: "patch", patch: name, description });

module.exports = [
  patch("provider-meta", "UsageLimits chunk: the provider metadata map (label, colour, driver kind)"),
  patch("provider-label", "UsageLimits chunk: the pool header label lookup, so Command Code reads by name"),
  patch("usage-data", "usageLimits chunk: the account array the usage pools are built from"),
  patch("usage-refresh", "usage refresh command (_chat.usage chunk): refresh Command Code alongside T3's usage"),
];
