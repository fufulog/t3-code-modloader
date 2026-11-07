"use strict";
// Anchored rewrites of T3 Code's minified client chunks.
//
// Every anchor is a string literal T3 itself uses (surface kinds, labels), and
// minified identifiers are captured from the match instead of hard-coded, so the
// patches survive re-minification across nightlies. Each required patch must
// match exactly once or the whole mod is disabled (see loader verifyMods).

const RUNTIME = "/__t3mod/commit-graph/runtime.js";
const API = "globalThis.__t3mod?.commitGraph";
const IMPORT = `import ${JSON.stringify(RUNTIME)};`;

function replaceOnce(src, re, fn, id) {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const hits = [...src.matchAll(new RegExp(re.source, flags))];
  if (hits.length !== 1) throw new Error(`${id}: anchor matched ${hits.length}x (want 1)`);
  const m = hits[0];
  return src.slice(0, m.index) + fn(...m) + src.slice(m.index + m[0].length);
}

/** The chunk's JSX runtime alias, i.e. X in `(0,X.jsx)(...)` (most frequent). */
function jsxAlias(src) {
  const counts = new Map();
  for (const m of src.matchAll(/\(0,([\w$]+)\.jsxs?\)\(/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (!best) throw new Error("no jsx runtime alias found");
  return best[0];
}

const withImport = (src) => (src.includes(IMPORT) ? src : IMPORT + src);

const STORE = /^rightPanelStore-[\w-]+\.js$/;
const PANEL = /^PanelLayoutControls-[\w-]+\.js$/;
const CHAT = /^_chat-[\w-]+\.js$/;

module.exports = [
  // ---- right panel store ----------------------------------------------------
  {
    id: "store-factory",
    file: STORE,
    apply: (src) =>
      withImport(
        replaceOnce(
          src,
          /case`pull-requests`:return\{id:`pull-requests`,kind:([\w$]+)\};/,
          (m, k) => `${m}case\`commit-graph\`:return{id:\`commit-graph\`,kind:${k}};`,
          "store-factory",
        ),
      ),
  },
  {
    // Closed-tab history ("reopen closed view") validator.
    id: "store-validator",
    file: STORE,
    apply: (src) =>
      replaceOnce(
        src,
        /case`diff`:case`files`:case`pull-requests`:return ([\w$]+)\.id===\1\.kind;/,
        (m) => m.replace("case`pull-requests`:", "case`pull-requests`:case`commit-graph`:"),
        "store-validator",
      ),
  },

  // ---- panel chrome: tab title, tab icon, launchers --------------------------
  {
    id: "panel-title",
    file: PANEL,
    apply: (src) =>
      withImport(
        replaceOnce(src, /case`pull-requests`:return`Pull requests`;/, (m) => `${m}case\`commit-graph\`:return\`Commit Graph\`;`, "panel-title"),
      ),
  },
  {
    id: "panel-icon",
    file: PANEL,
    apply: (src) =>
      replaceOnce(
        src,
        /case`pull-requests`:\{let ([\w$]+);return [\w$]+\[\d+\]===Symbol\.for\(`react\.memo_cache_sentinel`\)\?\(\1=\(0,([\w$]+)\.jsx\)\(/,
        (m, _v, j) =>
          `case\`commit-graph\`:return ${API}?.Icon?(0,${j}.jsx)(${API}.Icon,{className:\`size-3 shrink-0\`,jsx:${j}.jsx}):null;${m}`,
        "panel-icon",
      ),
  },
  {
    // Empty-state "Open a surface" launcher: insert right after "Pull request".
    id: "panel-launcher",
    file: PANEL,
    apply: (src) => {
      const j = jsxAlias(src);
      return replaceOnce(
        src,
        /(\{label:`Pull request`,icon:[\w$.]+,shortcut:`P`,available:[\w$]+\.pullRequestAvailable,disabledReason:[\w$]+\.pullRequest,onClick:[\w$]+\.onAddPullRequest\}),(?=\{label:`Linked pull requests`)/,
        (m, item) => `${item},...(${API}?.menuItems(${j})??[]),`,
        "panel-launcher",
      );
    },
  },
  {
    // Tab-strip "+" menu: items are memoised into an array literal.
    id: "panel-add-menu",
    file: PANEL,
    apply: (src) => {
      const j = jsxAlias(src);
      const decl = [...src.matchAll(/\(([\w$]+)=\{label:`Pull request`,/g)];
      if (decl.length !== 1) throw new Error(`panel-add-menu: decl matched ${decl.length}x`);
      const name = decl[0][1];
      const re = new RegExp(`=\\[((?:[\\w$]+,)*)${name.replace(/\$/g, "\\$")},`, "g");
      re.lastIndex = decl[0].index;
      const arr = re.exec(src);
      if (!arr || arr.index - decl[0].index > 4000) throw new Error("panel-add-menu: item array not found");
      const replacement = `=[${arr[1]}${name},...(${API}?.menuItems(${j})??[]),`;
      return src.slice(0, arr.index) + replacement + src.slice(arr.index + arr[0].length);
    },
  },
  {
    // Don't render an empty shortcut pill for items without a hotkey.
    id: "panel-kbd",
    file: PANEL,
    apply: (src) => src.replace(/\(0,([\w$]+)\.jsx\)\(([\w$]+),\{children:([\w$]+)\.shortcut\}\)/g, (m, _j, _c, v) => `(${v}.shortcut?${m}:null)`),
  },

  // ---- chat view: opener binding + surface renderer ---------------------------
  {
    // Where T3 builds its "open linked pull requests" handler it has the thread
    // ref and the store in scope; hand both to the runtime.
    id: "chat-opener",
    file: CHAT,
    apply: (src) =>
      withImport(
        replaceOnce(
          src,
          /\(([\w$]+)=\(\)=>\{([\w$]+)&&([\w$]+)&&([\w$]+)\.getState\(\)\.open\(\2,`pull-requests`\)\},/,
          (m, _h, ref, _avail, store) => `(${API}?.bindOpener(${ref},${store}),${m.slice(1)}`,
          "chat-opener",
        ),
      ),
  },
  {
    id: "chat-render",
    file: CHAT,
    apply: (src) => {
      const susp = [...src.matchAll(/\(0,([\w$]+)\.jsx\)\(([\w$]+)\.Suspense,\{fallback:null,children:\(0,[\w$]+\.jsx\)\([\w$]+,\{mode:`embedded`,threadRef:([\w$]+),surface:([\w$]+),visible:([\w$]+)/g)];
      if (susp.length !== 1) throw new Error(`chat-render: device anchor matched ${susp.length}x`);
      const [, j, react, ref, surface, visible] = susp[0];
      const files = [...src.matchAll(/case`files`:case`file`:\{let [\w$]+=([\w$]+)\.files/g)];
      if (files.length !== 1) throw new Error(`chat-render: files anchor matched ${files.length}x`);
      const props = files[0][1];
      return replaceOnce(
        src,
        /case`pull-requests`:\{let ([\w$]+);return [\w$]+\[\d+\]===([\w$]+)\?/,
        (m) =>
          `case\`commit-graph\`:return ${API}?.Surface?(0,${j}.jsx)(${API}.Surface,{React:${react},jsx:${j}.jsx,threadRef:${ref},surface:${surface},visible:${visible},environmentId:${props}.environmentId,workspaceRoot:${props}.files?.workspaceRoot??null,projectName:${props}.files?.projectName??null}):null;${m}`,
        "chat-render",
      );
    },
  },
];
