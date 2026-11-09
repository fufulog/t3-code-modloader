// The renderer probe: answers for DOM and window anchors, and provably changes nothing.
// The page is a stub that records every read and throws on any write.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { createProbe } = await import(pathToFileURL(resolve(ROOT, "src/core/client/probe.js")).href);

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok   ${name}`);
};

/** An object whose every property read is logged and whose every write/delete/define throws. */
function watched(target, log, label) {
  return new Proxy(target, {
    get(t, k, r) {
      log.push(`get ${label}.${String(k)}`);
      return Reflect.get(t, k, r);
    },
    set(_t, k) {
      throw new Error(`WRITE ${label}.${String(k)}`);
    },
    defineProperty(_t, k) {
      throw new Error(`DEFINE ${label}.${String(k)}`);
    },
    deleteProperty(_t, k) {
      throw new Error(`DELETE ${label}.${String(k)}`);
    },
    setPrototypeOf() {
      throw new Error(`SETPROTO ${label}`);
    },
  });
}

function makePage() {
  const log = [];
  const sideEffects = [];
  const present = new Set([".right-panel", "#composer"]);
  const document = watched(
    {
      querySelectorAll(sel) {
        log.push(`call querySelectorAll(${sel})`);
        if (sel === "!!bad") throw new SyntaxError("invalid selector");
        return { length: sel === "li" ? 3 : present.has(sel) ? 1 : 0 };
      },
      // anything below would be a side effect; the probe must never reach them
      createElement: () => sideEffects.push("createElement"),
      addEventListener: () => sideEffects.push("addEventListener"),
      querySelector: () => sideEffects.push("querySelector"),
      body: { appendChild: () => sideEffects.push("appendChild") },
    },
    log,
    "document",
  );
  let getterRuns = 0;
  const bridge = { showContextMenu() { sideEffects.push("showContextMenu called"); }, version: "1" };
  const win = {
    desktopBridge: bridge,
    notAnObject: 5,
    nothing: null,
    get lazy() {
      getterRuns++;
      sideEffects.push("getter ran");
      return { deep: 1 };
    },
    holder: { get accessor() { getterRuns++; sideEffects.push("getter ran"); return 1; } },
    fetch() { sideEffects.push("fetch called"); },
    eval() { sideEffects.push("eval called"); },
  };
  return { document, window: watched(win, log, "window"), log, sideEffects, getterRuns: () => getterRuns, raw: { win, bridge } };
}

const specs = [
  { name: "panel", kind: "renderer-selector", selector: ".right-panel", min: 1, max: null },
  { name: "gone", kind: "renderer-selector", selector: ".nope", min: 1, max: null },
  { name: "list", kind: "renderer-selector", selector: "li", min: 1, max: 2 },
  { name: "bridge", kind: "renderer-global", path: "desktopBridge.showContextMenu", type: "function" },
  { name: "bridge-wrong-type", kind: "renderer-global", path: "desktopBridge.showContextMenu", type: "string" },
  { name: "no-global", kind: "renderer-global", path: "desktopBridge.openThing", type: "function" },
  { name: "no-root", kind: "renderer-global", path: "missingRoot.x", type: "any" },
];

test("runtime-only anchors: selector and window path probes answer present / missing", () => {
  const page = makePage();
  const out = createProbe(page).run(specs);
  assert.equal(out.panel.state, "present");
  assert.equal(out.gone.state, "missing");
  assert.match(out.gone.reason, /\.nope matched 0 element/);
  assert.equal(out.list.state, "missing");
  assert.match(out.list.reason, /matched 3 element\(s\), expected 1\.\.2/);
  assert.equal(out.bridge.state, "present");
  assert.equal(out["bridge-wrong-type"].state, "missing");
  assert.match(out["bridge-wrong-type"].reason, /is function, expected string/);
  assert.equal(out["no-global"].state, "missing");
  assert.equal(out["no-root"].state, "missing");
});

test("the probe has no side effects: no writes, no calls except querySelectorAll, no getters", () => {
  const page = makePage();
  const before = JSON.stringify(Object.keys(page.raw.win));
  // a getter at the end of a path is reported present, never evaluated; in the middle it is "unknown"
  const out = createProbe(page).run([
    ...specs,
    { name: "getter-last", kind: "renderer-global", path: "lazy", type: "any" },
    { name: "getter-typed", kind: "renderer-global", path: "lazy", type: "object" },
    { name: "getter-middle", kind: "renderer-global", path: "lazy.deep", type: "any" },
    { name: "getter-nested", kind: "renderer-global", path: "holder.accessor", type: "any" },
    { name: "calls-fetch", kind: "renderer-global", path: "fetch", type: "function" },
    { name: "calls-eval", kind: "renderer-global", path: "eval", type: "function" },
  ]);
  assert.equal(out["getter-last"].state, "present");
  assert.equal(out["getter-typed"].state, "unknown");
  assert.equal(out["getter-middle"].state, "unknown");
  assert.equal(out["calls-fetch"].state, "present"); // found, not called
  assert.equal(page.getterRuns(), 0, "no getter ran");
  assert.deepEqual(page.sideEffects, [], "nothing was called, created or listened to");
  assert.equal(JSON.stringify(Object.keys(page.raw.win)), before);
  // the only call the probe made on the page is querySelectorAll, once per selector spec
  const calls = page.log.filter((l) => l.startsWith("call "));
  assert.equal(calls.length, specs.filter((s) => s.kind === "renderer-selector").length);
  assert.ok(calls.every((c) => c.startsWith("call querySelectorAll(")));
  // reading document is limited to that one method
  assert.deepEqual([...new Set(page.log.filter((l) => l.startsWith("get document.")))], ["get document.querySelectorAll"]);
});

test("the probe never throws: bad selectors, bad paths, hostile pages, junk specs", () => {
  const page = makePage();
  const out = createProbe(page).run([
    { name: "bad-css", kind: "renderer-selector", selector: "!!bad" },
    { name: "empty", kind: "renderer-selector", selector: "" },
    { name: "huge", kind: "renderer-selector", selector: "a".repeat(5000) },
    { name: "path-injection", kind: "renderer-global", path: "a.b(); alert(1)" },
    { name: "proto", kind: "renderer-global", path: "desktopBridge.__proto__.constructor" },
    { name: "not-object", kind: "renderer-global", path: "notAnObject.x" },
    { name: "null-mid", kind: "renderer-global", path: "nothing.x" },
    { name: "wrong-kind", kind: "renderer-reported" },
    null,
    5,
    { kind: "renderer-global" },
  ]);
  assert.equal(out["bad-css"].state, "unknown");
  assert.equal(out.empty.state, "unknown");
  assert.equal(out.huge.state, "unknown");
  assert.equal(out["path-injection"].state, "unknown");
  assert.notEqual(out["not-object"].state, "present");
  assert.equal(out["wrong-kind"].state, "unknown");
  assert.equal(page.sideEffects.length, 0);
  // a page that throws on every access
  const angry = new Proxy({}, { get() { throw new Error("angry"); }, getOwnPropertyDescriptor() { throw new Error("angry"); }, getPrototypeOf() { throw new Error("angry"); } });
  const out2 = createProbe({ document: angry, window: angry }).run(specs);
  for (const s of specs) assert.equal(out2[s.name].state, "unknown", s.name);
  for (const bad of [undefined, null, "x", 5, {}]) assert.deepEqual(createProbe({ document: angry, window: angry }).run(bad), {});
  assert.equal(Object.keys(createProbe(page).run(Array.from({ length: 500 }, (_, i) => ({ name: `s${i}`, kind: "renderer-selector", selector: "li" })))).length, 64);
});

console.log(`\n${n} tests passed`);
