"use strict";
// One status per mod, worked out when the Mods window opens, from three sources:
//   1. what the mod declares        -> declaredIncompatible: { reason } | null
//   2. whether its anchors exist    -> anchors: results from anchors.cjs
//   3. whether injection failed     -> injectionFailure: { reason } | null
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
      failed: reasonOf(injectionFailure, "injection failed"),
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

// ---- inputs owned by other work: stub adapters ---------------------------------------------------
//
// TODO(merge: compat manifest): the "compatibility manifest" work adds the declared-incompatible
//   manifest field. Replace `declaredIncompatible` below with a call into it, returning
//   { reason } when the running T3 version is listed, else null. `entry` is the discovered mod
//   (src/main/mods.cjs inspect()); `t3` should carry the running T3 version.
// TODO(merge: failed injection): the "failed injection" work records mods whose injection failed
//   (and was rolled back). Replace `injectionFailure` below with a lookup of that record, returning
//   { reason } or null.
// Until both land, every mod reports "nothing declared, nothing failed".
const stubAdapters = {
  declaredIncompatible: (_entry, _t3) => null,
  injectionFailure: (_entry) => null,
};

/** Collect the two injected inputs for a mod. An adapter that throws counts as "nothing known". */
function collectInputs(entry, t3 = {}, adapters = stubAdapters) {
  const ask = (fn, ...args) => {
    try {
      return fn(...args) ?? null;
    } catch {
      return null;
    }
  };
  return {
    declaredIncompatible: ask(adapters.declaredIncompatible, entry, t3),
    injectionFailure: ask(adapters.injectionFailure, entry),
  };
}

module.exports = { STATES, computeStatus, describeMissing, collectInputs, stubAdapters };
