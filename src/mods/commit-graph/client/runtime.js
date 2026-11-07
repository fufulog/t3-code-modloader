// Commit Graph surface: renderer runtime.
//
// Loaded as an ES module by the patched client chunks (import "/__t3mod/...").
// Exposes globalThis.__t3mod.commitGraph = { Surface, Icon, menuItems, bindOpener }.
// The view itself is plain DOM inside one React host element, so it does not
// depend on T3's React internals beyond the props the patch passes in.

const NS = (globalThis.__t3mod ??= {});
if (!NS.commitGraph) {
  const STYLE_URL = new URL("./style.css", import.meta.url).href;
  const CHANNEL = "t3mod:commit-graph:git";
  const ROW_H = 24;
  const LANE_W = 16;
  const NODE_R = 4;
  const COLORS = ["#0085d9", "#d9008f", "#00d90a", "#d98500", "#a300d9", "#ff0000", "#00d9cc", "#e138e8", "#85d900", "#dc5b23", "#6f24d6", "#ffcc00"];
  const UNCOMMITTED = "#808080";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
  const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

  // ---- opener / menu ------------------------------------------------------------
  const opener = { ref: null, store: null };
  let jsxRuntime = null;
  const ICON_PATHS = [
    ["circle", { cx: 5, cy: 6, r: 3 }],
    ["path", { d: "M5 9v6" }],
    ["circle", { cx: 5, cy: 18, r: 3 }],
    ["path", { d: "M12 3v18" }],
    ["circle", { cx: 19, cy: 6, r: 3 }],
    ["path", { d: "M16 15.7A9 9 0 0 0 19 9" }],
  ];
  function Icon(props) {
    const jsx = props?.jsx ?? jsxRuntime;
    if (!jsx) return null;
    return jsx("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: props?.className,
      "aria-hidden": true,
      children: ICON_PATHS.map(([tag, attrs], i) => jsx(tag, attrs, i)),
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
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (sec) => {
    const d = new Date(sec * 1000);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtLong = (sec) => new Date(sec * 1000).toString().replace(/ \(.+\)$/, "");
  const SVG = {
    branch: `<svg viewBox="0 0 16 16" class="t3cg-ico"><path fill="currentColor" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z"/></svg>`,
    tag: `<svg viewBox="0 0 16 16" class="t3cg-ico"><path fill="currentColor" d="M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25zM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>`,
    stash: `<svg viewBox="0 0 16 16" class="t3cg-ico"><path fill="currentColor" d="M2.75 2h10.5c.966 0 1.75.784 1.75 1.75v1.5A1.75 1.75 0 0 1 14 6.79v5.46A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25V6.79A1.75 1.75 0 0 1 1 5.25v-1.5C1 2.784 1.784 2 2.75 2zm.75 5v5.25c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V7zm-.75-3.5a.25.25 0 0 0-.25.25v1.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-1.5a.25.25 0 0 0-.25-.25zM6 8.75A.75.75 0 0 1 6.75 8h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 6 8.75z"/></svg>`,
    find: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/></svg>`,
    fetch: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
    close: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18 6 6 18M6 6l12 12"/></svg>`,
    up: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m18 15-6-6-6 6"/></svg>`,
    down: `<svg viewBox="0 0 24 24" class="t3cg-ico"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" class="t3cg-ico t3cg-chev"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>`,
    folder: `<svg viewBox="0 0 16 16" class="t3cg-ico"><path fill="currentColor" d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1z"/></svg>`,
    file: `<svg viewBox="0 0 16 16" class="t3cg-ico"><path fill="currentColor" d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5zm6.75.062V4.25c0 .138.112.25.25.25h2.688z"/></svg>`,
  };

  let styleLoaded = false;
  function ensureStyle() {
    if (styleLoaded) return;
    styleLoaded = true;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = STYLE_URL;
    link.dataset.t3mod = "commit-graph";
    document.head.appendChild(link);
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

  function rowSvg(g, width, kind, isHead) {
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
    const w = width * LANE_W;
    return `<svg class="t3cg-graph" width="${w}" height="${ROW_H}" viewBox="0 0 ${w} ${ROW_H}">${paths}${node}</svg>`;
  }

  function continuationSvg(after, width) {
    const w = width * LANE_W;
    let paths = "";
    after.forEach((l, i) => {
      if (l) paths += `<path d="M${X(i)} 0L${X(i)} 1" stroke="${l.color}" vector-effect="non-scaling-stroke"${l.dashed ? ' stroke-dasharray="2 2"' : ""}/>`;
    });
    return `<svg class="t3cg-graph t3cg-graph-cont" width="${w}" height="100%" viewBox="0 0 ${w} 1" preserveAspectRatio="none">${paths}</svg>`;
  }

  // ---- dialog -----------------------------------------------------------------------
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
      this.expanded = null; // { key, details }
      this.fingerprint = null;
      this.find = { open: false, q: "", matches: [], cur: -1 };
      this.loadSeq = 0;
      this.prefs = loadPrefs();
      this.prefs.widths ??= {};
      host.innerHTML = `
        <div class="t3cg" tabindex="-1">
          <div class="t3cg-toolbar">
            <div class="t3cg-repo"><span class="t3cg-repo-name"></span></div>
            <button type="button" class="t3cg-dd-btn" data-act="branches"><span class="t3cg-muted">Branches:</span> <span class="t3cg-dd-label">Show All</span>${SVG.chevron}</button>
            <label class="t3cg-check t3cg-toolbar-check"><input type="checkbox" data-act="remotes"/> <span>Show Remote Branches</span></label>
            <div class="t3cg-state"></div>
            <div class="t3cg-spacer"></div>
            <span class="t3cg-status"></span>
            <button type="button" class="t3cg-icon-btn" data-act="find" title="Find (Ctrl+F)">${SVG.find}</button>
            <button type="button" class="t3cg-icon-btn" data-act="fetch" title="Fetch from remote(s)">${SVG.fetch}</button>
            <button type="button" class="t3cg-icon-btn" data-act="refresh" title="Refresh">${SVG.refresh}</button>
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
              <colgroup><col data-col="graph"/><col data-col="desc"/><col data-col="date"/><col data-col="author"/><col data-col="hash"/></colgroup>
              <thead><tr>
                <th data-col="graph">Graph<span class="t3cg-resize" data-col="graph"></span></th>
                <th data-col="desc">Description<span class="t3cg-resize" data-col="desc"></span></th>
                <th data-col="date">Date<span class="t3cg-resize" data-col="date"></span></th>
                <th data-col="author">Author<span class="t3cg-resize" data-col="author"></span></th>
                <th data-col="hash">Commit</th>
              </tr></thead>
              <tbody></tbody>
            </table>
            <div class="t3cg-message"></div>
          </div>
        </div>`;
      this.root = host.firstElementChild;
      this.$ = (sel) => this.root.querySelector(sel);
      this.tbody = this.$("tbody");
      this.scroller = this.$(".t3cg-scroll");
      this.$("[data-act=remotes]").checked = this.prefs.showRemote !== false;
      this.bind();
      this.timer = setInterval(() => this.poll(), 3000);
      this.onFocus = () => this.poll();
      window.addEventListener("focus", this.onFocus);
    }

    destroy() {
      clearInterval(this.timer);
      window.removeEventListener("focus", this.onFocus);
      this.host.innerHTML = "";
    }

    setProps({ cwd, visible, threadRef }) {
      this.threadRef = threadRef;
      this.visible = visible !== false;
      if (cwd !== this.cwd) {
        this.cwd = cwd;
        this.maxCommits = PAGE;
        this.expanded = null;
        this.data = null;
        this.fingerprint = null;
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
      this.$(".t3cg-repo-name").innerHTML = `${esc(info.name)}${info.branch ? ` <span class="t3cg-muted">on</span> ${SVG.branch}<span>${esc(info.branch)}</span>` : ` <span class="t3cg-muted">(detached HEAD)</span>`}`;
      const rp = this.repoPrefs();
      this.$(".t3cg-dd-label").textContent = rp.branches?.length ? (rp.branches.length === 1 ? rp.branches[0].replace(/^refs\/(heads|remotes)\//, "") : `${rp.branches.length} selected`) : "Show All";
      const st = this.$(".t3cg-state");
      st.innerHTML = info.state
        ? `<span class="t3cg-state-pill">${esc(info.state[0].toUpperCase() + info.state.slice(1))}…</span>${info.state !== "merging" ? `<button type="button" class="t3cg-btn t3cg-btn-sm" data-act="continue">Continue</button>` : ""}<button type="button" class="t3cg-btn t3cg-btn-sm" data-act="abort">Abort</button>`
        : "";

      this.rows = this.buildRows();
      const lay = layout(this.rows);
      this.layout = lay;
      const graphW = this.prefs.widths.graph ?? Math.min(Math.max(lay.width * LANE_W + 8, 64), 360);
      this.applyWidths(graphW);

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
        const cls = ["t3cg-row", merge ? "t3cg-merge" : "", isHead ? "t3cg-head" : "", row.kind === "uncommitted" ? "t3cg-uncommitted" : "", this.expanded?.key === key ? "t3cg-expanded" : ""].filter(Boolean).join(" ");
        html.push(`<tr class="${cls}" data-i="${i}">
          <td class="t3cg-c-graph">${rowSvg(g, lay.width, row.kind, isHead)}</td>
          <td class="t3cg-c-desc"><span class="t3cg-desc">${labels}${stashLabel}<span class="t3cg-subject">${esc(row.subject)}</span></span></td>
          <td class="t3cg-c-date">${row.kind === "uncommitted" ? "*" : esc(fmtDate(row.date))}</td>
          <td class="t3cg-c-author" title="${esc(row.email ?? "")}">${row.kind === "uncommitted" ? "*" : esc(row.author)}</td>
          <td class="t3cg-c-hash">${row.kind === "uncommitted" ? "*" : esc(short(row.hash))}</td>
        </tr>`);
        if (this.expanded?.key === key) html.push(this.detailsHtml(row, g, lay.width));
      });
      if (this.data.hasMore) html.push(`<tr class="t3cg-more"><td colspan="5"><button type="button" class="t3cg-btn" data-act="more">Load More Commits</button></td></tr>`);
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

    applyWidths(graphW) {
      const w = this.prefs.widths;
      const cols = this.root.querySelectorAll("col");
      const set = (name, px) => {
        const col = [...cols].find((c) => c.dataset.col === name);
        if (col) col.style.width = px ? `${px}px` : "";
      };
      set("graph", graphW);
      set("desc", null);
      set("date", w.date ?? 118);
      set("author", w.author ?? 100);
      set("hash", w.hash ?? 74);
    }

    // ---- details panel
    detailsHtml(row, g, width) {
      const d = this.expanded?.details;
      let body;
      if (!d) body = `<div class="t3cg-muted t3cg-details-loading">Loading…</div>`;
      else if (d.error) body = `<div class="t3cg-error">${esc(d.error)}</div>`;
      else if (row.kind === "uncommitted") body = `<div class="t3cg-details-files t3cg-details-full">${this.filesHtml(d)}</div>`;
      else {
        const parentsHtml = d.parents.map((p) => `<a class="t3cg-hash-link" data-goto="${esc(p)}">${esc(short(p))}</a>`).join(", ") || "None";
        const sameCommitter = d.committer === d.author && d.committerEmail === d.email;
        const parentSel =
          d.parents.length > 1
            ? `<div class="t3cg-parent-sel">Compare with parent: ${d.parents
                .map((p, i) => `<button type="button" class="t3cg-btn t3cg-btn-sm${d.comparedTo === p ? " t3cg-btn-on" : ""}" data-parent="${i + 1}">${i + 1}: ${esc(short(p))}</button>`)
                .join("")}</div>`
            : "";
        body = `<div class="t3cg-details-summary">
            <div class="t3cg-kv"><b>Commit:</b> <span class="t3cg-mono">${esc(d.hash)}</span> <a class="t3cg-copy" data-copy="${esc(d.hash)}" title="Copy">copy</a></div>
            <div class="t3cg-kv"><b>Parents:</b> <span class="t3cg-mono">${parentsHtml}</span></div>
            <div class="t3cg-kv"><b>Author:</b> ${esc(d.author)} &lt;<a class="t3cg-mail">${esc(d.email)}</a>&gt;</div>
            ${sameCommitter ? "" : `<div class="t3cg-kv"><b>Committer:</b> ${esc(d.committer)} &lt;${esc(d.committerEmail)}&gt;</div>`}
            <div class="t3cg-kv"><b>Date:</b> ${esc(fmtLong(d.date))}</div>
            ${row.kind === "stash" ? `<div class="t3cg-kv"><b>Stash:</b> ${esc(row.selector)}</div>` : ""}
            <div class="t3cg-body">${esc(d.body)}</div>
          </div>
          <div class="t3cg-details-files">${parentSel}${this.filesHtml(d)}</div>`;
      }
      return `<tr class="t3cg-details-row"><td class="t3cg-c-graph">${continuationSvg(g.after, width)}</td><td colspan="4"><div class="t3cg-details">
        <button type="button" class="t3cg-icon-btn t3cg-details-close" data-act="close-details" title="Close">${SVG.close}</button>${body}</div></td></tr>`;
    }

    filesHtml(d) {
      if (!d.files.length) return `<div class="t3cg-muted">No file changes.</div>`;
      const tree = { dirs: new Map(), files: [] };
      d.files.forEach((f, i) => {
        const parts = f.path.split("/");
        let node = tree;
        for (const p of parts.slice(0, -1)) {
          if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [] });
          node = node.dirs.get(p);
        }
        node.files.push({ ...f, i, name: parts.at(-1) });
      });
      // Collapse single-child folder chains like VS Code's compact folders.
      const render = (node, depth, prefix) => {
        let out = "";
        for (const [name, child] of [...node.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
          let label = name;
          let n = child;
          while (n.files.length === 0 && n.dirs.size === 1) {
            const [[cn, cc]] = n.dirs;
            label += "/" + cn;
            n = cc;
          }
          const key = prefix + label;
          const collapsed = this.expanded?.collapsed?.has(key);
          out += `<div class="t3cg-tree-dir" style="--depth:${depth}" data-dir="${esc(key)}">${SVG.chevron.replace("t3cg-chev", `t3cg-chev${collapsed ? " t3cg-collapsed" : ""}`)}${SVG.folder}<span>${esc(label)}</span></div>`;
          if (!collapsed) out += render(n, depth + 1, key + "/");
        }
        for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
          const stat = f.additions == null ? (f.status === "U" ? "" : `<span class="t3cg-muted">binary</span>`) : `<span class="t3cg-add">+${f.additions}</span><span class="t3cg-del">-${f.deletions}</span>`;
          const renamed = f.oldPath && f.oldPath !== f.path ? `<span class="t3cg-muted t3cg-renamed">← ${esc(f.oldPath)}</span>` : "";
          out += `<div class="t3cg-tree-file t3cg-st-${esc(f.status)}" style="--depth:${depth}" data-file="${f.i}" title="${esc(f.path)}">${SVG.file}<span class="t3cg-fname">${esc(f.name)}</span>${renamed}<span class="t3cg-st">${esc(f.status === "U" ? "U" : f.status)}</span><span class="t3cg-stat">${stat}</span></div>`;
        }
        return out;
      };
      const totalAdd = d.files.reduce((s, f) => s + (f.additions ?? 0), 0);
      const totalDel = d.files.reduce((s, f) => s + (f.deletions ?? 0), 0);
      return `<div class="t3cg-files-head">${d.files.length} file${d.files.length === 1 ? "" : "s"} changed <span class="t3cg-add">+${totalAdd}</span> <span class="t3cg-del">-${totalDel}</span></div><div class="t3cg-tree">${render(tree, 0, "")}</div>`;
    }

    async toggleDetails(i, opts = {}) {
      const row = this.rows[i];
      const key = row.kind === "uncommitted" ? "*" : row.hash;
      if (this.expanded?.key === key && !opts.parent) {
        this.expanded = null;
        return this.render();
      }
      const collapsed = this.expanded?.key === key ? this.expanded.collapsed : new Set();
      this.expanded = { key, details: null, collapsed, row };
      if (!opts.parent) this.render();
      try {
        const details = row.kind === "uncommitted" ? await git("uncommittedDetails", { cwd: this.cwd }) : await git("details", { cwd: this.cwd, hash: row.hash, parent: opts.parent });
        if (this.expanded?.key !== key) return;
        this.expanded.details = details;
      } catch (e) {
        if (this.expanded?.key !== key) return;
        this.expanded.details = { error: e.message };
      }
      this.render();
      const tr = this.tbody.querySelector(".t3cg-details-row");
      tr?.scrollIntoView({ block: "nearest" });
    }

    // ---- diff viewer
    async openDiff(file) {
      const d = this.expanded?.details;
      if (!d) return;
      const isUncommitted = this.expanded.key === "*";
      const overlay = document.createElement("div");
      overlay.className = "t3cg-diff-overlay";
      overlay.tabIndex = -1;
      const title = `${esc(file.path)}${file.oldPath && file.oldPath !== file.path ? ` <span class="t3cg-muted">(renamed from ${esc(file.oldPath)})</span>` : ""}`;
      overlay.innerHTML = `<div class="t3cg-diff-head"><span class="t3cg-st-${esc(file.status)} t3cg-st">${esc(file.status)}</span><span class="t3cg-diff-title">${title}</span>
        <span class="t3cg-muted t3cg-mono">${isUncommitted ? "Uncommitted" : `${esc(short(d.comparedTo ?? ""))}${d.comparedTo ? " ↔ " : ""}${esc(short(d.hash))}`}</span>
        <div class="t3cg-spacer"></div><button type="button" class="t3cg-icon-btn" data-act="close" title="Close (Escape)">${SVG.close}</button></div>
        <div class="t3cg-diff-body"><div class="t3cg-muted" style="padding:12px">Loading diff…</div></div>`;
      const close = () => {
        overlay.remove();
        this.root.focus();
      };
      overlay.addEventListener("click", (e) => e.target.closest("[data-act=close]") && close());
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      });
      this.root.appendChild(overlay);
      overlay.focus();
      try {
        const res = await git("fileDiff", {
          cwd: this.cwd,
          hash: isUncommitted ? "*" : d.hash,
          base: isUncommitted ? undefined : d.comparedTo ?? undefined,
          path: file.path,
          oldPath: file.oldPath,
          untracked: isUncommitted && file.status === "U",
        });
        overlay.querySelector(".t3cg-diff-body").innerHTML = renderDiff(res.diff) + (res.truncated ? `<div class="t3cg-muted" style="padding:8px">Diff truncated.</div>` : "");
      } catch (e) {
        overlay.querySelector(".t3cg-diff-body").innerHTML = `<div class="t3cg-error" style="padding:12px">${esc(e.message)}</div>`;
      }
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
      this.root.querySelector(".t3cg-dd")?.remove();
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
          <label class="t3cg-dd-opt t3cg-dd-all"><input type="checkbox" data-all ${selected.size ? "" : "checked"}/> <span>Show All</span></label>
          ${opts.map((o) => `<label class="t3cg-dd-opt" data-label="${esc(o.label.toLowerCase())}"><input type="checkbox" data-ref="${esc(o.ref)}" ${selected.has(o.ref) ? "checked" : ""}/> <span>${esc(o.label)}</span></label>`).join("")}
        </div>`;
      const r = btn.getBoundingClientRect();
      const rr = this.root.getBoundingClientRect();
      dd.style.left = `${r.left - rr.left}px`;
      dd.style.top = `${r.bottom - rr.top + 4}px`;
      this.root.appendChild(dd);
      const input = dd.querySelector("input[type=text]");
      input.focus();
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
        this.expanded = null;
        this.load();
      });
      const away = (e) => {
        if (!dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
          dd.remove();
          document.removeEventListener("mousedown", away, true);
        }
      };
      document.addEventListener("mousedown", away, true);
      dd.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          dd.remove();
          document.removeEventListener("mousedown", away, true);
        }
      });
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

    async fileMenu(ev, file) {
      const d = this.expanded?.details;
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
      if (id === "diff") this.openDiff(file);
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
        if (act === "more") {
          this.maxCommits += PAGE;
          return this.load();
        }
        if (act === "close-details") {
          this.expanded = null;
          return this.render();
        }
        if (act === "fetch") {
          if (!this.remotes.length) return dialog(this.root, { message: "This repository has no remotes.", action: null, cancel: "OK" });
          return this.run("Fetch", "fetch", { prune: true });
        }
        if (act === "abort") return this.run("Abort", "abortOperation", { state: this.data.info.state });
        if (act === "continue") return this.run("Continue", "continueOperation", { state: this.data.info.state });
        const copyEl = t.closest("[data-copy]");
        if (copyEl) return copy(copyEl.dataset.copy);
        const go = t.closest("[data-goto]");
        if (go) {
          const i = this.rows.findIndex((r) => r.hash === go.dataset.goto);
          if (i >= 0) {
            this.tbody.querySelector(`tr[data-i="${i}"]`)?.scrollIntoView({ block: "center" });
            return this.toggleDetails(i);
          }
          return;
        }
        const parentBtn = t.closest("[data-parent]");
        if (parentBtn) return this.toggleDetails(this.rows.indexOf(this.expanded.row), { parent: Number(parentBtn.dataset.parent) });
        const dir = t.closest("[data-dir]");
        if (dir) {
          const set = this.expanded.collapsed;
          set.has(dir.dataset.dir) ? set.delete(dir.dataset.dir) : set.add(dir.dataset.dir);
          return this.render();
        }
        const fileEl = t.closest("[data-file]");
        if (fileEl) return this.openDiff(this.expanded.details.files[Number(fileEl.dataset.file)]);
        if (t.closest(".t3cg-details")) return;
        const tr = t.closest("tr.t3cg-row");
        if (tr) this.toggleDetails(Number(tr.dataset.i));
      });
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
        if (fileEl) return this.fileMenu(e, this.expanded.details.files[Number(fileEl.dataset.file)]);
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
        } else if (e.key === "Escape" && this.expanded && !e.target.closest("input,.t3cg-overlay,.t3cg-diff-overlay")) {
          this.expanded = null;
          this.render();
        }
      });
      // column resizing
      root.addEventListener("mousedown", (e) => {
        const handle = e.target.closest(".t3cg-resize");
        if (!handle) return;
        e.preventDefault();
        const col = handle.dataset.col;
        const th = handle.parentElement;
        const startX = e.clientX;
        const startW = th.getBoundingClientRect().width;
        const target = col === "desc" ? "date" : col;
        const targetStart = col === "desc" ? this.$('th[data-col="date"]').getBoundingClientRect().width : startW;
        const move = (ev) => {
          const dx = ev.clientX - startX;
          const w = Math.max(40, Math.round(col === "desc" ? targetStart - dx : startW + dx));
          this.prefs.widths[target] = w;
          const c = this.root.querySelector(`col[data-col="${target}"]`);
          if (c) c.style.width = `${w}px`;
        };
        const up = () => {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          root.classList.remove("t3cg-resizing");
          savePrefs(this.prefs);
        };
        root.classList.add("t3cg-resizing");
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
      root.querySelectorAll("th").forEach((th) =>
        th.addEventListener("dblclick", () => {
          const col = th.dataset.col;
          if (col && this.prefs.widths[col] !== undefined) {
            delete this.prefs.widths[col];
            savePrefs(this.prefs);
            if (this.data) this.render();
          }
        }),
      );
    }
  }

  function renderDiff(text) {
    if (!text.trim()) return `<div class="t3cg-muted" style="padding:12px">No textual changes.</div>`;
    const out = [];
    let oldN = 0;
    let newN = 0;
    let inHunk = false;
    for (const line of text.split("\n")) {
      if (line.startsWith("@@")) {
        const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
        if (m) {
          oldN = Number(m[1]);
          newN = Number(m[2]);
        }
        inHunk = true;
        out.push(`<tr class="t3cg-d-hunk"><td></td><td></td><td>${esc(line)}</td></tr>`);
        continue;
      }
      if (!inHunk) {
        if (/^Binary files/.test(line)) out.push(`<tr class="t3cg-d-meta"><td></td><td></td><td>${esc(line)}</td></tr>`);
        continue;
      }
      if (line.startsWith("+")) out.push(`<tr class="t3cg-d-add"><td></td><td>${newN++}</td><td>${esc(line)}</td></tr>`);
      else if (line.startsWith("-")) out.push(`<tr class="t3cg-d-del"><td>${oldN++}</td><td></td><td>${esc(line)}</td></tr>`);
      else if (line.startsWith("\\")) out.push(`<tr class="t3cg-d-meta"><td></td><td></td><td>${esc(line)}</td></tr>`);
      else if (line.startsWith("diff --git")) inHunk = false;
      else if (line !== "" || inHunk) out.push(`<tr><td>${oldN++}</td><td>${newN++}</td><td>${esc(line)}</td></tr>`);
    }
    return `<table class="t3cg-diff">${out.join("")}</table>`;
  }

  function Surface(props) {
    const R = props.React;
    const ref = R.useRef(null);
    const view = R.useRef(null);
    R.useLayoutEffect(() => {
      view.current = new GraphView(ref.current);
      return () => {
        view.current?.destroy();
        view.current = null;
      };
    }, []);
    R.useEffect(() => {
      view.current?.setProps({ cwd: props.workspaceRoot, visible: props.visible, threadRef: props.threadRef });
    });
    return props.jsx("div", { ref, className: "t3cg-host", "data-t3mod": "commit-graph" });
  }

  NS.commitGraph = { Surface, Icon, menuItems, bindOpener, _layout: layout, _GraphView: GraphView, _dialog: dialog };
}
