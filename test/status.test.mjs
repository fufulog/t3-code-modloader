// The unified per-mod status: precedence, the injects flag, and that it never throws.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computeStatus, inputsFor, STATES } = require("../src/main/status.cjs");

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok   ${name}`);
};

const present = { name: "a", kind: "patch", state: "present" };
const gone = { name: "store-factory", kind: "patch", state: "missing", reason: "anchor matched 0x (want 1)" };
const goneOptional = { name: "diff-section", kind: "patch", state: "missing", reason: "anchor matched 0x", optional: true, fallback: "plain diff" };
const unknown = { name: "surface-props", kind: "renderer-reported", state: "unknown", reason: "only the mod can tell" };

test("precedence: incompatible > failed > anchors-missing > compatible", () => {
  assert.deepEqual(STATES, ["incompatible", "failed", "anchors-missing", "compatible"]);
  const cases = [
    // [declaredIncompatible, injectionFailure, anchor missing] -> state, also
    [false, false, false, "compatible", []],
    [false, false, true, "anchors-missing", []],
    [false, true, false, "failed", []],
    [false, true, true, "failed", ["anchors-missing"]],
    [true, false, false, "incompatible", []],
    [true, false, true, "incompatible", ["anchors-missing"]],
    [true, true, false, "incompatible", ["failed"]],
    [true, true, true, "incompatible", ["failed", "anchors-missing"]],
  ];
  for (const [inc, fail, miss, state, also] of cases) {
    const s = computeStatus({
      anchors: [present, ...(miss ? [gone] : [])],
      declaredIncompatible: inc ? { reason: "not for 2.x" } : null,
      injectionFailure: fail ? { reason: "boom" } : null,
    });
    assert.equal(s.state, state, JSON.stringify([inc, fail, miss]));
    assert.deepEqual(s.also, also);
  }
});

test("reasons name what is wrong", () => {
  assert.equal(computeStatus({ declaredIncompatible: { reason: "T3 2.x moved the panel" } }).reason, "T3 2.x moved the panel");
  assert.equal(computeStatus({ injectionFailure: { reason: "main() threw" } }).reason, "main() threw");
  assert.match(computeStatus({ declaredIncompatible: {} }).reason, /declared incompatible/);
  const s = computeStatus({ anchors: [present, gone] });
  assert.deepEqual(s.missing.map((m) => m.name), ["store-factory"]);
  assert.match(s.reason, /anchor store-factory is missing: anchor matched 0x/);
});

test("anchors: a blocking miss stops injection, an optional one runs the fallback", () => {
  const blocked = computeStatus({ anchors: [present, gone, goneOptional] });
  assert.equal(blocked.state, "anchors-missing");
  assert.equal(blocked.injects, false);
  assert.deepEqual(blocked.missing.map((m) => m.name), ["store-factory", "diff-section"]);
  const fallback = computeStatus({ anchors: [present, goneOptional] });
  assert.equal(fallback.state, "anchors-missing");
  assert.equal(fallback.injects, true);
  assert.match(fallback.reason, /fallback in use: plain diff/);
});

test("unknown anchors never change the state; compatible and unchecked mods inject", () => {
  const s = computeStatus({ anchors: [present, unknown] });
  assert.equal(s.state, "compatible");
  assert.equal(s.injects, true);
  assert.deepEqual(s.unverified.map((u) => u.name), ["surface-props"]);
  assert.equal(s.checked, true);
  assert.equal(computeStatus({ anchors: null }).checked, false);
  assert.equal(computeStatus({}).state, "compatible");
  for (const state of ["incompatible", "failed"]) {
    const s2 = computeStatus(state === "failed" ? { injectionFailure: { reason: "x" } } : { declaredIncompatible: { reason: "x" } });
    assert.equal(s2.injects, false, state);
  }
});

test("status never throws, whatever it is given", () => {
  const hostile = new Proxy({}, { get() { throw new Error("no"); }, has() { throw new Error("no"); }, ownKeys() { throw new Error("no"); } });
  const cyc = {};
  cyc.self = cyc;
  const inputs = [undefined, null, 1, "x", [], hostile, { anchors: "nope" }, { anchors: [null, 1, "x", {}, { name: 5 }, hostile] }, { anchors: [cyc], declaredIncompatible: "x", injectionFailure: 7 }, { declaredIncompatible: hostile }];
  for (const i of inputs) {
    const s = computeStatus(i);
    assert.ok(STATES.includes(s.state));
    assert.equal(typeof s.injects, "boolean");
  }
});

test("inputs come from the compat result and the failure record, nothing is re-derived", () => {
  assert.deepEqual(inputsFor({ id: "x" }), { declaredIncompatible: null, injectionFailure: null });
  assert.deepEqual(inputsFor({ id: "x", compat: { compatible: true } }), { declaredIncompatible: null, injectionFailure: null });
  assert.deepEqual(inputsFor(undefined, null), { declaredIncompatible: null, injectionFailure: null });
  const inc = inputsFor({ id: "x", compat: { compatible: false, reason: "Not compatible with T3 2.x" } });
  assert.deepEqual(inc, { declaredIncompatible: { reason: "Not compatible with T3 2.x" }, injectionFailure: null });
  assert.equal(computeStatus(inc).state, "incompatible");
  assert.equal(computeStatus(inc).reason, "Not compatible with T3 2.x");
  const failed = inputsFor({ id: "x" }, { phase: "main", reason: "boom", at: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(failed, { declaredIncompatible: null, injectionFailure: { phase: "main", reason: "boom" } });
  const s = computeStatus(failed);
  assert.equal(s.state, "failed");
  assert.equal(s.injects, false);
  assert.equal(s.reason, "main setup failed: boom");
});

console.log(`\n${n} tests passed`);
