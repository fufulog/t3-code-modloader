// Renderer probe: answers "does this anchor exist in T3's page?" without changing anything.
//
// Input is plain data (the specs from src/main/anchors.cjs runtimeSpecs), never code. Two kinds:
//   renderer-selector  { name, selector, min, max }   count matches of a CSS selector
//   renderer-global    { name, path, type }           look up a dotted path under window
//
// What it never does: write to the document or to any object, create or move nodes, call a function it
// finds, run a getter, dispatch events, import() a module or load a script. It reads through
// `querySelectorAll` (which only returns a list; the list is counted and dropped) and through property
// descriptors. A page that was never touched looks identical afterwards (test/probe.test.mjs checks this
// against a document and window that record every access and throw on writes).
// Anything surprising turns into { state: "unknown", reason } and never an exception.

const PATH_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*){0,7}$/;
const MAX_SELECTOR = 200;
const MAX_SPECS = 64;

const present = () => ({ state: "present" });
const missing = (reason) => ({ state: "missing", reason });
const unknown = (reason) => ({ state: "unknown", reason });

/** Find a data property along the prototype chain without invoking getters. */
function descriptorOf(obj, key) {
  for (let o = obj, depth = 0; o !== null && o !== undefined && depth < 8; o = Object.getPrototypeOf(o), depth++) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    if (d) return d;
  }
  return null;
}

function probeSelector(spec, doc) {
  if (typeof spec.selector !== "string" || !spec.selector || spec.selector.length > MAX_SELECTOR) return unknown("invalid selector");
  let count;
  try {
    count = doc.querySelectorAll(spec.selector).length;
  } catch {
    return unknown("the selector is not valid CSS");
  }
  const min = Number.isInteger(spec.min) ? spec.min : 1;
  const max = Number.isInteger(spec.max) ? spec.max : Infinity;
  if (count < min || count > max) return missing(`${spec.selector} matched ${count} element(s), expected ${min}${max === Infinity ? "+" : `..${max}`}`);
  return present();
}

function probeGlobal(spec, win) {
  if (typeof spec.path !== "string" || !PATH_RE.test(spec.path)) return unknown("invalid path");
  const type = typeof spec.type === "string" ? spec.type : "any";
  const keys = spec.path.split(".");
  let cur = win;
  for (let i = 0; i < keys.length; i++) {
    if (cur === null || cur === undefined || (typeof cur !== "object" && typeof cur !== "function")) return missing(`${keys.slice(0, i).join(".") || "window"} is not an object`);
    const d = descriptorOf(cur, keys[i]);
    if (!d) return missing(`${spec.path}: ${keys[i]} does not exist`);
    if (!("value" in d)) {
      // An accessor: running it could do anything, so only the last step may be one, and its type stays unchecked.
      if (i === keys.length - 1 && type === "any") return present();
      return unknown(`${keys.slice(0, i + 1).join(".")} is a getter; not evaluated`);
    }
    cur = d.value;
  }
  if (type === "any") return cur === undefined ? missing(`${spec.path} is undefined`) : present();
  const actual = cur === null ? "null" : typeof cur;
  const ok = type === "object" ? cur !== null && actual === "object" : actual === type;
  return ok ? present() : missing(`${spec.path} is ${actual}, expected ${type}`);
}

/**
 * @param {{document: object, window: object}} env  the page to look at (injectable for tests)
 * @returns {{ run(specs: object[]): Record<string, {state: string, reason?: string}> }}
 */
export function createProbe(env) {
  return {
    run(specs) {
      const out = {};
      for (const spec of Array.isArray(specs) ? specs.slice(0, MAX_SPECS) : []) {
        if (!spec || typeof spec.name !== "string") continue;
        try {
          if (spec.kind === "renderer-selector") out[spec.name] = probeSelector(spec, env.document);
          else if (spec.kind === "renderer-global") out[spec.name] = probeGlobal(spec, env.window);
          else out[spec.name] = unknown(`not a probeable kind: ${String(spec.kind).slice(0, 40)}`);
        } catch (e) {
          out[spec.name] = unknown(`probe failed: ${String(e?.message).slice(0, 120)}`);
        }
      }
      return out;
    },
  };
}
