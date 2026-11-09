"use strict";
// One status per mod, worked out whenever the loader scans, the Mods window reports a probe, or a
// mod fails (loader.cjs computeCatalog), from three sources:
//   1. what the mod declares        -> declaredIncompatible: { reason } | null   (compat.cjs, via entry.compat)
//   2. whether its anchors exist    -> anchors: results from anchors.cjs
//   3. whether injection failed     -> injectionFailure: { phase?, reason } | null   (failures.cjs)
//
// States, in precedence order (the first that holds is the state; the rest go in `also`):
//   incompatible   the mod declares it does not support this T3. It is not injected.
//   failed         injection was tried and failed. Nothing it added is left behind.
//   anchors-missing  one or more anchors are gone. Blocking ones keep the mod from injecting;
//                  optional ones (with a documented fallback) leave it injected, running its fallback.
//   compatible     nothing above applies.
//
// Why this order: a declaration is the author's explicit word, and it stops injection, so a leftover
// failure or anchor probe from before it must not hide it. A failure is a concrete event with a reason
// and beats an inference from anchors. Anchors come last because they are the only source that can be
// merely partial (runtime anchors that were not probed are "unknown", never "missing").
//
// computeStatus never throws and treats malformed inputs as "nothing known".

const STATES = ["incompatible", "failed", "anchors-missing", "compatible"];

const text = (v) => (typeof v === "string" ? v.slice(0, 300) : "");
const reasonOf = (v, fallback) => (v && typeof v === "object" ? text(v.reason) || fallback : null);

function summarize(results) {
  const missing = [];
  const unknown = [];
  let present = 0;
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r.name !== "string") continue;
    if (r.state === "present") present++;
    else if (r.state === "missing") missing.push({ name: r.name, kind: text(r.kind), reason: text(r.reason), optional: r.optional === true, ...(r.fallback ? { fallback: text(r.fallback) } : {}) });
    else unknown.push({ name: r.name, kind: text(r.kind), reason: text(r.reason) });
  }
  return { missing, unknown, present };
}

/** "main setup failed: boom" when the phase is known (it comes from the failure record), else just the reason. */
function failedReason(failure) {
  const reason = reasonOf(failure, "injection failed");
  return reason !== null && typeof failure.phase === "string" && failure.phase ? `${text(failure.phase)} setup failed: ${reason}` : reason;
}

/** The line shown for a missing anchor, e.g. `diff-section (fallback: plain diff): anchor matched 0x`. */
function describeMissing(m) {
  return `anchor ${m.name} is missing${m.reason ? `: ${m.reason}` : ""}${m.fallback ? ` (fallback in use: ${m.fallback})` : ""}`;
}

/**
 * @param {object} input
 * @param {Array|null} input.anchors   results from anchors.checkStatic (+ withProbe); null = not evaluated (mod not loaded)
 * @param {{reason:string}|null} input.declaredIncompatible
 * @param {{reason:string}|null} input.injectionFailure
 */
function computeStatus(input) {
  try {
    const { anchors = null, declaredIncompatible = null, injectionFailure = null } = input ?? {};
    const checked = Array.isArray(anchors);
    const { missing, unknown, present } = summarize(anchors);
    const blocking = missing.filter((m) => !m.optional);
    const holds = {
      incompatible: reasonOf(declaredIncompatible, "declared incompatible with this version of T3"),
      failed: failedReason(injectionFailure),
      "anchors-missing": missing.length ? missing.map((m) => m.name).join(", ") : null,
    };
    const active = STATES.filter((s) => s === "compatible" || holds[s] !== null && holds[s] !== undefined);
    const state = active[0];
    const injects = state === "compatible" || (state === "anchors-missing" && blocking.length === 0);
    const reason = state === "compatible" ? "" : state === "anchors-missing" ? missing.map(describeMissing).join("; ") : holds[state];
    return {
      state,
      checked,
      injects,
      reason,
      missing,
      unverified: unknown,
      present,
      also: active.slice(1).filter((s) => s !== "compatible"),
    };
  } catch (e) {
    // Unreachable in practice; if it ever happens, say nothing is known rather than blocking a mod.
    return { state: "compatible", checked: false, injects: true, reason: "", missing: [], unverified: [], present: 0, also: [], error: text(e?.message) };
  }
}

// ---- the two inputs the loader already knows -------------------------------------------------------
//
// Nothing is recomputed here. The compatibility manifest is checked once, when the mod is loaded
// (src/main/compat.cjs, result kept as `entry.compat`), and a failed injection is a record in
// src/main/failures.cjs ({ phase, reason, at }). This only reshapes them for computeStatus.

/**
 * @param entry    a discovered mod; `entry.compat` is checkCompat's result ({ compatible, reason? }) or unset
 * @param failure  the mod's failure record from failures.cjs, or null
 */
function inputsFor(entry, failure = null) {
  const incompatible = entry?.compat?.compatible === false;
  return {
    declaredIncompatible: incompatible ? { reason: text(entry.compat.reason) } : null,
    injectionFailure: failure ? { phase: failure.phase, reason: failure.reason } : null,
  };
}

module.exports = { STATES, computeStatus, describeMissing, inputsFor };
