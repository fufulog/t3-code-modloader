// Commit Graph surface: renderer runtime.
//
// Loaded as an ES module by the patched client chunks (import "/__t3mod/...").
// Exposes globalThis.__t3mod.commitGraph = { Surface, Icon, menuItems, bindOpener }.
// The view itself is plain DOM inside one React host element, so it does not
// depend on T3's React internals beyond the props the patch passes in.

import { scope } from "/__t3mod/kit.js";

const NS = (globalThis.__t3mod ??= {});
const S = scope("commit-graph"); // registration helpers: a failed setup is undone and reported to the loader
S.run(() => {
if (!NS.commitGraph) {
  const STYLE_URL = new URL("./style.css", import.meta.url).href;
  const CHANNEL = "t3mod:commit-graph:git";
  const ROW_H = 24;
  const LANE_W = 12;
  const NODE_R = 4;
  const COLORS = ["#0085d9", "#d9008f", "#00d90a", "#d98500", "#a300d9", "#ff0000", "#00d9cc", "#e138e8", "#85d900", "#dc5b23", "#6f24d6", "#ffcc00"];
  const UNCOMMITTED = "#808080";
  const PAGE = 300;

  // ---- bridge -------------------------------------------------------------------
  const git = async (op, params) => {
    const bridge = window.t3mod;
    if (!bridge) throw new Error("Commit Graph needs the T3 desktop app (mod bridge not loaded)");
    const r = await bridge.invoke(CHANNEL, { op, ...params });
    if (!r?.ok) throw new Error(r?.error ?? "git failed");
    return r.data;
  };
  const showMenu = async (ev, items) => {
    ev.preventDefault();
    ev.stopPropagation();
    const bridge = window.desktopBridge;
    if (!bridge?.showContextMenu) return null;
    return bridge.showContextMenu(items.filter(Boolean), { x: ev.clientX, y: ev.clientY });
  };
  // Resolves true when the text reached the clipboard. Falls back to execCommand when the
  // async clipboard API is missing or refused (e.g. the window is not focused).
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  };
  // Copy, then swap the button's icon to a check for a moment.
  const copyWithFeedback = async (el) => {
    const ok = await copy(el.dataset.copy);
    el.classList.toggle("t3cg-copied", ok);
    el.classList.toggle("t3cg-copy-failed", !ok);
    clearTimeout(el._t3cgCopyTimer);
    el._t3cgCopyTimer = setTimeout(() => el.classList.remove("t3cg-copied", "t3cg-copy-failed"), 1400);
  };

  // ---- opener / menu ------------------------------------------------------------
  const opener = { ref: null, store: null };
  let jsxRuntime = null;
  // VS Code Codicon "git-branch", the same glyph as the toolbar branch filter.
  const ICON_PATH = "M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z";
  function Icon(props) {
    const jsx = props?.jsx ?? jsxRuntime;
    if (!jsx) return null;
    return jsx("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 16 16",
      fill: "currentColor",
      className: props?.className,
      "aria-hidden": true,
      children: jsx("path", { d: ICON_PATH }),
    });
  }
  const launcherItem = {
    label: "Commit Graph",
    description: "Branches and commits, with Git Graph-style actions.",
    icon: Icon,
    shortcut: "",
    get available() {
      return !!(opener.ref && opener.store);
    },
    disabledReason: "Open a thread to view its repository.",
    onClick: () => opener.ref && opener.store?.getState().open(opener.ref, "commit-graph"),
  };
  const items = [launcherItem];
  function menuItems(jsxNs) {
    if (jsxNs?.jsx) jsxRuntime = jsxNs.jsx;
    return items;
  }
  function bindOpener(ref, store) {
    opener.ref = ref ?? null;
    opener.store = store ?? null;
  }

  // ---- helpers --------------------------------------------------------------------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const short = (h) => (h ? h.slice(0, 8) : "");
  // Status letters for the files popdown. Git's "A" is shown as "U" (new).
  const STATUS_LETTER = { A: "U" };
  // File-type icons: Material Icon Theme (VS Code's look), vendored by bin/vendor-icons.mjs.
  const ICON_BASE = new URL("./icons/", import.meta.url).href;
  let iconMap = null;
  const iconMapReady = fetch(new URL("map.json", ICON_BASE))
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => (iconMap = m))
    .catch(() => null);
  const isLightTheme = () => !document.documentElement.classList.contains("dark");
  // VS Code's order: exact file name, then the longest dotted suffix (d.ts before ts), then the default.
  const fileIcon = (filePath) => {
    if (!iconMap) return null;
    const name = filePath.split("/").pop().toLowerCase();
    const light = isLightTheme() ? iconMap.light : null;
    let icon = light?.names[name] ?? iconMap.names[name];
    for (let i = name.indexOf("."); !icon && i !== -1; i = name.indexOf(".", i + 1)) {
      const ext = name.slice(i + 1);
      icon = light?.ext[ext] ?? iconMap.ext[ext];
    }
    return `${ICON_BASE}${icon ?? iconMap.file}.svg`;
  };
  const fmtFullDate = (sec) => new Date(sec * 1000).toLocaleString(undefined, { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const fmtAgo = (sec) => {
    const s = Math.max(0, Date.now() / 1000 - sec);
    const units = [
      [31536000, "year"],
      [2592000, "month"],
      [604800, "week"],
      [86400, "day"],
      [3600, "hour"],
      [60, "minute"],
    ];
    for (const [size, name] of units) {
      const n = Math.floor(s / size);
      if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
    return "just now";
  };
  // Git bodies are hard-wrapped at ~72 columns. Re-flow plain paragraphs so the card wraps
  // naturally; keep line breaks in lists, indented blocks and trailers.
  const reflow = (msg) =>
    String(msg ?? "")
      .split(/\n{2,}/)
      .map((para) => (/^\s*([-*•+]|\d+[.)]|\s{2,}|[A-Z][\w-]+: )/m.test(para) ? para : para.replace(/\s*\n\s*/g, " ")))
      .join("\n\n");
  const initials = (name) =>
    String(name ?? "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "?";
  // find, fetch, pull, push, refresh and menu are VS Code Codicons 0.0.45 (CC BY 4.0, https://github.com/microsoft/vscode-codicons).
  const SVG = {
    branch: `<svg viewBox="0 0 16 16" class="t3cg-ico"><path fill="currentColor" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z"/></svg>`,
    tag: `<svg viewBox="0 0 16 16" class="t3cg-ico"><path fill="currentColor" d="M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25zM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>`,
    stash: `<svg viewBox="0 0 16 16" class="t3cg-ico"><path fill="currentColor" d="M2.75 2h10.5c.966 0 1.75.784 1.75 1.75v1.5A1.75 1.75 0 0 1 14 6.79v5.46A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25V6.79A1.75 1.75 0 0 1 1 5.25v-1.5C1 2.784 1.784 2 2.75 2zm.75 5v5.25c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V7zm-.75-3.5a.25.25 0 0 0-.25.25v1.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-1.5a.25.25 0 0 0-.25-.25zM6 8.75A.75.75 0 0 1 6.75 8h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 6 8.75z"/></svg>`,
    find: `<svg viewBox="0 0 16 16" class="t3cg-ico" fill="currentColor"><path d="M10.0195 10.7266C9.06578 11.5217 7.83875 12 6.5 12C3.46243 12 1 9.53757 1 6.5C1 3.46243 3.46243 1 6.5 1C9.53757 1 12 3.46243 12 6.5C12 7.83875 11.5217 9.06578 10.7266 10.0195L13.8535 13.1464C14.0488 13.3417 14.0488 13.6583 13.8535 13.8536C13.6583 14.0488 13.3417 14.0488 13.1464 13.8536L10.0195 10.7266ZM11 6.5C11 4.01472 8.98528 2 6.5 2C4.01472 2 2 4.01472 2 6.5C2 8.98528 4.01472 11 6.5 11C8.98528 11 11 8.98528 11 6.5Z"/></svg>`,
    refresh: `<svg viewBox="0 0 16 16" class="t3cg-ico" fill="currentColor"><path d="M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z"/></svg>`,
    pull: `<svg viewBox="0 0 16 16" class="t3cg-ico" fill="currentColor"><path d="M4.85 6.15C4.755 6.05 4.627 6 4.5 6C4.372 6 4.245 6.05 4.15 6.15C4.05 6.245 4 6.373 4 6.5C4 6.627 4.05 6.755 4.15 6.85L7.15 9.85C7.245 9.95 7.372 10 7.5 10C7.628 10 7.755 9.95 7.85 9.85L10.85 6.85C10.95 6.755 11 6.628 11 6.5C11 6.372 10.95 6.245 10.85 6.15C10.755 6.05 10.627 6 10.5 6C10.373 6 10.245 6.05 10.15 6.15L8 8.29V1.5C8 1.22 7.78 1 7.5 1C7.22 1 7 1.22 7 1.5V8.29L4.85 6.15Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM6.09 14C6.29 14.58 6.85 15 7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14Z"/></svg>`,
    push: `<svg viewBox="0 0 16 16" class="t3cg-ico" fill="currentColor"><path d="M4.85 4.85C4.755 4.95 4.627 5 4.5 5C4.372 5 4.245 4.95 4.15 4.85C4.05 4.755 4 4.627 4 4.5C4 4.373 4.05 4.245 4.15 4.15L7.15 1.15C7.245 1.05 7.372 1 7.5 1C7.628 1 7.755 1.05 7.85 1.15L10.85 4.15C10.95 4.245 11 4.372 11 4.5C11 4.628 10.95 4.755 10.85 4.85C10.755 4.95 10.627 5 10.5 5C10.373 5 10.245 4.95 10.15 4.85L8 2.71V9.5C8 9.78 7.78 10 7.5 10C7.22 10 7 9.78 7 9.5V2.71L4.85 4.85Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM6.09 14C6.29 14.58 6.85 15 7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14Z"/></svg>`,
    menu: `<svg viewBox="0 0 16 16" class="t3cg-ico" fill="currentColor"><path d="M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z"/></svg>`,
    fetch: `<svg viewBox="0 0 16 16" class="t3cg-ico" fill="currentColor"><path d="M7.5 3C7.776 3 8 2.776 8 2.5V1.5C8 1.224 7.776 1 7.5 1C7.224 1 7 1.224 7 1.5V2.5C7 2.776 7.224 3 7.5 3Z"/><path d="M7.5 10C7.372 10 7.245 9.95 7.15 9.85L4.15 6.85C4.05 6.755 4 6.628 4 6.5C4 6.372 4.05 6.245 4.15 6.15C4.245 6.05 4.373 6 4.5 6C4.627 6 4.755 6.05 4.85 6.15L7 8.29V7.5C7 7.22 7.22 7 7.5 7C7.78 7 8 7.22 8 7.5V8.29L10.15 6.15C10.245 6.05 10.372 6 10.5 6C10.628 6 10.755 6.05 10.85 6.15C10.95 6.245 11 6.373 11 6.5C11 6.627 10.95 6.755 10.85 6.85L7.85 9.85C7.755 9.95 7.628 10 7.5 10Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14C6.29 14.58 6.85 15 7.5 15Z"/><path d="M8 5.5C8 5.776 7.776 6 7.5 6C7.224 6 7 5.776 7 5.5V4.5C7 4.224 7.224 4 7.5 4C7.776 4 8 4.224 8 4.5V5.5Z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18 6 6 18M6 6l12 12"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" class="t3cg-ico t3cg-ico-copy"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></g></svg>`,
    check: `<svg viewBox="0 0 24 24" class="t3cg-ico t3cg-ico-check"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M20 6 9 17l-5-5"/></svg>`,
    back: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M19 12H5m7 7-7-7 7-7"/></svg>`,
    diff: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v14M5 10h14M5 21h14"/></svg>`,
    legacy: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2"/></svg>`,
    file: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/></svg>`,
    up: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m18 15-6-6-6 6"/></svg>`,
    down: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" class="t3cg-ico t3cg-chev"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>`,
  };

  let styleLoaded = false;
  function ensureStyle() {
    if (styleLoaded) return;
    styleLoaded = true;
    S.style(STYLE_URL);
  }

  // ---- graph layout ---------------------------------------------------------------
  /**
   * rows: [{ hash, parents, kind: 'commit'|'stash'|'uncommitted' }]
   * Lanes are never compacted: a lane keeps its column until its line ends, and
   * new lines reuse the leftmost free column. Each row stores the lanes entering
   * from above (`before`), leaving below (`after`), the node column, and which
   * columns the node connects to below.
   */
  function layout(rows) {
    const lanes = [];
    let colorSeq = 0;
    const nextColor = () => COLORS[colorSeq++ % COLORS.length];
    const free = (exclude) => {
      for (let i = 0; i < lanes.length; i++) if (!lanes[i] && !exclude.has(i)) return i;
      return lanes.length;
    };
    let width = 1;
    const out = [];
    for (const row of rows) {
      const before = lanes.map((l) => l && { ...l });
      let idx = lanes.findIndex((l) => l && l.hash === row.hash);
      let color;
      if (idx < 0) {
        idx = free(new Set());
        color = row.kind === "uncommitted" ? UNCOMMITTED : nextColor();
      } else {
        color = lanes[idx].dashed && row.kind !== "uncommitted" ? nextColor() : lanes[idx].color;
      }
      for (let i = 0; i < lanes.length; i++) if (i !== idx && lanes[i]?.hash === row.hash) lanes[i] = null;
      lanes[idx] = null;
      const parents = row.kind === "stash" ? row.parents.slice(0, 1) : row.parents;
      const conns = [];
      const reserved = new Set([idx]);
      parents.forEach((p, pi) => {
        const existing = lanes.findIndex((l) => l && l.hash === p);
        if (existing >= 0) {
          conns.push({ lane: existing, color: pi === 0 ? color : lanes[existing].color, dashed: row.kind === "uncommitted" });
          return;
        }
        let lane;
        if (pi === 0) lane = idx;
        else {
          lane = free(reserved);
          reserved.add(lane);
        }
        const c = pi === 0 ? color : nextColor();
        lanes[lane] = { hash: p, color: c, dashed: row.kind === "uncommitted" };
        conns.push({ lane, color: c, dashed: row.kind === "uncommitted" });
      });
      while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
      const after = lanes.map((l) => l && { ...l });
      width = Math.max(width, before.length, after.length, idx + 1);
      out.push({ before, after, idx, color, conns });
    }
    return { rows: out, width };
  }

  const X = (i) => LANE_W / 2 + i * LANE_W;
  const curve = (x1, y1, x2, y2) => (x1 === x2 ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`);
  const pathEl = (d, color, dashed) => `<path d="${d}" stroke="${color}"${dashed ? ' stroke-dasharray="2 2"' : ""}/>`;

  // Lanes a row actually draws in: its own node, lines passing through, and lines leaving it.
  // Rows are sized to this, so the text indents and un-indents with the graph, like VS Code.
  const lastLane = (lanes) => {
    for (let i = lanes.length - 1; i >= 0; i--) if (lanes[i]) return i + 1;
    return 0;
  };
  const rowLanes = (g) => Math.max(1, g.idx + 1, lastLane(g.before), lastLane(g.after), ...g.conns.map((c) => c.lane + 1));

  function rowSvg(g, kind, isHead) {
    const mid = ROW_H / 2;
    let paths = "";
    // Lines from above either end in this node or pass straight through (lanes
    // keep their column, see layout()).
    g.before.forEach((l, i) => {
      if (!l) return;
      if (l.hash === g.hashOf) paths += pathEl(curve(X(i), 0, X(g.idx), mid), l.color, l.dashed);
      else paths += pathEl(`M${X(i)} 0L${X(i)} ${ROW_H}`, l.color, l.dashed);
    });
    for (const c of g.conns) paths += pathEl(curve(X(g.idx), mid, X(c.lane), ROW_H), c.color, c.dashed);
    const cx = X(g.idx);
    let node;
    if (kind === "uncommitted") node = `<circle cx="${cx}" cy="${mid}" r="${NODE_R}" class="t3cg-node-hollow" stroke="${UNCOMMITTED}"/>`;
    else if (kind === "stash") node = `<circle cx="${cx}" cy="${mid}" r="${NODE_R + 0.5}" class="t3cg-node-hollow" stroke="${g.color}"/><circle cx="${cx}" cy="${mid}" r="2" fill="${g.color}"/>`;
    else if (isHead) node = `<circle cx="${cx}" cy="${mid}" r="${NODE_R}" class="t3cg-node-hollow" stroke="${g.color}"/>`;
    else node = `<circle cx="${cx}" cy="${mid}" r="${NODE_R}" fill="${g.color}"/>`;
    const w = rowLanes(g) * LANE_W;
    return `<svg class="t3cg-graph" width="${w}" height="${ROW_H}" viewBox="0 0 ${w} ${ROW_H}">${paths}${node}</svg>`;
  }

  function continuationSvg(after) {
    const w = Math.max(1, lastLane(after)) * LANE_W;
    let paths = "";
    after.forEach((l, i) => {
      if (l) paths += `<path d="M${X(i)} 0L${X(i)} 1" stroke="${l.color}" vector-effect="non-scaling-stroke"${l.dashed ? ' stroke-dasharray="2 2"' : ""}/>`;
    });
    return `<svg class="t3cg-graph t3cg-graph-cont" width="${w}" height="100%" viewBox="0 0 ${w} 1" preserveAspectRatio="none">${paths}</svg>`;
  }

  // ---- dialog -----------------------------------------------------------------------
  // Close a popover on an outside mousedown or Escape. Clicks on its own button are left to the button.
  function dismissable(dd, btn) {
    const close = () => {
      dd.remove();
      document.removeEventListener("mousedown", away, true);
    };
    const away = (e) => {
      if (!dd.isConnected) return document.removeEventListener("mousedown", away, true);
      if (!dd.contains(e.target) && !btn.contains(e.target)) close();
    };
    document.addEventListener("mousedown", away, true);
    dd.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    });
  }

  function dialog(root, { title, message, inputs = [], action = "OK", destructive = false, cancel = "Cancel", wide = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "t3cg-overlay";
      const fields = inputs
        .map((inp, i) => {
          const id = `t3cg-in-${i}`;
          if (inp.type === "checkbox")
            return `<label class="t3cg-check"><input type="checkbox" data-name="${esc(inp.name)}" ${inp.value ? "checked" : ""}/> <span>${esc(inp.label)}</span></label>`;
          if (inp.type === "select")
            return `<label class="t3cg-field" for="${id}"><span>${esc(inp.label)}</span><select id="${id}" data-name="${esc(inp.name)}">${inp.options
              .map((o) => `<option value="${esc(o.value)}" ${o.value === inp.value ? "selected" : ""}>${esc(o.label)}</option>`)
              .join("")}</select></label>`;
          return `<label class="t3cg-field" for="${id}"><span>${esc(inp.label)}</span><input id="${id}" type="text" spellcheck="false" data-name="${esc(inp.name)}" value="${esc(inp.value ?? "")}" placeholder="${esc(inp.placeholder ?? "")}"/></label>`;
        })
        .join("");
      overlay.innerHTML = `<div class="t3cg-dialog${wide ? " t3cg-dialog-wide" : ""}" role="dialog" aria-modal="true">
        ${title ? `<div class="t3cg-dialog-title">${esc(title)}</div>` : ""}
        <div class="t3cg-dialog-msg">${message ?? ""}</div>
        ${fields ? `<div class="t3cg-dialog-fields">${fields}</div>` : ""}
        <div class="t3cg-dialog-buttons">
          ${cancel ? `<button type="button" class="t3cg-btn" data-act="cancel">${esc(cancel)}</button>` : ""}
          ${action ? `<button type="button" class="t3cg-btn t3cg-btn-primary${destructive ? " t3cg-btn-destructive" : ""}" data-act="ok">${esc(action)}</button>` : ""}
        </div></div>`;
      const done = (ok) => {
        overlay.remove();
        if (!ok) return resolve(null);
        const values = {};
        overlay.querySelectorAll("[data-name]").forEach((el) => {
          values[el.dataset.name] = el.type === "checkbox" ? el.checked : el.value.trim();
        });
        resolve(values);
      };
      overlay.addEventListener("mousedown", (e) => e.target === overlay && done(false));
      overlay.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act) done(act === "ok");
      });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          done(false);
        } else if (e.key === "Enter" && e.target.tagName !== "SELECT" && action) {
          e.preventDefault();
          done(true);
        }
      });
      root.appendChild(overlay);
      (overlay.querySelector("input[type=text]") ?? overlay.querySelector("[data-act=ok]") ?? overlay.querySelector("button"))?.focus();
      overlay.querySelector("input[type=text]")?.select();
    });
  }

  // ---- the view ---------------------------------------------------------------------
  const STORAGE = "t3mod:commit-graph:v1";
  const LEGACY_KEY = "t3mod:commit-graph:legacy-diff";
  const loadPrefs = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE)) ?? {};
    } catch {
      return {};
    }
  };
  const savePrefs = (p) => localStorage.setItem(STORAGE, JSON.stringify(p));

  class GraphView {
    constructor(host) {
      ensureStyle();
      this.host = host;
      this.cwd = null;
      this.visible = true;
      this.maxCommits = PAGE;
      this.data = null;
      this.expanded = new Map(); // key -> { key, details, row }; any number of commits can be open
      this.fingerprint = null;
      this.find = { open: false, q: "", matches: [], cur: -1 };
      this.loadSeq = 0;
      this.prefs = loadPrefs();
      this.prefs.widths ??= {};
      host.innerHTML = `
        <div class="t3cg" tabindex="-1">
          <div class="t3cg-repo"><span class="t3cg-repo-name"></span></div>
          <div class="t3cg-toolbar">
            <button type="button" class="t3cg-dd-btn" data-act="branches" title="Branches" aria-label="Branches"><span class="t3cg-muted t3cg-dd-ico">${SVG.branch}</span><span class="t3cg-dd-label">All</span>${SVG.chevron}</button>
            <div class="t3cg-state"></div>
            <div class="t3cg-spacer"></div>
            <span class="t3cg-status"></span>
            <button type="button" class="t3cg-icon-btn" data-act="find" title="Find (Ctrl+F)">${SVG.find}</button>
            <button type="button" class="t3cg-icon-btn" data-act="fetch" title="Fetch from remote(s)">${SVG.fetch}</button>
            <button type="button" class="t3cg-icon-btn" data-act="pull" title="Pull">${SVG.pull}</button>
            <button type="button" class="t3cg-icon-btn" data-act="push" title="Push">${SVG.push}</button>
            <button type="button" class="t3cg-icon-btn" data-act="refresh" title="Refresh">${SVG.refresh}</button>
            <button type="button" class="t3cg-icon-btn" data-act="menu" title="More actions">${SVG.menu}</button>
          </div>
          <div class="t3cg-findbar" hidden>
            <input type="text" spellcheck="false" placeholder="Find commits (message, hash, author, branch)"/>
            <span class="t3cg-find-count"></span>
            <button type="button" class="t3cg-icon-btn" data-act="find-prev" title="Previous (Shift+Enter)">${SVG.up}</button>
            <button type="button" class="t3cg-icon-btn" data-act="find-next" title="Next (Enter)">${SVG.down}</button>
            <button type="button" class="t3cg-icon-btn" data-act="find-close" title="Close (Escape)">${SVG.close}</button>
          </div>
          <div class="t3cg-scroll">
            <table class="t3cg-table">
              <tbody></tbody>
            </table>
            <div class="t3cg-message"></div>
          </div>
        </div>`;
      this.root = host.firstElementChild;
      this.$ = (sel) => this.root.querySelector(sel);
      this.tbody = this.$("tbody");
      this.scroller = this.$(".t3cg-scroll");
      // Hover card: one element reused for every commit. It lives on <body> so it can sit
      // outside the panel, to the left of the hovered row (the mirror of VS Code's Git Graph).
      this.card = document.createElement("div");
      this.card.className = "t3cg-card";
      this.card.hidden = true;
      document.body.appendChild(this.card);
      this.card.addEventListener("mouseenter", () => clearTimeout(this.hideTimer));
      this.card.addEventListener("mouseleave", () => this.scheduleHide());
      this.card.addEventListener("click", (e) => {
        const copyEl = e.target.closest("[data-copy]");
        if (copyEl) copyWithFeedback(copyEl);
      });
      this.cardI = null;
      this.hoverTimer = null;
      this.hideTimer = null;
      this.detailCache = new Map(); // full hash -> details, so hovering twice doesn't refetch
      this.bind();
      this.timer = setInterval(() => this.poll(), 3000);
      this.onFocus = () => this.poll();
      window.addEventListener("focus", this.onFocus);
    }

    destroy() {
      clearInterval(this.timer);
      clearTimeout(this.hoverTimer);
      clearTimeout(this.hideTimer);
      window.removeEventListener("focus", this.onFocus);
      this.card.remove();
      this.host.innerHTML = "";
    }

    setProps({ cwd, visible, threadRef, t3 }) {
      this.threadRef = threadRef;
      this.t3 = t3;
      this.visible = visible !== false;
      if (cwd !== this.cwd) {
        this.cwd = cwd;
        this.maxCommits = PAGE;
        this.expanded.clear();
        this.data = null;
        this.fingerprint = null;
        this.detailCache.clear();
        this.hideCard();
        this.load({ reset: true });
      }
    }

    // ---- prefs per repo
    repoPrefs() {
      const key = this.data?.info.root ?? this.cwd ?? "";
      this.prefs.repos ??= {};
      return (this.prefs.repos[key] ??= {});
    }

    setStatus(text) {
      this.$(".t3cg-status").textContent = text ?? "";
    }

    showMessage(html) {
      const m = this.$(".t3cg-message");
      m.innerHTML = html ?? "";
      m.hidden = !html;
    }

    async load({ reset = false } = {}) {
      if (!this.cwd) {
        this.tbody.innerHTML = "";
        this.showMessage(`<div>This thread has no workspace folder.</div>`);
        return;
      }
      const seq = ++this.loadSeq;
      if (reset) {
        this.tbody.innerHTML = "";
        this.showMessage(`<div class="t3cg-muted">Loading commits…</div>`);
      }
      try {
        const rp = this.repoPrefs();
        const branches = Array.isArray(rp.branches) && rp.branches.length ? rp.branches : null;
        const data = await git("log", {
          cwd: this.cwd,
          maxCommits: this.maxCommits,
          showRemoteBranches: this.prefs.showRemote !== false,
          branches,
        });
        if (seq !== this.loadSeq) return;
        this.data = data;
        this.fingerprint = await git("fingerprint", { cwd: this.cwd }).catch(() => null);
        this.render();
      } catch (e) {
        if (seq !== this.loadSeq) return;
        if (branches_missing(e) && this.repoPrefs().branches) {
          this.repoPrefs().branches = null;
          savePrefs(this.prefs);
          return this.load({ reset });
        }
        this.tbody.innerHTML = "";
        this.showMessage(`<div class="t3cg-error">${esc(e.message)}</div><button type="button" class="t3cg-btn" data-act="refresh">Retry</button>`);
      }
      function branches_missing(err) {
        return /does not resolve|invalid ref/.test(err.message);
      }
    }

    async poll() {
      if (!this.visible || !this.cwd || document.visibilityState !== "visible" || this.busy) return;
      try {
        const fp = await git("fingerprint", { cwd: this.cwd });
        if (this.fingerprint && fp !== this.fingerprint) this.load();
      } catch {}
    }

    // ---- rows
    buildRows() {
      const { commits, stashes, info } = this.data;
      const rows = commits.map((c) => ({ ...c, kind: "commit" }));
      // Stashes sit just above their base commit (Git Graph places them by date).
      const present = new Set(rows.map((r) => r.hash));
      for (const s of [...stashes].sort((a, b) => a.date - b.date)) {
        if (!present.has(s.base)) continue;
        const baseIdx = rows.findIndex((r) => r.hash === s.base);
        let at = baseIdx;
        while (at > 0 && rows[at - 1].date < s.date) at--;
        rows.splice(at, 0, { hash: s.hash, parents: [s.base], kind: "stash", subject: s.subject, author: s.author, email: s.email, date: s.date, selector: s.selector });
      }
      if (info.uncommitted > 0 && info.headHash && present.has(info.headHash)) {
        rows.unshift({ hash: "*", parents: [info.headHash], kind: "uncommitted", subject: `Uncommitted Changes (${info.uncommitted})`, author: "*", date: Date.now() / 1000 });
      }
      return rows;
    }

    refsByCommit() {
      const { refs, info } = this.data;
      const map = new Map();
      const add = (h, r) => (map.get(h) ?? map.set(h, []).get(h)).push(r);
      const remotesUsed = new Set();
      for (const b of refs.heads) {
        const remotes = refs.remotes.filter((r) => r.branch === b.name && r.hash === b.hash);
        remotes.forEach((r) => remotesUsed.add(r.ref));
        add(b.hash, { type: "head", name: b.name, current: b.current, remotes: remotes.map((r) => r.remote), data: b });
      }
      for (const r of refs.remotes) if (!remotesUsed.has(r.ref)) add(r.hash, { type: "remote", name: r.name, data: r });
      for (const t of refs.tags) add(t.hash, { type: "tag", name: t.name, data: t });
      if (!info.branch && info.headHash) add(info.headHash, { type: "detached", name: "HEAD" });
      for (const list of map.values())
        list.sort((a, b) => (b.current === true) - (a.current === true) || ["detached", "head", "remote", "tag"].indexOf(a.type) - ["detached", "head", "remote", "tag"].indexOf(b.type));
      return map;
    }

    render() {
      const { info } = this.data;
      const scrollTop = this.scroller.scrollTop;
      this.hideCard(); // rows are about to be replaced, so a card for the old row would point at nothing
      this.$(".t3cg-repo-name").innerHTML = `${esc(info.name)}${info.branch ? ` <span class="t3cg-muted">on</span> ${SVG.branch}<span>${esc(info.branch)}</span>` : ` <span class="t3cg-muted">(detached HEAD)</span>`}`;
      const rp = this.repoPrefs();
      this.$(".t3cg-dd-label").textContent = rp.branches?.length ? (rp.branches.length === 1 ? rp.branches[0].replace(/^refs\/(heads|remotes)\//, "") : `${rp.branches.length} selected`) : "All";
      const st = this.$(".t3cg-state");
      st.innerHTML = info.state
        ? `<span class="t3cg-state-pill">${esc(info.state[0].toUpperCase() + info.state.slice(1))}…</span>${info.state !== "merging" ? `<button type="button" class="t3cg-btn t3cg-btn-sm" data-act="continue">Continue</button>` : ""}<button type="button" class="t3cg-btn t3cg-btn-sm" data-act="abort">Abort</button>`
        : "";

      this.rows = this.buildRows();
      const lay = layout(this.rows);
      this.layout = lay;

      const refMap = this.refsByCommit();
      const html = [];
      this.rows.forEach((row, i) => {
        const g = lay.rows[i];
        g.hashOf = row.hash;
        const refs = refMap.get(row.hash) ?? [];
        const isHead = row.kind === "commit" && row.hash === info.headHash;
        const merge = row.kind === "commit" && row.parents.length > 1;
        const labels = refs.map((r) => this.labelHtml(r, g.color)).join("");
        const stashLabel = row.kind === "stash" ? `<span class="t3cg-ref t3cg-ref-stash" data-ref-type="stash">${SVG.stash}<span>${esc(row.selector)}</span></span>` : "";
        const key = row.kind === "uncommitted" ? "*" : row.hash;
        const cls = ["t3cg-row", merge ? "t3cg-merge" : "", isHead ? "t3cg-head" : "", row.kind === "uncommitted" ? "t3cg-uncommitted" : "", this.expanded.has(key) ? "t3cg-expanded" : ""].filter(Boolean).join(" ");
        html.push(`<tr class="${cls}" data-i="${i}">
          <td class="t3cg-c-main"><div class="t3cg-line">${rowSvg(g, row.kind, isHead)}<span class="t3cg-desc">${labels}${stashLabel}<span class="t3cg-subject">${esc(row.subject)}</span>${row.kind === "uncommitted" ? "" : `<span class="t3cg-by">${esc(row.author)}</span>`}</span></div></td>
        </tr>`);
        if (this.expanded.has(key)) html.push(this.detailsHtml(row, g, key));
      });
      if (this.data.hasMore) html.push(`<tr class="t3cg-more"><td colspan="2"><button type="button" class="t3cg-btn" data-act="more">Load More Commits</button></td></tr>`);
      this.tbody.innerHTML = html.join("");
      this.showMessage(this.rows.length ? "" : `<div class="t3cg-muted">No commits yet.</div>`);
      this.scroller.scrollTop = scrollTop;
      if (this.find.open && this.find.q) this.runFind(false);
    }

    labelHtml(r, color) {
      if (r.type === "head") {
        const remotes = r.remotes.map((rm) => `<span class="t3cg-ref-remote" data-ref-type="remote" data-ref="${esc(`${rm}/${r.name}`)}">${esc(rm)}</span>`).join("");
        return `<span class="t3cg-ref t3cg-ref-head${r.current ? " t3cg-ref-current" : ""}" style="--lane:${color}" data-ref-type="head" data-ref="${esc(r.name)}">${SVG.branch}<span class="t3cg-ref-name">${esc(r.name)}</span>${remotes}</span>`;
      }
      if (r.type === "remote")
        return `<span class="t3cg-ref t3cg-ref-head t3cg-ref-remoteonly" style="--lane:${color}" data-ref-type="remote" data-ref="${esc(r.name)}">${SVG.branch}<span class="t3cg-ref-name">${esc(r.name)}</span></span>`;
      if (r.type === "tag") return `<span class="t3cg-ref t3cg-ref-tag" data-ref-type="tag" data-ref="${esc(r.name)}">${SVG.tag}<span class="t3cg-ref-name">${esc(r.name)}</span></span>`;
      return `<span class="t3cg-ref t3cg-ref-head t3cg-ref-current" style="--lane:${color}"><span class="t3cg-ref-name">HEAD</span></span>`;
    }

    // ---- hover card: full message and commit facts, shown after a short pause on a row
    scheduleCard(tr) {
      clearTimeout(this.hideTimer);
      const i = Number(tr.dataset.i);
      if (this.cardI === i) return;
      clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => this.showCard(i, tr), 350);
    }

    scheduleHide() {
      clearTimeout(this.hoverTimer);
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => this.hideCard(), 120);
    }

    hideCard() {
      clearTimeout(this.hoverTimer);
      clearTimeout(this.hideTimer);
      this.cardI = null;
      if (this.card) this.card.hidden = true;
    }

    async showCard(i, tr) {
      const row = this.rows?.[i];
      if (!row || row.kind === "uncommitted" || !tr.isConnected) return;
      this.cardI = i;
      const cached = this.detailCache.get(row.hash);
      this.paintCard(row, cached ?? null, tr);
      if (cached) return;
      try {
        const d = await git("details", { cwd: this.cwd, hash: row.hash });
        this.detailCache.set(row.hash, d);
        if (this.cardI === i) this.paintCard(row, d, tr);
      } catch (e) {
        if (this.cardI === i) this.paintCard(row, { error: e.message }, tr);
      }
    }

    paintCard(row, d, tr) {
      const card = this.card;
      const lane = this.layout?.rows[this.rows.indexOf(row)]?.color ?? "var(--t3cg-muted)";
      const refs = (this.refsByCommit().get(row.hash) ?? []).map((r) => this.labelHtml(r, lane)).join("");
      const message = reflow(d && !d.error ? d.body : row.subject);
      const totalAdd = d?.files?.reduce((s, f) => s + (f.additions ?? 0), 0) ?? 0;
      const totalDel = d?.files?.reduce((s, f) => s + (f.deletions ?? 0), 0) ?? 0;
      const n = d?.files?.length ?? 0;
      const stats = d && !d.error ? `<div class="t3cg-card-stats">${n} file${n === 1 ? "" : "s"} changed, <span class="t3cg-add">+${totalAdd}</span> <span class="t3cg-del">-${totalDel}</span></div>` : d?.error ? `<div class="t3cg-error">${esc(d.error)}</div>` : "";
      card.innerHTML = `
        <div class="t3cg-card-head">
          <span class="t3cg-avatar" style="--lane:${lane}">${esc(initials(row.author))}</span>
          <span><b>${esc(row.author)}</b>, ${esc(fmtAgo(row.date))} <span class="t3cg-muted">(${esc(fmtFullDate(row.date))})</span></span>
        </div>
        <div class="t3cg-card-msg">${esc(message ?? "")}</div>
        ${stats}
        ${refs ? `<div class="t3cg-card-refs">${refs}</div>` : ""}
        <div class="t3cg-card-foot"><button type="button" class="t3cg-copy" data-copy="${esc(row.hash)}" title="Copy full hash"><span class="t3cg-mono">${esc(short(row.hash))}</span>${SVG.copy}${SVG.check}</button></div>`;
      // Place it left of the panel, top-aligned with the row and kept on screen. The panel is
      // on the right of the window, so this mirrors VS Code, where the card opens to the right.
      card.hidden = false;
      const rootRect = this.root.getBoundingClientRect();
      const rowRect = tr.getBoundingClientRect();
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const clampTop = (t) => Math.min(Math.max(8, t), window.innerHeight - ch - 8);
      let left = rootRect.left - cw - 8;
      let top = clampTop(rowRect.top);
      if (left < 8) {
        // No room beside the panel (narrow window): fall back to below the row, or above it.
        left = Math.min(Math.max(rootRect.left + 8, rowRect.left + 40), rootRect.right - cw - 8);
        top = rowRect.bottom + 4 + ch > window.innerHeight - 8 ? clampTop(rowRect.top - ch - 4) : rowRect.bottom + 4;
      }
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      // In the fallback the card can lie over the open file list: let the pointer through
      // to it, so moving onto the list closes the card instead of keeping it open.
      const cr = card.getBoundingClientRect();
      const overlaps = [...this.tbody.querySelectorAll(".t3cg-details")].some((el) => {
        const list = el.getBoundingClientRect();
        return cr.left < list.right && cr.right > list.left && cr.top < list.bottom && cr.bottom > list.top;
      });
      card.classList.toggle("t3cg-card-passthru", overlaps);
    }

    // ---- files popdown (click a row).
    detailsHtml(row, g, key) {
      const d = this.expanded.get(key)?.details;
      let body;
      if (!d) body = `<div class="t3cg-muted t3cg-details-loading">Loading…</div>`;
      else if (d.error) body = `<div class="t3cg-error">${esc(d.error)}</div>`;
      else if (row.kind === "uncommitted") body = `<div class="t3cg-details-files">${this.filesHtml(d)}</div>`;
      else {
        const parentSel =
          d.parents.length > 1
            ? `<div class="t3cg-parent-sel">Compare with parent: ${d.parents
                .map((p, i) => `<button type="button" class="t3cg-btn t3cg-btn-sm${d.comparedTo === p ? " t3cg-btn-on" : ""}" data-parent="${i + 1}">${i + 1}: ${esc(short(p))}</button>`)
                .join("")}</div>`
            : "";
        body = `<div class="t3cg-details-files">${parentSel}${this.filesHtml(d)}</div>`;
      }
      // Lanes still open below the commit run down beside the file list; the list starts after them.
      const indent = Math.max(1, lastLane(g.after)) * LANE_W;
      return `<tr class="t3cg-details-row" data-key="${esc(key)}"><td><div class="t3cg-details-wrap" style="padding-left:${indent + 8}px">${continuationSvg(g.after)}<div class="t3cg-details" data-key="${esc(key)}">${body}</div></div></td></tr>`;
    }

    filesHtml(d) {
      if (!d.files.length) return `<div class="t3cg-muted">No file changes.</div>`;
      // Flat list: file name and status only. A newly added file shows as U (new), like the request asked.
      const rows = d.files.map((f, i) => {
        const name = f.path.split("/").pop();
        const letter = STATUS_LETTER[f.status] ?? f.status;
        const title = f.oldPath && f.oldPath !== f.path ? `${f.oldPath} → ${f.path}` : f.path;
        const icon = fileIcon(f.path);
        const img = icon ? `<img class="t3cg-ficon" src="${esc(icon)}" alt="" draggable="false">` : `<span class="t3cg-ficon"></span>`;
        return `<div class="t3cg-file-row t3cg-st-${esc(f.status)}" data-file="${i}" title="${esc(title)}">${img}<span class="t3cg-fname">${esc(name)}</span><span class="t3cg-st">${esc(letter)}</span></div>`;
      });
      return `<div class="t3cg-file-list">${rows.join("")}</div>`;
    }

    rowIndexByKey(key) {
      return this.rows.findIndex((r) => (r.kind === "uncommitted" ? "*" : r.hash) === key);
    }

    async toggleDetails(i, opts = {}) {
      const row = this.rows[i];
      const key = row.kind === "uncommitted" ? "*" : row.hash;
      if (this.expanded.has(key) && !opts.parent) {
        this.expanded.delete(key);
        return this.render();
      }
      const entry = { key, details: null, row };
      this.expanded.set(key, entry);
      if (!opts.parent) this.render();
      try {
        const details = row.kind === "uncommitted" ? await git("uncommittedDetails", { cwd: this.cwd }) : await git("details", { cwd: this.cwd, hash: row.hash, parent: opts.parent });
        await iconMapReady;
        if (this.expanded.get(key) !== entry) return;
        entry.details = details;
      } catch (e) {
        if (this.expanded.get(key) !== entry) return;
        entry.details = { error: e.message };
      }
      this.render();
      const tr = [...this.tbody.querySelectorAll(".t3cg-details-row")].find((el) => el.dataset.key === key);
      tr?.scrollIntoView({ block: "nearest" });
    }

    // ---- diff viewer
    async openDiff(file, key) {
      const d = this.expanded.get(key)?.details;
      if (!d) return;
      const isUncommitted = key === "*";
      const overlay = document.createElement("div");
      overlay.className = "t3cg-diff-overlay";
      overlay.tabIndex = -1;
      const title = `${esc(file.path)}${file.oldPath && file.oldPath !== file.path ? ` <span class="t3cg-muted">(renamed from ${esc(file.oldPath)})</span>` : ""}`;
      overlay.innerHTML = `<div class="t3cg-diff-head"><button type="button" class="t3cg-icon-btn" data-act="close" title="Back (Escape)" aria-label="Back">${SVG.back}</button><span class="t3cg-st-${esc(file.status)} t3cg-st">${esc(STATUS_LETTER[file.status] ?? file.status)}</span><span class="t3cg-diff-title">${title}</span>
        <span class="t3cg-muted t3cg-mono">${isUncommitted ? "Uncommitted" : `${esc(short(d.comparedTo ?? ""))}${d.comparedTo ? " ↔ " : ""}${esc(short(d.hash))}`}</span>
        <div class="t3cg-spacer"></div>
        <div class="t3cg-seg" role="group" aria-label="Diff style" hidden><button type="button" class="t3cg-icon-btn" data-act="legacy" title="Use legacy diff" aria-label="Use legacy diff" aria-pressed="false">${SVG.legacy}</button></div>
        <div class="t3cg-seg" role="group" aria-label="View"><button type="button" class="t3cg-icon-btn t3cg-on" data-view="diff" title="Diff" aria-label="Diff" aria-pressed="true">${SVG.diff}</button><button type="button" class="t3cg-icon-btn" data-view="full" title="Full file" aria-label="Full file" aria-pressed="false">${SVG.file}</button></div></div>
        <div class="t3cg-diff-body"><div class="t3cg-muted" style="padding:12px">Loading diff…</div></div>`;
      const close = () => {
        unmountT3();
        overlay.remove();
        this.root.focus();
      };
      overlay.addEventListener("click", (e) => {
        if (e.target.closest("[data-act=close]")) return close();
        if (e.target.closest("[data-act=legacy]")) {
          legacy = !legacy;
          try {
            localStorage.setItem(LEGACY_KEY, legacy ? "1" : "0");
          } catch {}
          return show(current);
        }
        const v = e.target.closest("[data-view]")?.dataset.view;
        if (v) show(v);
      });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      });
      this.root.appendChild(overlay);
      overlay.focus();

      // Diff and Full (the whole file, changes marked inline) are fetched on first use and kept, so switching back and forth is instant.
      const body = overlay.querySelector(".t3cg-diff-body");
      const cache = {};
      const target = isUncommitted ? "*" : d.hash;
      const query = { cwd: this.cwd, hash: target, base: isUncommitted ? undefined : d.comparedTo ?? undefined, path: file.path, oldPath: file.oldPath };
      const load = (full) => async () => {
        const res = await git("fileDiff", { ...query, untracked: isUncommitted && file.status === "U", full });
        return renderDiff(res.diff, { full }) + (res.truncated ? `<div class="t3cg-muted" style="padding:8px">${full ? "File" : "Diff"} truncated.</div>` : "");
      };
      const loaders = { diff: load(false), full: load(true) };

      // T3's renderer needs both sides of the file; null means it is not available and the plain view is shown.
      const t3 = (async () => {
        const lib = await loadT3Diff();
        if (!lib || !this.react) return null;
        const sides = await git("fileSides", query);
        if (sides.unavailable) return null;
        const fileDiff = lib.parse(sides.before == null ? null : { name: sides.oldName, contents: sides.before }, sides.after == null ? null : { name: sides.name, contents: sides.after });
        return { lib, fileDiff };
      })().catch((e) => {
        console.debug("[t3mod] commit-graph: T3 diff failed", e);
        return null;
      });
      let portal = null;
      const unmountT3 = () => {
        portal?.remove();
        portal = null;
      };
      // The section takes stable props (new objects would reset its scroll and annotations), so each view's are built once.
      const sections = {};
      const sectionFor = (ready, view) => {
        if (sections[view]) return sections[view];
        const { lib, fileDiff } = ready;
        const ctx = this.t3 ?? {};
        const themeType = document.documentElement.classList.contains("dark") ? "dark" : "light";
        const files = [{ fileKey: `t3cg:${target}:${file.path}`, filePath: file.path, fileDiff, fileVersion: `${target}:${file.path}`, collapsed: false }];
        const props = {
          environmentId: ctx.environmentId,
          projectId: ctx.projectId,
          composerDraftTarget: ctx.composerDraftTarget,
          codeViewKey: `t3cg:${target}:${file.path}:${view}`,
          sectionId: `commit-graph:${target}`,
          sectionTitle: isUncommitted ? "Uncommitted changes" : `Commit ${short(d.hash)}`,
          files,
          pendingFiles: [],
          className: "h-full min-h-0 overflow-auto",
          renderHeaderFilenameSuffix: () => null,
          renderHeaderPrefix: () => null,
          onRevealSearchMatch: () => {},
          options: { diffStyle: "unified", lineDiffType: "none", overflow: "scroll", theme: lib.themeName?.(themeType), themeType, disableFileHeader: true, expandUnchanged: view === "full" },
        };
        return (sections[view] = () => this.react.jsx(lib.Section, props));
      };
      const showT3 = (ready, view) => {
        const element = sectionFor(ready, view);
        if (!portal) {
          body.innerHTML = "";
          const host = document.createElement("div");
          host.className = "t3cg-t3diff";
          body.appendChild(host);
          portal = this.mountReact(host, ready.lib.createPortal, element);
        } else portal.update(element);
        body.scrollTop = 0;
      };
      let current = null;
      let legacy = false;
      try {
        legacy = localStorage.getItem(LEGACY_KEY) === "1";
      } catch {}
      const show = async (view) => {
        current = view;
        for (const b of overlay.querySelectorAll("[data-view]")) {
          const on = b.dataset.view === view;
          b.classList.toggle("t3cg-on", on);
          b.setAttribute("aria-pressed", String(on));
        }
        const ready = await t3;
        if (current !== view) return;
        // The legacy toggle only exists when T3's renderer does; it picks the plain table below.
        const legacyBtn = overlay.querySelector("[data-act=legacy]");
        legacyBtn.parentElement.hidden = !ready;
        legacyBtn.classList.toggle("t3cg-on", legacy);
        legacyBtn.setAttribute("aria-pressed", String(legacy));
        legacyBtn.title = legacyBtn.ariaLabel = legacy ? "Use T3's diff" : "Use legacy diff";
        if (ready && !legacy) return showT3(ready, view);
        unmountT3();
        if (cache[view] === undefined) {
          body.innerHTML = `<div class="t3cg-muted" style="padding:12px">Loading…</div>`;
          try {
            cache[view] = await loaders[view]();
          } catch (e) {
            cache[view] = `<div class="t3cg-error" style="padding:12px">${esc(e.message)}</div>`;
          }
        }
        if (current === view) {
          body.innerHTML = cache[view];
          body.scrollTop = 0;
        }
      };
      show("diff");
    }

    // Render a React element into a plain DOM node through a portal owned by the surface's React tree.
    mountReact(container, createPortal, element) {
      const id = ++portalIds;
      const entry = { id, render: () => createPortal(element(), container, String(id)) };
      this.react.setPortals((list) => [...list, entry]);
      return {
        update: (next) => {
          entry.render = () => createPortal(next(), container, String(id));
          this.react.setPortals((list) => [...list]);
        },
        remove: () => this.react.setPortals((list) => list.filter((p) => p.id !== id)),
      };
    }

    // ---- find
    openFind() {
      this.find.open = true;
      const bar = this.$(".t3cg-findbar");
      bar.hidden = false;
      const input = bar.querySelector("input");
      input.focus();
      input.select();
    }
    closeFind() {
      this.find = { open: false, q: "", matches: [], cur: -1 };
      this.$(".t3cg-findbar").hidden = true;
      this.$(".t3cg-findbar input").value = "";
      this.tbody.querySelectorAll(".t3cg-found,.t3cg-found-cur").forEach((el) => el.classList.remove("t3cg-found", "t3cg-found-cur"));
      this.root.focus();
    }
    runFind(jump = true) {
      const q = this.find.q.toLowerCase();
      this.tbody.querySelectorAll(".t3cg-found,.t3cg-found-cur").forEach((el) => el.classList.remove("t3cg-found", "t3cg-found-cur"));
      if (!q || !this.rows) {
        this.find.matches = [];
        this.$(".t3cg-find-count").textContent = "";
        return;
      }
      const refMap = this.refsByCommit();
      this.find.matches = this.rows
        .map((r, i) => {
          const refs = (refMap.get(r.hash) ?? []).map((x) => x.name).join(" ");
          return [r.subject, r.hash, r.author, r.email, refs, r.selector].join("\n").toLowerCase().includes(q) ? i : -1;
        })
        .filter((i) => i >= 0);
      if (this.find.cur >= this.find.matches.length || this.find.cur < 0) this.find.cur = this.find.matches.length ? 0 : -1;
      for (const i of this.find.matches) this.tbody.querySelector(`tr[data-i="${i}"]`)?.classList.add("t3cg-found");
      this.$(".t3cg-find-count").textContent = this.find.matches.length ? `${this.find.cur + 1} of ${this.find.matches.length}` : "No results";
      if (this.find.cur >= 0) {
        const tr = this.tbody.querySelector(`tr[data-i="${this.find.matches[this.find.cur]}"]`);
        tr?.classList.add("t3cg-found-cur");
        if (jump) tr?.scrollIntoView({ block: "center" });
      }
    }
    stepFind(dir) {
      if (!this.find.matches.length) return;
      this.find.cur = (this.find.cur + dir + this.find.matches.length) % this.find.matches.length;
      this.runFind(true);
    }

    // ---- branch filter dropdown
    openBranchDropdown(btn) {
      const open = this.root.querySelector(".t3cg-dd:not(.t3cg-menu)");
      this.root.querySelector(".t3cg-dd")?.remove();
      if (open) return; // second click on the button closes it
      const { refs } = this.data ?? { refs: { heads: [], remotes: [] } };
      const rp = this.repoPrefs();
      const selected = new Set(rp.branches ?? []);
      const opts = [
        ...refs.heads.map((b) => ({ ref: b.ref, label: b.name })),
        ...(this.prefs.showRemote !== false ? refs.remotes.map((r) => ({ ref: r.ref, label: `remotes/${r.name}` })) : []),
      ];
      const dd = document.createElement("div");
      dd.className = "t3cg-dd";
      dd.innerHTML = `<input type="text" placeholder="Filter branches…" spellcheck="false"/>
        <div class="t3cg-dd-list">
          <label class="t3cg-dd-opt t3cg-dd-all"><input type="checkbox" data-all ${selected.size ? "" : "checked"}/> <span>All</span></label>
          ${opts.map((o) => `<label class="t3cg-dd-opt" data-label="${esc(o.label.toLowerCase())}"><input type="checkbox" data-ref="${esc(o.ref)}" ${selected.has(o.ref) ? "checked" : ""}/> <span>${esc(o.label)}</span></label>`).join("")}
        </div>`;
      const r = btn.getBoundingClientRect();
      const rr = this.root.getBoundingClientRect();
      dd.style.top = `${r.bottom - rr.top + 4}px`;
      this.root.appendChild(dd);
      // Keep it inside the panel: a dropdown poking past the edge made the browser scroll the panel sideways.
      dd.style.left = `${Math.max(8, Math.min(r.left - rr.left, rr.width - dd.offsetWidth - 8))}px`;
      const input = dd.querySelector("input[type=text]");
      input.focus({ preventScroll: true });
      input.addEventListener("input", () => {
        const q = input.value.toLowerCase();
        dd.querySelectorAll(".t3cg-dd-opt[data-label]").forEach((el) => (el.hidden = !el.dataset.label.includes(q)));
      });
      dd.addEventListener("change", (e) => {
        const cb = e.target;
        if (cb.dataset.all !== undefined) {
          dd.querySelectorAll("input[data-ref]").forEach((x) => (x.checked = false));
          cb.checked = true;
        } else dd.querySelector("input[data-all]").checked = ![...dd.querySelectorAll("input[data-ref]")].some((x) => x.checked);
        rp.branches = [...dd.querySelectorAll("input[data-ref]")].filter((x) => x.checked).map((x) => x.dataset.ref);
        if (!rp.branches.length) rp.branches = null;
        savePrefs(this.prefs);
        this.expanded.clear();
        this.load();
      });
      dismissable(dd, btn);
    }

    // "…" menu: view options that don't need a place in the toolbar.
    openMoreMenu(btn) {
      const open = this.root.querySelector(".t3cg-menu");
      this.root.querySelector(".t3cg-dd")?.remove();
      if (open) return; // second click on the button closes it
      const dd = document.createElement("div");
      dd.className = "t3cg-dd t3cg-menu";
      dd.innerHTML = `<div class="t3cg-dd-list">
          <label class="t3cg-dd-opt"><input type="checkbox" data-act="remotes" ${this.prefs.showRemote !== false ? "checked" : ""}/> <span>Show Remote Branches</span></label>
        </div>`;
      const r = btn.getBoundingClientRect();
      const rr = this.root.getBoundingClientRect();
      dd.style.right = `${rr.right - r.right}px`;
      dd.style.top = `${r.bottom - rr.top + 4}px`;
      this.root.appendChild(dd);
      dd.querySelector("input")?.focus({ preventScroll: true });
      dismissable(dd, btn);
    }

    // Toolbar pull: the current branch from its upstream.
    async pullCurrent() {
      const br = this.currentBranch;
      const head = this.data?.refs.heads.find((h) => h.name === br);
      if (!br) return dialog(this.root, { message: "Check out a branch to pull into it.", action: null, cancel: "OK" });
      if (!head?.upstream)
        return dialog(this.root, { message: `<b>${esc(br)}</b> has no upstream branch. Push it with <i>Set Upstream</i> first, or pull a specific remote branch from its context menu.`, action: null, cancel: "OK" });
      const v = await dialog(this.root, {
        message: `Pull <b>${esc(head.upstream)}</b> into <b>${esc(br)}</b>?${head.track ? ` <span class="t3cg-muted">(${esc(head.track)})</span>` : ""}`,
        inputs: [{ type: "select", name: "mode", label: "Mode", value: "merge", options: [{ value: "merge", label: "Merge" }, { value: "ff", label: "Fast-forward only" }, { value: "rebase", label: "Rebase" }] }],
        action: "Yes, pull",
      });
      if (v) await this.run("Pull", "pull", { ffOnly: v.mode === "ff", rebase: v.mode === "rebase" });
    }

    // Toolbar push: the current branch, to its upstream's remote by default.
    async pushCurrent() {
      const br = this.currentBranch;
      if (!br) return dialog(this.root, { message: "Check out a branch to push it.", action: null, cancel: "OK" });
      if (!this.remotes.length) return dialog(this.root, { message: "This repository has no remotes.", action: null, cancel: "OK" });
      const head = this.data.refs.heads.find((h) => h.name === br);
      const sel = this.remoteSelect();
      const upRemote = head?.upstream && this.remotes.find((r) => head.upstream.startsWith(`${r}/`));
      if (upRemote) sel.value = upRemote;
      const v = await dialog(this.root, {
        message: `Push <b>${esc(br)}</b>${head?.upstream ? ` to <b>${esc(head.upstream)}</b>` : ""}?${head?.track ? ` <span class="t3cg-muted">(${esc(head.track)})</span>` : ""}`,
        inputs: [
          sel,
          { type: "checkbox", name: "setUpstream", label: "Set Upstream", value: !head?.upstream },
          { type: "select", name: "force", label: "Push mode", value: "none", options: [{ value: "none", label: "Normal" }, { value: "lease", label: "Force With Lease" }, { value: "force", label: "Force" }] },
        ],
        action: "Yes, push",
      });
      if (v) await this.run("Push", "pushBranch", { name: br, remote: v.remote, setUpstream: v.setUpstream, force: v.force });
    }

    // ---- actions
    async run(label, op, params, { refresh = true } = {}) {
      this.busy = true;
      this.setStatus(`${label}…`);
      this.root.classList.add("t3cg-busy");
      try {
        await git(op, { cwd: this.cwd, ...params });
        this.setStatus("");
        return true;
      } catch (e) {
        this.setStatus("");
        await dialog(this.root, { title: `Unable to ${label.charAt(0).toLowerCase()}${label.slice(1)}`, message: `<pre class="t3cg-pre">${esc(e.message)}</pre>`, action: null, cancel: "Dismiss", wide: true });
        return false;
      } finally {
        this.busy = false;
        this.root.classList.remove("t3cg-busy");
        if (refresh) await this.load();
      }
    }

    get currentBranch() {
      return this.data?.info.branch ?? null;
    }
    get remotes() {
      return this.data?.info.remotes ?? [];
    }
    remoteSelect(name = "remote", label = "Remote") {
      const rs = this.remotes;
      return { type: "select", name, label, value: rs.includes("origin") ? "origin" : rs[0], options: rs.map((r) => ({ value: r, label: r })) };
    }

    async commitMenu(ev, row) {
      const h = row.hash;
      const sh = `<b class="t3cg-mono">${esc(short(h))}</b>`;
      const cur = this.currentBranch;
      const merge = row.parents.length > 1;
      const id = await showMenu(ev, [
        { id: "tag", label: "Add Tag…" },
        { id: "branch", label: "Create Branch…" },
        { id: "checkout", label: "Checkout…" },
        { id: "cherry", label: "Cherry Pick…" },
        { id: "revert", label: "Revert…" },
        { id: "drop", label: "Drop…", disabled: merge || !cur, destructive: true },
        { id: "merge", label: "Merge into current branch…", separatorBefore: true, disabled: row.hash === this.data.info.headHash },
        { id: "rebase", label: "Rebase current branch on this Commit…", disabled: !cur || row.hash === this.data.info.headHash },
        { id: "reset", label: "Reset current branch to this Commit…", disabled: !cur },
        { id: "copy-hash", label: "Copy Commit Hash to Clipboard", separatorBefore: true },
        { id: "copy-subject", label: "Copy Commit Subject to Clipboard" },
      ]);
      const parentInput = merge
        ? [{ type: "select", name: "parent", label: "Parent", value: "1", options: row.parents.map((p, i) => ({ value: String(i + 1), label: `${i + 1}: ${short(p)}` })) }]
        : [];
      switch (id) {
        case "tag": {
          const inputs = [
            { type: "text", name: "name", label: "Name", placeholder: "v1.0.0" },
            { type: "select", name: "kind", label: "Type", value: "annotated", options: [{ value: "annotated", label: "Annotated" }, { value: "lightweight", label: "Lightweight" }] },
            { type: "text", name: "message", label: "Message", placeholder: "Optional" },
          ];
          if (this.remotes.length) inputs.push({ type: "checkbox", name: "push", label: `Push to remote${this.remotes.length === 1 ? ` (${this.remotes[0]})` : ""}`, value: false });
          const v = await dialog(this.root, { message: `Add tag to commit ${sh}:`, inputs, action: "Add Tag" });
          if (v?.name) await this.run("Add tag", "createTag", { name: v.name, hash: h, message: v.kind === "annotated" ? v.message || v.name : undefined, pushTo: v.push ? this.remotes.includes("origin") ? "origin" : this.remotes[0] : undefined });
          break;
        }
        case "branch": {
          const v = await dialog(this.root, {
            message: `Create branch at commit ${sh}:`,
            inputs: [
              { type: "text", name: "name", label: "Name" },
              { type: "checkbox", name: "checkout", label: "Check out", value: false },
              { type: "checkbox", name: "force", label: "Replace existing branch (force)", value: false },
            ],
            action: "Create Branch",
          });
          if (v?.name) await this.run("Create branch", "createBranch", { name: v.name, hash: h, checkout: v.checkout, force: v.force });
          break;
        }
        case "checkout": {
          const v = await dialog(this.root, { message: `Are you sure you want to checkout commit ${sh}? This will result in a <i>detached HEAD</i> state.`, action: "Yes, checkout" });
          if (v) await this.run("Checkout commit", "checkoutCommit", { hash: h });
          break;
        }
        case "cherry": {
          const v = await dialog(this.root, {
            message: `Are you sure you want to cherry pick commit ${sh}?`,
            inputs: [...parentInput, { type: "checkbox", name: "recordOrigin", label: "Record origin (-x)", value: false }, { type: "checkbox", name: "noCommit", label: "No commit", value: false }],
            action: "Yes, cherry pick",
          });
          if (v) await this.run("Cherry pick", "cherryPick", { hash: h, noCommit: v.noCommit, recordOrigin: v.recordOrigin, parent: merge ? Number(v.parent) : undefined });
          break;
        }
        case "revert": {
          const v = await dialog(this.root, { message: `Are you sure you want to revert commit ${sh}?`, inputs: parentInput, action: "Yes, revert" });
          if (v) await this.run("Revert commit", "revert", { hash: h, parent: merge ? Number(v.parent) : undefined });
          break;
        }
        case "drop": {
          const v = await dialog(this.root, { message: `Are you sure you want to permanently drop commit ${sh} from <b>${esc(cur)}</b>? This rewrites history (git rebase --onto).`, action: "Yes, drop", destructive: true });
          if (v) await this.run("Drop commit", "dropCommit", { hash: h });
          break;
        }
        case "merge":
          await this.mergeDialog(h, `commit ${sh}`);
          break;
        case "rebase": {
          const v = await dialog(this.root, { message: `Are you sure you want to rebase <b>${esc(cur)}</b> on commit ${sh}?`, inputs: [{ type: "checkbox", name: "ignoreDate", label: "Ignore date", value: false }], action: "Yes, rebase" });
          if (v) await this.run("Rebase", "rebase", { ref: h, ignoreDate: v.ignoreDate });
          break;
        }
        case "reset": {
          const v = await dialog(this.root, {
            message: `Are you sure you want to reset <b>${esc(cur)}</b> to commit ${sh}?`,
            inputs: [
              {
                type: "select",
                name: "mode",
                label: "Mode",
                value: "mixed",
                options: [
                  { value: "soft", label: "Soft - Keep all changes, but reset head" },
                  { value: "mixed", label: "Mixed - Keep working tree, but reset index" },
                  { value: "hard", label: "Hard - Discard all changes" },
                ],
              },
            ],
            action: "Yes, reset",
            destructive: true,
          });
          if (v) {
            if (v.mode === "hard" && this.data.info.uncommitted > 0) {
              const ok = await dialog(this.root, { message: `This will <b>permanently discard ${this.data.info.uncommitted} uncommitted change(s)</b>. Continue?`, action: "Discard and reset", destructive: true });
              if (!ok) break;
            }
            await this.run("Reset", "reset", { hash: h, mode: v.mode });
          }
          break;
        }
        case "copy-hash":
          copy(h);
          break;
        case "copy-subject":
          copy(row.subject);
          break;
      }
    }

    async mergeDialog(ref, what) {
      const cur = this.currentBranch ?? "HEAD";
      const v = await dialog(this.root, {
        message: `Are you sure you want to merge ${what} into <b>${esc(cur)}</b>?`,
        inputs: [
          { type: "checkbox", name: "noFastForward", label: "Create a new commit even if fast-forward is possible", value: true },
          { type: "checkbox", name: "squash", label: "Squash commits", value: false },
          { type: "checkbox", name: "noCommit", label: "No commit", value: false },
        ],
        action: "Yes, merge",
      });
      if (v) await this.run("Merge", "merge", { ref, ...v });
    }

    async branchMenu(ev, name) {
      const b = this.data.refs.heads.find((x) => x.name === name);
      if (!b) return;
      const isCur = b.current;
      const bn = `<b>${esc(name)}</b>`;
      const id = await showMenu(ev, [
        { id: "checkout", label: "Checkout Branch", disabled: isCur },
        { id: "rename", label: "Rename Branch…" },
        { id: "delete", label: "Delete Branch…", disabled: isCur, destructive: true },
        { id: "merge", label: "Merge into current branch…", separatorBefore: true, disabled: isCur },
        { id: "rebase", label: "Rebase current branch on Branch…", disabled: isCur || !this.currentBranch },
        { id: "push", label: "Push Branch…", disabled: !this.remotes.length },
        { id: "copy", label: "Copy Branch Name to Clipboard", separatorBefore: true },
      ]);
      switch (id) {
        case "checkout":
          await this.run("Checkout branch", "checkoutBranch", { name });
          break;
        case "rename": {
          const v = await dialog(this.root, { message: `Enter the new name for branch ${bn}:`, inputs: [{ type: "text", name: "to", label: "New name", value: name }], action: "Rename Branch" });
          if (v?.to && v.to !== name) await this.run("Rename branch", "renameBranch", { from: name, to: v.to });
          break;
        }
        case "delete": {
          const onRemotes = this.data.refs.remotes.filter((r) => r.branch === name).map((r) => r.remote);
          const inputs = [{ type: "checkbox", name: "force", label: "Force Delete", value: false }];
          if (onRemotes.length) inputs.push({ type: "checkbox", name: "remote", label: `Delete this branch on the remote${onRemotes.length > 1 ? "s" : ""} (${onRemotes.join(", ")})`, value: false });
          const v = await dialog(this.root, { message: `Are you sure you want to delete the branch ${bn}?`, inputs, action: "Yes, delete", destructive: true });
          if (v) await this.run("Delete branch", "deleteBranch", { name, force: v.force, deleteOnRemotes: v.remote ? onRemotes : undefined });
          break;
        }
        case "merge":
          await this.mergeDialog(b.ref, `branch ${bn}`);
          break;
        case "rebase": {
          const v = await dialog(this.root, { message: `Are you sure you want to rebase <b>${esc(this.currentBranch)}</b> on branch ${bn}?`, inputs: [{ type: "checkbox", name: "ignoreDate", label: "Ignore date", value: false }], action: "Yes, rebase" });
          if (v) await this.run("Rebase", "rebase", { ref: b.ref, ignoreDate: v.ignoreDate });
          break;
        }
        case "push": {
          const v = await dialog(this.root, {
            message: `Push branch ${bn}:`,
            inputs: [
              this.remoteSelect(),
              { type: "checkbox", name: "setUpstream", label: "Set Upstream", value: true },
              { type: "select", name: "force", label: "Push mode", value: "none", options: [{ value: "none", label: "Normal" }, { value: "lease", label: "Force With Lease" }, { value: "force", label: "Force" }] },
            ],
            action: "Yes, push",
          });
          if (v) await this.run("Push branch", "pushBranch", { name, remote: v.remote, setUpstream: v.setUpstream, force: v.force });
          break;
        }
        case "copy":
          copy(name);
          break;
      }
    }

    async remoteMenu(ev, full) {
      const r = this.data.refs.remotes.find((x) => x.name === full);
      if (!r) return;
      const rn = `<b>${esc(full)}</b>`;
      const id = await showMenu(ev, [
        { id: "checkout", label: "Checkout Branch…" },
        { id: "delete", label: "Delete Remote Branch…", destructive: true },
        { id: "merge", label: "Merge into current branch…", separatorBefore: true },
        { id: "pull", label: "Pull into current branch…", disabled: !this.currentBranch },
        { id: "copy", label: "Copy Branch Name to Clipboard", separatorBefore: true },
      ]);
      switch (id) {
        case "checkout": {
          const exists = this.data.refs.heads.find((h) => h.name === r.branch);
          if (exists && exists.upstream === r.name) {
            await this.run("Checkout branch", "checkoutBranch", { name: r.branch });
            break;
          }
          const v = await dialog(this.root, { message: `Enter the name of the new branch you would like to create when checking out ${rn}:`, inputs: [{ type: "text", name: "name", label: "Name", value: r.branch }], action: "Checkout Branch" });
          if (v?.name) await this.run("Checkout branch", "checkoutRemoteBranch", { remoteBranch: r.name, localName: v.name });
          break;
        }
        case "delete": {
          const v = await dialog(this.root, { message: `Are you sure you want to delete the remote branch ${rn}?`, action: "Yes, delete", destructive: true });
          if (v) await this.run("Delete remote branch", "deleteRemoteBranch", { remote: r.remote, branch: r.branch });
          break;
        }
        case "merge":
          await this.mergeDialog(r.ref, `remote branch ${rn}`);
          break;
        case "pull": {
          const v = await dialog(this.root, {
            message: `Are you sure you want to pull ${rn} into <b>${esc(this.currentBranch)}</b>?`,
            inputs: [
              { type: "checkbox", name: "noFastForward", label: "Create a new commit even if fast-forward is possible", value: false },
              { type: "checkbox", name: "squash", label: "Squash commits", value: false },
            ],
            action: "Yes, pull",
          });
          if (v) await this.run("Pull", "pullIntoCurrent", { remote: r.remote, branch: r.branch, ...v });
          break;
        }
        case "copy":
          copy(full);
          break;
      }
    }

    async tagMenu(ev, name) {
      const tn = `<b>${esc(name)}</b>`;
      const id = await showMenu(ev, [
        { id: "delete", label: "Delete Tag…", destructive: true },
        { id: "push", label: "Push Tag…", disabled: !this.remotes.length },
        { id: "copy", label: "Copy Tag Name to Clipboard", separatorBefore: true },
      ]);
      switch (id) {
        case "delete": {
          const inputs = this.remotes.length ? [{ type: "checkbox", name: "remote", label: "Delete this tag on the remote too", value: false }] : [];
          const v = await dialog(this.root, { message: `Are you sure you want to delete the tag ${tn}?`, inputs, action: "Yes, delete", destructive: true });
          if (v) await this.run("Delete tag", "deleteTag", { name, deleteOnRemote: v.remote ? (this.remotes.includes("origin") ? "origin" : this.remotes[0]) : undefined });
          break;
        }
        case "push": {
          const v = await dialog(this.root, { message: `Push tag ${tn}:`, inputs: [this.remoteSelect()], action: "Yes, push" });
          if (v) await this.run("Push tag", "pushTag", { name, remote: v.remote });
          break;
        }
        case "copy":
          copy(name);
          break;
      }
    }

    async stashMenu(ev, row) {
      const sn = `<b>${esc(row.selector)}</b>`;
      const id = await showMenu(ev, [
        { id: "apply", label: "Apply Stash…" },
        { id: "branch", label: "Create Branch from Stash…" },
        { id: "pop", label: "Pop Stash…" },
        { id: "drop", label: "Drop Stash…", destructive: true },
        { id: "copy-name", label: "Copy Stash Name to Clipboard", separatorBefore: true },
        { id: "copy-hash", label: "Copy Stash Hash to Clipboard" },
      ]);
      const reinstate = [{ type: "checkbox", name: "reinstateIndex", label: "Reinstate Index", value: false }];
      switch (id) {
        case "apply": {
          const v = await dialog(this.root, { message: `Are you sure you want to apply the stash ${sn}?`, inputs: reinstate, action: "Yes, apply" });
          if (v) await this.run("Apply stash", "stashApply", { selector: row.selector, ...v });
          break;
        }
        case "pop": {
          const v = await dialog(this.root, { message: `Are you sure you want to pop the stash ${sn}?`, inputs: reinstate, action: "Yes, pop" });
          if (v) await this.run("Pop stash", "stashPop", { selector: row.selector, ...v });
          break;
        }
        case "branch": {
          const v = await dialog(this.root, { message: `Create a branch from stash ${sn}:`, inputs: [{ type: "text", name: "name", label: "Name" }], action: "Create Branch" });
          if (v?.name) await this.run("Create branch from stash", "stashBranch", { selector: row.selector, name: v.name });
          break;
        }
        case "drop": {
          const v = await dialog(this.root, { message: `Are you sure you want to drop the stash ${sn}?`, action: "Yes, drop", destructive: true });
          if (v) await this.run("Drop stash", "stashDrop", { selector: row.selector });
          break;
        }
        case "copy-name":
          copy(row.selector);
          break;
        case "copy-hash":
          copy(row.hash);
          break;
      }
    }

    async uncommittedMenu(ev) {
      const id = await showMenu(ev, [
        { id: "stash", label: "Stash uncommitted changes…" },
        { id: "reset", label: "Reset uncommitted changes…", separatorBefore: true, destructive: true },
        { id: "clean", label: "Clean untracked files…", destructive: true },
      ]);
      switch (id) {
        case "stash": {
          const v = await dialog(this.root, {
            message: "Are you sure you want to stash the <b>uncommitted changes</b>?",
            inputs: [
              { type: "text", name: "message", label: "Message", placeholder: "Optional" },
              { type: "checkbox", name: "includeUntracked", label: "Include Untracked", value: true },
            ],
            action: "Yes, stash",
          });
          if (v) await this.run("Stash changes", "stashPush", v);
          break;
        }
        case "reset": {
          const v = await dialog(this.root, {
            message: "Are you sure you want to reset the <b>uncommitted changes</b> to <b>HEAD</b>?",
            inputs: [{ type: "select", name: "mode", label: "Mode", value: "mixed", options: [{ value: "mixed", label: "Mixed - Keep working tree, but reset index" }, { value: "hard", label: "Hard - Discard all changes" }] }],
            action: "Yes, reset",
            destructive: true,
          });
          if (v) await this.run("Reset uncommitted changes", "resetUncommitted", v);
          break;
        }
        case "clean": {
          const v = await dialog(this.root, {
            message: "Are you sure you want to clean all <b>untracked files</b>? This permanently deletes them.",
            inputs: [{ type: "checkbox", name: "directories", label: "Clean untracked directories", value: true }],
            action: "Yes, clean",
            destructive: true,
          });
          if (v) await this.run("Clean untracked files", "cleanUntracked", v);
          break;
        }
      }
    }

    async fileMenu(ev, file, key) {
      const d = this.expanded.get(key)?.details;
      if (!d) return;
      const info = this.data.info;
      const abs = `${info.root}/${file.path}`;
      const rel = this.workspaceRelative(file.path);
      const id = await showMenu(ev, [
        { id: "diff", label: "View Diff" },
        { id: "open", label: "Open File", disabled: rel === null || file.status === "D" || !opener.store },
        { id: "copy-rel", label: "Copy Relative File Path to Clipboard", separatorBefore: true },
        { id: "copy-abs", label: "Copy Absolute File Path to Clipboard" },
      ]);
      if (id === "diff") this.openDiff(file, key);
      else if (id === "open") this.openFile(file);
      else if (id === "copy-rel") copy(file.path);
      else if (id === "copy-abs") copy(abs);
    }

    workspaceRelative(p) {
      const { root, cwd } = this.data.info;
      if (!cwd || cwd === root) return p;
      if (!cwd.startsWith(root + "/")) return null;
      const prefix = cwd.slice(root.length + 1) + "/";
      return p.startsWith(prefix) ? p.slice(prefix.length) : null;
    }

    openFile(file) {
      const rel = this.workspaceRelative(file.path);
      if (rel === null || !this.threadRef || !opener.store) return;
      opener.store.getState().openFile(this.threadRef, rel);
    }

    // ---- events
    bind() {
      const root = this.root;
      root.addEventListener("click", async (e) => {
        const t = e.target;
        const act = t.closest("[data-act]")?.dataset.act;
        if (t.closest(".t3cg-overlay,.t3cg-diff-overlay,.t3cg-dd")) return;
        if (act === "refresh") return this.load({ reset: !this.data });
        if (act === "find") return this.openFind();
        if (act === "find-close") return this.closeFind();
        if (act === "find-next") return this.stepFind(1);
        if (act === "find-prev") return this.stepFind(-1);
        if (act === "branches") return this.openBranchDropdown(t.closest("[data-act]"));
        if (act === "menu") return this.openMoreMenu(t.closest("[data-act]"));
        if (act === "pull") return this.pullCurrent();
        if (act === "push") return this.pushCurrent();
        if (act === "more") {
          this.maxCommits += PAGE;
          return this.load();
        }
        if (act === "fetch") {
          if (!this.remotes.length) return dialog(this.root, { message: "This repository has no remotes.", action: null, cancel: "OK" });
          return this.run("Fetch", "fetch", { prune: true });
        }
        if (act === "abort") return this.run("Abort", "abortOperation", { state: this.data.info.state });
        if (act === "continue") return this.run("Continue", "continueOperation", { state: this.data.info.state });
        const copyEl = t.closest("[data-copy]");
        if (copyEl) return copyWithFeedback(copyEl);
        const parentBtn = t.closest("[data-parent]");
        if (parentBtn) return this.toggleDetails(this.rowIndexByKey(parentBtn.closest("[data-key]").dataset.key), { parent: Number(parentBtn.dataset.parent) });
        const fileEl = t.closest("[data-file]");
        if (fileEl) {
          const key = fileEl.closest("[data-key]").dataset.key;
          return this.openDiff(this.expanded.get(key).details.files[Number(fileEl.dataset.file)], key);
        }
        if (t.closest(".t3cg-details")) return;
        const tr = t.closest("tr.t3cg-row");
        if (tr) {
          this.hideCard();
          this.toggleDetails(Number(tr.dataset.i));
        }
      });
      root.addEventListener("mouseover", (e) => {
        // Pointer on the open file list: the card is in the way, close it.
        if (e.target.closest(".t3cg-details")) return this.hideCard();
        const tr = e.target.closest("tr.t3cg-row[data-i]");
        if (tr) this.scheduleCard(tr);
      });
      root.addEventListener("mouseout", (e) => {
        const tr = e.target.closest("tr.t3cg-row[data-i]");
        if (tr && !tr.contains(e.relatedTarget)) this.scheduleHide();
      });
      this.scroller.addEventListener("scroll", () => this.hideCard(), { passive: true });
      root.addEventListener("dblclick", (e) => {
        const ref = e.target.closest("[data-ref-type=head]");
        if (ref && ref.dataset.ref) {
          const b = this.data.refs.heads.find((x) => x.name === ref.dataset.ref);
          if (b && !b.current) this.run("Checkout branch", "checkoutBranch", { name: b.name });
        }
      });
      root.addEventListener("contextmenu", (e) => {
        if (e.target.closest(".t3cg-overlay,.t3cg-diff-overlay,.t3cg-dd,input,textarea")) return;
        const fileEl = e.target.closest("[data-file]");
        if (fileEl) {
          const key = fileEl.closest("[data-key]").dataset.key;
          return this.fileMenu(e, this.expanded.get(key).details.files[Number(fileEl.dataset.file)], key);
        }
        const ref = e.target.closest("[data-ref-type]");
        const tr = e.target.closest("tr.t3cg-row");
        if (!tr) return;
        const row = this.rows[Number(tr.dataset.i)];
        if (ref?.dataset.refType === "remote" && ref.dataset.ref) return this.remoteMenu(e, ref.dataset.ref);
        if (ref?.dataset.refType === "head" && ref.dataset.ref) return this.branchMenu(e, ref.dataset.ref);
        if (ref?.dataset.refType === "tag") return this.tagMenu(e, ref.dataset.ref);
        if (row.kind === "stash") return this.stashMenu(e, row);
        if (row.kind === "uncommitted") return this.uncommittedMenu(e);
        return this.commitMenu(e, row);
      });
      root.addEventListener("change", (e) => {
        if (e.target.dataset.act === "remotes") {
          this.prefs.showRemote = e.target.checked;
          savePrefs(this.prefs);
          this.load();
        }
      });
      const findInput = this.$(".t3cg-findbar input");
      findInput.addEventListener("input", () => {
        this.find.q = findInput.value;
        this.find.cur = 0;
        this.runFind(true);
      });
      findInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.stepFind(e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          this.closeFind();
        }
      });
      root.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !e.target.closest(".t3cg-overlay")) {
          e.preventDefault();
          e.stopPropagation();
          this.openFind();
        } else if (e.key === "Escape" && this.expanded.size && !e.target.closest("input,.t3cg-overlay,.t3cg-diff-overlay")) {
          this.expanded.clear();
          this.render();
        }
      });
    }
  }

  function renderDiff(text, { full = false } = {}) {
    if (!text.trim()) return `<div class="t3cg-muted" style="padding:12px">No textual changes.</div>`;
    const out = [];
    let oldN = 0;
    let newN = 0;
    // One number column: the new line number, or the old one (dimmed by CSS) on removed lines.
    let inHunk = false;
    for (const line of text.split("\n")) {
      if (line.startsWith("@@")) {
        const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
        if (m) {
          oldN = Number(m[1]);
          newN = Number(m[2]);
        }
        inHunk = true;
        if (!full) out.push(`<tr class="t3cg-d-hunk"><td></td><td>${esc(line)}</td></tr>`);
        continue;
      }
      if (!inHunk) {
        if (/^Binary files/.test(line)) out.push(`<tr class="t3cg-d-meta"><td></td><td>${esc(line)}</td></tr>`);
        continue;
      }
      if (line.startsWith("+")) out.push(`<tr class="t3cg-d-add"><td>${newN++}</td><td>${esc(line)}</td></tr>`);
      else if (line.startsWith("-")) out.push(`<tr class="t3cg-d-del"><td>${oldN++}</td><td>${esc(line)}</td></tr>`);
      else if (line.startsWith("\\")) out.push(`<tr class="t3cg-d-meta"><td></td><td>${esc(line)}</td></tr>`);
      else if (line.startsWith("diff --git")) inHunk = false;
      else if (line !== "" || inHunk) out.push(`<tr><td>${(oldN++, newN++)}</td><td>${esc(line)}</td></tr>`);
    }
    return `<table class="t3cg-diff">${out.join("")}</table>`;
  }

  // ---- T3's own diff renderer ---------------------------------------------------------
  // The optional patches in patches.cjs add export aliases to T3's diff chunks; here we import() those same
  // modules (the file names are hashed, so the loader lists them) and render T3's diff section component
  // (the one its Changes panel uses) through a portal from the surface's React tree. Anything missing leaves t3diff null and the plain view is used.
  let t3diffPromise = null;
  function loadT3Diff() {
    t3diffPromise ??= (async () => {
      try {
        const names = await (await fetch("/__t3mod/chunks.json", { cache: "no-store" })).json();
        const find = (re) => names.find((n) => re.test(n));
        const [dp, dr, rd] = await Promise.all([find(/^DiffPanel-/), find(/^diffRendering-/), find(/^react-dom-/)].map((n) => import(`/assets/${n}`)));
        const Section = dp.__t3mod_DiffSection;
        const parse = dr.__t3mod_parseDiffFromFile;
        const themeName = dr.__t3mod_themeName;
        const dom = (rd.t ?? Object.values(rd)[0])?.();
        if (typeof Section !== "function" || typeof parse !== "function" || typeof dom?.createPortal !== "function") throw new Error("exports missing");
        return { Section, parse, themeName, createPortal: dom.createPortal };
      } catch (e) {
        console.debug("[t3mod] commit-graph: T3 diff renderer unavailable, using the plain diff", e);
        return null;
      }
    })();
    return t3diffPromise;
  }

  let portalIds = 0;

  function Surface(props) {
    const R = props.React;
    const ref = R.useRef(null);
    const view = R.useRef(null);
    const [portals, setPortals] = R.useState([]);
    R.useLayoutEffect(() => {
      view.current = new GraphView(ref.current);
      view.current.react = { setPortals, jsx: props.jsx };
      return () => {
        view.current?.destroy();
        view.current = null;
      };
    }, []);
    R.useEffect(() => {
      view.current?.setProps({ cwd: props.workspaceRoot, visible: props.visible, threadRef: props.threadRef, t3: { environmentId: props.environmentId, projectId: props.projectId, composerDraftTarget: props.composerDraftTarget } });
    });
    return props.jsx("div", { ref, className: "t3cg-host", "data-t3mod": "commit-graph", children: portals.map((p) => p.render()) });
  }

  S.global("commitGraph", { Surface, Icon, menuItems, bindOpener, _layout: layout, _GraphView: GraphView, _dialog: dialog });
}
});
