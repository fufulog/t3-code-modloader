"use strict";
// Mod discovery and loading. A mod is a folder, or a .zip/.t3mod of that folder:
//
//   <id>/mod.md      manifest + description (markdown with a small frontmatter)
//   <id>/mod.cjs     optional entry, exports { patches, main }
//   <id>/client/...  static files served at /__t3mod/<id>/...
//
// Both forms go through the same MemFiles interface. A zip is read into memory and
// its code is compiled from memory; nothing is unpacked to disk. A zip may hold the
// files at its root or inside one wrapping folder (what "zip -r mod/" produces).

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readZip, cleanName } = require("./zip.cjs");

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_MANIFEST = 256 * 1024;

// ---- file sources --------------------------------------------------------------

function dirFiles(dir) {
  const root = fs.realpathSync(dir);
  const resolve = (rel) => {
    const clean = cleanName(rel);
    if (!clean) return null;
    const file = path.join(root, clean);
    try {
      const real = fs.realpathSync(file);
      return real.startsWith(root + path.sep) && fs.statSync(real).isFile() ? real : null;
    } catch {
      return null;
    }
  };
  return {
    kind: "folder",
    has: (rel) => resolve(rel) !== null,
    read: (rel) => {
      const f = resolve(rel);
      return f ? fs.readFileSync(f) : null;
    },
  };
}

function zipFiles(file) {
  const zip = readZip(fs.readFileSync(file));
  const tops = new Set(zip.names.map((n) => n.split("/")[0]));
  const hasRoot = (n) => zip.names.includes(n);
  const wrapped = tops.size === 1 && !hasRoot("mod.md") && !hasRoot("mod.cjs") && zip.names.every((n) => n.includes("/"));
  const prefix = wrapped ? [...tops][0] + "/" : "";
  return {
    kind: "zip",
    has: (rel) => zip.names.includes(prefix + rel),
    read: (rel) => zip.read(prefix + (cleanName(rel) ?? "\0")),
  };
}

// ---- manifest ---------------------------------------------------------------------

/** `---\nkey: value\n---\nmarkdown`. Values may be quoted; no nesting. */
function parseManifest(text) {
  const meta = {};
  let body = text.replace(/^﻿/, "");
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (m) {
    body = body.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/);
      if (!kv) continue;
      let v = kv[2];
      if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
      meta[kv[1].toLowerCase()] = v;
    }
  }
  return { meta, body: body.trim() };
}

// ---- discovery ----------------------------------------------------------------------

/**
 * Scan `dir` for mods. Never throws for a bad mod; it comes back with `problems`
 * and `usable: false` so the UI can say why.
 */
function inspect(location, seen = new Set()) {
  const name = path.basename(location);
  const isZip = /\.(zip|t3mod)$/i.test(name) && fs.statSync(location).isFile();
  const base = isZip ? name.replace(/\.(zip|t3mod)$/i, "") : name;
  const entry = { id: base.toLowerCase(), location, file: name, kind: isZip ? "zip" : "folder", problems: [], usable: false, files: null, name: base, version: "", author: "", description: "", markdown: "", meta: {} };
  try {
    entry.files = isZip ? zipFiles(location) : dirFiles(location);
    const manifestBuf = entry.files.read("mod.md");
    if (!manifestBuf && !entry.files.has("mod.cjs")) throw new Error("no mod.md or mod.cjs (is this a mod?)");
    if (manifestBuf) {
      if (manifestBuf.length > MAX_MANIFEST) throw new Error("mod.md is too large");
      const { meta, body } = parseManifest(manifestBuf.toString("utf8"));
      if (meta.id) entry.id = meta.id.toLowerCase();
      entry.name = meta.name || base;
      entry.version = meta.version ?? "";
      entry.author = meta.author ?? "";
      entry.description = meta.description ?? "";
      entry.markdown = body;
      entry.meta = meta;
    }
    if (!ID_RE.test(entry.id)) throw new Error(`invalid mod id "${entry.id}" (lowercase letters, digits and dashes)`);
    if (seen.has(entry.id)) throw new Error(`duplicate mod id "${entry.id}" (already provided by another file)`);
    seen.add(entry.id);
    entry.usable = true;
  } catch (e) {
    entry.problems.push(e.message);
    entry.files = null;
  }
  return entry;
}

/** Scan `dir` for mod folders and .zip/.t3mod files. A bad mod comes back with `problems`, never throws. */
function discover(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const seen = new Set();
  const found = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const location = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(location);
    } catch {
      continue;
    }
    if (stat.isDirectory() || (stat.isFile() && /\.(zip|t3mod)$/i.test(name))) found.push(inspect(location, seen));
  }
  return found;
}

// ---- code loading from memory -----------------------------------------------------------

/** Run `mod.cjs` from a file source with a CommonJS shim: relative requires resolve inside the mod. */
function loadCode(entry, realRequire) {
  if (!entry.files.has("mod.cjs")) return {};
  const { isBuiltin } = require("node:module");
  const cache = new Map();
  const candidates = (rel) => [rel, rel + ".cjs", rel + ".js", rel + ".json", rel + "/index.cjs", rel + "/index.js"];
  const makeRequire = (fromRel) => (spec) => {
    if (spec === "electron" || isBuiltin(spec)) return realRequire(spec);
    if (!spec.startsWith("./") && !spec.startsWith("../")) throw new Error(`mods can only require node built-ins, electron and their own files (got "${spec}")`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
    const rel = candidates(target).find((c) => cleanName(c) && entry.files.has(c));
    if (!rel) throw new Error(`cannot find ${spec} from ${fromRel}`);
    return load(rel);
  };
  const load = (rel) => {
    if (cache.has(rel)) return cache.get(rel).exports;
    const buf = entry.files.read(rel);
    const module = { exports: {} };
    cache.set(rel, module);
    if (rel.endsWith(".json")) {
      module.exports = JSON.parse(buf.toString("utf8"));
      return module.exports;
    }
    const filename = path.join(entry.location, rel);
    const fn = vm.compileFunction(buf.toString("utf8"), ["exports", "require", "module", "__filename", "__dirname"], { filename });
    fn.call(module.exports, module.exports, makeRequire(rel), module, filename, path.dirname(filename));
    return module.exports;
  };
  return load("mod.cjs");
}

module.exports = { discover, inspect, loadCode, parseManifest, ID_RE };
