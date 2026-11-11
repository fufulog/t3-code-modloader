"use strict";
// Anchored rewrites of T3 Code's minified client chunks, for the Usage panel.
//
// Two modules are involved:
//   UsageLimits-*.js   renders the provider list and the subscription bars.
//   usageLimits-*.js   builds the accounts/pools the bars are drawn from.
// Plus the usage page chunk's refresh command (_chat.usage-*.js).
//
// Every edit is an append/insert so it does not depend on the order T3 writes
// things in. Minified identifiers are captured with regex groups, never
// hard-coded, so the patches survive re-minification. Each anchor must match
// exactly once or the whole mod is disabled (see loader verifyMods).

const RUNTIME = "/__t3mod/commandcode-usage/runtime.js";
const IMPORT = `import ${JSON.stringify(RUNTIME)};`;

const withImport = (src) => (src.includes(IMPORT) ? src : IMPORT + src);

function replaceOnce(src, re, fn, id) {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const hits = [...src.matchAll(new RegExp(re.source, flags))];
  if (hits.length !== 1) throw new Error(`${id}: anchor matched ${hits.length}x (want 1)`);
  const m = hits[0];
  return src.slice(0, m.index) + fn(...m) + src.slice(m.index + m[0].length);
}

function replaceTextOnce(src, needle, fn, id) {
  const count = src.split(needle).length - 1;
  if (count !== 1) throw new Error(`${id}: anchor matched ${count}x (want 1)`);
  return src.replace(needle, fn);
}

const USAGE_LIMITS = /^UsageLimits-[\w-]+\.js$/;
const USAGE_DATA = /^usageLimits-[\w-]+\.js$/;
const USAGE_PAGE = /^_chat\.usage-[\w-]+\.js$/;

module.exports = [
  {
    // Append one entry to the provider metadata object. `Ne = Object.keys(Z)`
    // already feeds the provider list and the colour lookup, so this is all the
    // display needs.
    id: "provider-meta",
    file: USAGE_LIMITS,
    apply: (src) =>
      withImport(
        replaceOnce(
          src,
          /,muse:\{label:`Muse Code`,color:`#0866ff`,driverKind:([\w$]+)\.make\(`muse`\)\}\},Ne=Object\.keys\(Z\);/,
          (m, factory) =>
            `,muse:{label:\`Muse Code\`,color:\`#0866ff\`,driverKind:${factory}.make(\`muse\`)},commandcode:{label:\`Command Code\`,color:\`#e5544b\`,driverKind:${factory}.make(\`commandcode\`)}},Ne=Object.keys(Z);`,
          "provider-meta",
        ),
      ),
  },
  {
    // The pool header label comes from T3's provider registry, which has no
    // Command Code entry. Fall back to the metadata map before the raw driver.
    // The registry's minified name moves between builds (`H` in 0.1.3-nightly,
    // `h` before it, `u` in 0.1.9-nightly.20261110.4465 and up), so the registry
    // is captured, not hard-coded. The metadata map `Z` is the same module-level
    // object `provider-meta` already edits.
    id: "provider-label",
    file: USAGE_LIMITS,
    apply: (src) =>
      replaceOnce(
        src,
        /([\w$]+)\.get\(n\.driver\)\?\.label\?\?String\(n\.driver\),t\[2\]=n\.driver,t\[3\]=o\);let s=o,c;/,
        (m, registry) =>
          m.replace(
            `${registry}.get(n.driver)?.label??String(n.driver)`,
            `${registry}.get(n.driver)?.label??Z[n.driver]?.label??String(n.driver)`,
          ),
        "provider-label",
      ),
  },
  {
    // Append our account to the array the usage module returns. T3 groups it
    // into its own pool and does the window/percent maths, so the bar renders
    // exactly like a native provider's.
    id: "usage-data",
    file: USAGE_DATA,
    apply: (src) =>
      withImport(
        replaceTextOnce(
          src,
          ",limits:n.usageLimits})}}return[...t.values()]}",
          (m) => m.replace("return[...t.values()]}", "return[...t.values(),...(globalThis.__t3mod?.commandcodeUsage?.accounts?.()??[])]}"),
          "usage-data",
        ),
      ),
  },
  {
    // The usage refresh command. Run our refresh as part of it, so the UI
    // updates through T3's own re-render when the user refreshes.
    id: "usage-refresh",
    file: USAGE_PAGE,
    apply: (src) =>
      withImport(
        replaceOnce(
          src,
          /async function ([\w$]+)\(\{registry:[\w$]+,server:[\w$]+,presentations:[\w$]+,environmentIds:[\w$]+,input:[\w$]+\}\)\{/,
          (m) => `${m}await globalThis.__t3mod?.commandcodeUsage?.refresh?.();`,
          "usage-refresh",
        ),
      ),
  },
];
