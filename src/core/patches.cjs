"use strict";
// Adds a "Mods" button to the sidebar footer, right after "Usage", and loads the
// core runtime into the app. Same anchoring rules as any mod (see mods/*/patches.cjs).

const RUNTIME = "/__t3mod/core/runtime.js";
const API = "globalThis.__t3mod?.core";
const IMPORT = `import ${JSON.stringify(RUNTIME)};`;

module.exports = [
  {
    id: "sidebar-mods-button",
    file: /^main-[\w-]+\.js$/,
    apply: (src) => {
      // (0,J.jsx)(Btn,{icon:(0,J.jsx)(Ic,{}),label:`Usage`,onClick:h})
      const re = /\(0,([\w$]+)\.jsx\)\(([\w$]+),\{icon:\(0,\1\.jsx\)\([\w$]+,\{\}\),label:`Usage`,onClick:[\w$]+\}\)/g;
      const hits = [...src.matchAll(re)];
      if (hits.length !== 1) throw new Error(`sidebar-mods-button: anchor matched ${hits.length}x (want 1)`);
      const [m, j, btn] = hits[0];
      const button = `(0,${j}.jsx)(${btn},{icon:${API}?.icon?.(${j}.jsx)??null,label:\`Mods\`,onClick:()=>${API}?.open?.()})`;
      const out = src.slice(0, hits[0].index) + m + "," + button + src.slice(hits[0].index + m.length);
      return out.includes(IMPORT) ? out : IMPORT + out;
    },
  },
];
