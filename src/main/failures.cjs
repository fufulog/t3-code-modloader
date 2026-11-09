"use strict";
// Per-mod failure records. They are one of the three inputs of the unified mod status
// (status.cjs: declared incompatible, anchors, failed); loader.cjs computeCatalog turns a
// record into the mod's `failed` state.
//
// A failure is { phase, reason, at } with phase "load" (mod.cjs threw), "main"
// (main() threw or rejected) or "renderer" (the mod's client runtime reported it).
// The catalog carries it as `failure`.

const MAX_REASON = 200;

/** One short line from whatever was thrown. */
function shortReason(error) {
  const text = String(error?.message ?? error ?? "unknown error").split("\n")[0].trim();
  return text.length > MAX_REASON ? text.slice(0, MAX_REASON - 1) + "…" : text || "unknown error";
}

function createFailures() {
  const byMod = new Map();
  return {
    fail(id, phase, error) {
      if (byMod.has(id)) return byMod.get(id); // the first failure is the cause; later ones are fallout
      const failure = { phase, reason: shortReason(error), at: new Date().toISOString() };
      byMod.set(id, failure);
      return failure;
    },
    get: (id) => byMod.get(id) ?? null,
    has: (id) => byMod.has(id),
    /** Forget failures. `phases` limits which kinds; no `id` means every mod. */
    clear(id, phases) {
      for (const [k, f] of [...byMod]) if ((id === undefined || k === id) && (!phases || phases.includes(f.phase))) byMod.delete(k);
    },
    all: () => Object.fromEntries(byMod),
  };
}

module.exports = { createFailures, shortReason };
