"use strict";
// Anchors: the places in T3 a mod depends on. A mod lists them in the `anchors`
// export of its mod.cjs; this module validates the declarations and evaluates them.
// Format and the static/runtime split: docs/design/anchors.md.
//
// Rules this file keeps:
//   - nothing here throws: a broken declaration or checker becomes a result, never an exception;
//   - nothing here injects or patches anything: static checks only read T3's chunk files and
//     read properties of built-in modules; runtime checks are described as plain data and run by
//     the renderer probe (src/core/client/probe.js), which is read-only.
//
// A result is { name, kind, phase, state, reason?, optional, fallback?, description? } where
// state is "present", "missing" (the anchor is definitely gone) or "unknown" (could not be checked:
// runtime-only and not probed yet, or the checker itself failed). Only "missing" ever affects a mod.

const { isBuiltin } = require("node:module");

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PATH_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*){0,7}$/;
const TYPES = new Set(["any", "function", "object", "string", "number", "boolean"]);
const STATES = new Set(["present", "missing", "unknown"]);
const MAX_TEXT = 300;

/** kind -> phase. "static" runs in the main process; "runtime" needs the renderer. */
const KINDS = {
  patch: "static", // one of the mod's own patches still applies to T3's chunks
  chunk: "static", // a T3 chunk file exists and contains a string/regex (n times)
  "main-export": "static", // a module's export exists in the main process (e.g. electron.ipcMain.handle)
  check: "static", // custom function run in the main process
  "renderer-selector": "runtime", // a CSS selector matches in T3's document (probe)
  "renderer-global": "runtime", // a path on window exists with a type (probe)
  "renderer-reported": "runtime", // only the mod can tell while rendering; cannot be probed
};

const clip = (s) => String(s ?? "").slice(0, MAX_TEXT);
const isRegExp = (v) => Object.prototype.toString.call(v) === "[object RegExp]";

// ---- declarations -------------------------------------------------------------------------

/** Returns { decl } or { invalid: { name, reason } }. Never throws. */
function validate(raw, seen) {
  const name = typeof raw?.name === "string" ? raw.name : "";
  const bad = (reason) => ({ invalid: { name: NAME_RE.test(name) ? name : clip(name) || "(unnamed)", reason } });
  if (!raw || typeof raw !== "object") return bad("declaration is not an object");
  if (!NAME_RE.test(name)) return bad("name must be lowercase letters, digits, dots, dashes (max 64)");
  if (seen.has(name)) return bad("duplicate anchor name");
  const kind = raw.kind;
  if (!Object.hasOwn(KINDS, kind)) return bad(`unknown kind "${clip(kind)}" (known: ${Object.keys(KINDS).join(", ")})`);
  const decl = { name, kind, phase: KINDS[kind], optional: raw.optional === true };
  if (typeof raw.fallback === "string" && raw.fallback) {
    decl.fallback = clip(raw.fallback);
    decl.optional = true; // a documented fallback means the mod works without the anchor
  }
  if (typeof raw.description === "string") decl.description = clip(raw.description);
  const type = raw.type ?? "any";
  if (!TYPES.has(type)) return bad(`type must be one of ${[...TYPES].join(", ")}`);
  switch (kind) {
    case "patch":
      decl.patch = typeof raw.patch === "string" ? raw.patch : name;
      break;
    case "chunk":
      if (!isRegExp(raw.file)) return bad("chunk needs `file`: a RegExp matched against chunk file names");
      if (typeof raw.contains !== "string" && !isRegExp(raw.contains)) return bad("chunk needs `contains`: a string or RegExp");
      decl.file = raw.file;
      decl.contains = raw.contains;
      decl.min = Number.isInteger(raw.min) ? raw.min : 1;
      decl.max = Number.isInteger(raw.max) ? raw.max : Infinity;
      break;
    case "main-export":
      if (typeof raw.module !== "string" || !(raw.module === "electron" || isBuiltin(raw.module))) return bad("main-export `module` must be \"electron\" or a node built-in");
      if (typeof raw.path !== "string" || !PATH_RE.test(raw.path)) return bad("main-export `path` must be a dotted identifier path");
      decl.module = raw.module;
      decl.path = raw.path;
      decl.type = type;
      break;
    case "check":
      if (typeof raw.check !== "function") return bad("check needs a `check` function");
      decl.check = raw.check;
      break;
    case "renderer-selector":
      if (typeof raw.selector !== "string" || !raw.selector || raw.selector.length > 200) return bad("renderer-selector needs a `selector` string (max 200 chars)");
      decl.selector = raw.selector;
      decl.min = Number.isInteger(raw.min) ? raw.min : 1;
      decl.max = Number.isInteger(raw.max) ? raw.max : null;
      break;
    case "renderer-global":
      if (typeof raw.path !== "string" || !PATH_RE.test(raw.path)) return bad("renderer-global `path` must be a dotted identifier path under window");
      decl.path = raw.path;
      decl.type = type;
      break;
  }
  seen.add(name);
  return { decl };
}

/**
 * Parse a mod's declarations plus one implicit anchor per patch the mod did not declare
 * (so a mod that declares nothing still gets its patch anchors named in the Mods window).
 */
function declarations(mod) {
  const seen = new Set();
  const decls = [];
  const invalid = [];
  const list = Array.isArray(mod?.anchors) ? mod.anchors : [];
  for (const raw of list) {
    let r;
    try {
      r = validate(raw, seen);
    } catch (e) {
      r = { invalid: { name: "(unreadable)", reason: clip(e?.message) } };
    }
    if (r.decl) decls.push(r.decl);
    else invalid.push(r.invalid);
  }
  const claimed = new Set(decls.filter((d) => d.kind === "patch").map((d) => d.patch));
  for (const p of Array.isArray(mod?.patches) ? mod.patches : []) {
    const id = typeof p?.id === "string" ? p.id : null;
    if (!id || claimed.has(id) || seen.has(id)) continue;
    seen.add(id);
    decls.push({ name: id, kind: "patch", phase: "static", optional: p.optional === true, patch: id });
  }
  return { decls, invalid };
}

const base = (d, state, reason) => ({
  name: d.name,
  kind: d.kind,
  phase: d.phase,
  state,
  ...(reason ? { reason: clip(reason) } : {}),
  optional: d.optional === true,
  ...(d.fallback ? { fallback: d.fallback } : {}),
  ...(d.description ? { description: d.description } : {}),
});

// ---- static evaluation ---------------------------------------------------------------------

function walk(root, path, read) {
  let cur = root;
  for (const key of path.split(".")) {
    if (cur === null || cur === undefined) return { found: false };
    cur = read(cur, key);
    if (cur === undefined) return { found: false };
  }
  return { found: true, value: cur };
}

const typeOk = (value, type) => type === "any" || (type === "object" ? value !== null && typeof value === "object" : typeof value === type);

function countIn(text, needle) {
  if (typeof needle === "string") {
    if (!needle) return 0;
    let n = 0;
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
    return n;
  }
  return [...text.matchAll(new RegExp(needle.source, needle.flags.includes("g") ? needle.flags : needle.flags + "g"))].length;
}

function evalStatic(d, ctx) {
  switch (d.kind) {
    case "patch": {
      const r = ctx.patchResults?.[d.patch];
      if (!r) return base(d, "missing", `the mod has no patch "${d.patch}"`);
      // a declaration can add a fallback note but cannot make an optional patch blocking
      return { ...base(d, r.state, r.reason), optional: d.optional || r.optional === true };
    }
    case "chunk": {
      const hits = (ctx.chunkNames ?? []).filter((f) => d.file.test(f));
      if (!hits.length) return base(d, "missing", `no chunk matches ${d.file}`);
      let n = 0;
      for (const f of hits) n += countIn(ctx.readChunk(f), d.contains);
      if (n < d.min || n > d.max) return base(d, "missing", `found ${n} match(es) in ${hits.join(", ")}, expected ${d.min}${d.max === Infinity ? "+" : `..${d.max}`}`);
      return base(d, "present");
    }
    case "main-export": {
      const found = walk(ctx.require(d.module), d.path, (o, k) => o[k]);
      if (!found.found) return base(d, "missing", `${d.module}.${d.path} does not exist`);
      if (!typeOk(found.value, d.type)) return base(d, "missing", `${d.module}.${d.path} is a ${typeof found.value}, expected ${d.type}`);
      return base(d, "present");
    }
    case "check": {
      const out = d.check({ require: ctx.require, chunkNames: [...(ctx.chunkNames ?? [])], readChunk: ctx.readChunk });
      if (out === true || out?.ok === true) return base(d, "present");
      if (out === false || out?.ok === false) return base(d, "missing", out?.reason ?? "the mod's check failed");
      return base(d, "unknown", "the check returned neither true nor false");
    }
  }
  return base(d, "unknown", "runtime-only: checked when the Mods window opens");
}

/**
 * Evaluate a mod's anchors against the running T3. ctx = {
 *   require,                  // main-process require (a stub in tests)
 *   chunkNames: string[],     // T3's client chunk files
 *   readChunk(name): string,  // their source
 *   patchResults: { [patchId]: { state: "present"|"missing", reason? } }
 * }
 * Static anchors get a definite answer; runtime anchors come back "unknown" until a probe result is
 * merged in with withProbe(). Never throws.
 */
function checkStatic(mod, ctx = {}) {
  let parsed;
  try {
    parsed = declarations(mod);
  } catch (e) {
    return [{ name: "(anchors)", kind: "check", phase: "static", state: "unknown", reason: clip(`could not read the anchor declarations: ${e?.message}`), optional: false }];
  }
  const cache = new Map();
  const safe = {
    ...ctx,
    readChunk: (name) => {
      if (!cache.has(name)) cache.set(name, String(ctx.readChunk?.(name) ?? ""));
      return cache.get(name);
    },
  };
  const out = parsed.invalid.map((i) => ({ name: i.name, kind: "check", phase: "static", state: "unknown", reason: clip(`invalid declaration: ${i.reason}`), optional: false }));
  for (const d of parsed.decls) {
    try {
      out.push(d.phase === "static" ? evalStatic(d, safe) : base(d, "unknown", d.kind === "renderer-reported" ? "only the mod can tell while it renders" : "runtime-only: checked when the Mods window opens"));
    } catch (e) {
      out.push(base(d, "unknown", `checker failed: ${e?.message}`));
    }
  }
  return out;
}

// ---- runtime (renderer probe) ----------------------------------------------------------------

/** The plain-data specs the renderer probe runs for this mod. No functions, no regexes. */
function runtimeSpecs(mod) {
  try {
    return declarations(mod)
      .decls.filter((d) => d.kind === "renderer-selector" || d.kind === "renderer-global")
      .map((d) => (d.kind === "renderer-selector" ? { name: d.name, kind: d.kind, selector: d.selector, min: d.min, max: d.max } : { name: d.name, kind: d.kind, path: d.path, type: d.type }));
  } catch {
    return [];
  }
}

/** Accept only well-formed probe output for anchors that were actually asked for. */
function sanitizeProbe(raw, specs) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const spec of specs) {
    const r = Object.hasOwn(raw, spec.name) ? raw[spec.name] : null;
    if (r && typeof r === "object" && STATES.has(r.state)) out[spec.name] = { state: r.state, ...(typeof r.reason === "string" ? { reason: clip(r.reason) } : {}) };
  }
  return out;
}

/** Merge sanitized probe output onto a result list (runtime-phase anchors only). */
function withProbe(results, probe) {
  if (!Array.isArray(results) || !probe) return results;
  return results.map((r) => {
    if (r.phase !== "runtime" || !Object.hasOwn(probe, r.name)) return r;
    const { reason: _old, ...rest } = r;
    return { ...rest, state: probe[r.name].state, ...(probe[r.name].reason ? { reason: probe[r.name].reason } : {}) };
  });
}

module.exports = { KINDS, declarations, checkStatic, runtimeSpecs, sanitizeProbe, withProbe };
