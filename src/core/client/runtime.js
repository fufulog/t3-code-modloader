// Mods modal: the sidebar "Mods" button opens it. Plain DOM, no dependency on T3's React.
// Left column: loaded mods. Right column: available (not loaded). Selecting one
// previews its mod.md; Load/Unload reloads the window to apply the change.
// Exposes globalThis.__t3mod.core = { icon, open, close }.

const NS = (globalThis.__t3mod ??= {});
if (!NS.core) {
  const CHANNEL = "t3mod:core:ops";
  const STYLE_URL = new URL("./style.css", import.meta.url).href;

  const ops = async (op, params) => {
    const bridge = window.t3mod;
    if (!bridge) throw new Error("The mod bridge is not available (needs the T3 desktop app)");
    const r = await bridge.invoke(CHANNEL, { op, ...params });
    if (!r?.ok) throw new Error(r?.error ?? `${op} failed`);
    return r.data;
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ---- markdown (small, safe subset: everything is escaped, links are not clickable) ----
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_([^_\s][^_]*)_/g, "$1<em>$2</em>")
      .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '<span class="t3m-link" title="$2">$1</span>');

  function markdown(src) {
    const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    const isBlockStart = (l) => /^(#{1,4}\s|```|>|\s*([-*+]|\d+\.)\s|---+\s*$)/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      let m;
      if (line.startsWith("```")) {
        const buf = [];
        for (i++; i < lines.length && !lines[i].startsWith("```"); i++) buf.push(lines[i]);
        i++;
        out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
        i++;
      } else if (/^---+\s*$/.test(line)) {
        out.push("<hr>");
        i++;
      } else if (line.startsWith(">")) {
        const buf = [];
        for (; i < lines.length && lines[i].startsWith(">"); i++) buf.push(lines[i].replace(/^>\s?/, ""));
        out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      } else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        for (; i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        const tag = ordered ? "ol" : "ul";
        out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${tag}>`);
      } else {
        const buf = [];
        for (; i < lines.length && lines[i].trim() && !isBlockStart(lines[i]); i++) buf.push(lines[i]);
        if (!buf.length) buf.push(lines[i++]);
        out.push(`<p>${inline(buf.join(" "))}</p>`);
      }
    }
    return out.join("");
  }

  // ---- icon ----------------------------------------------------------------------------
  // Lucide "blocks", the same stroke style as the neighbouring footer icons.
  const ICON = [
    ["rect", { width: 7, height: 7, x: 14, y: 3, rx: 1 }],
    ["path", { d: "M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" }],
  ];
  const icon = (jsx) =>
    jsx("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
      children: ICON.map(([tag, attrs], i) => jsx(tag, attrs, i)),
    });

  // ---- modal ---------------------------------------------------------------------------
  let styleLoaded = false;
  const ensureStyle = () => {
    if (styleLoaded) return;
    styleLoaded = true;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = STYLE_URL;
    link.dataset.t3mod = "core";
    document.head.appendChild(link);
  };

  let modal = null;

  function open() {
    if (modal) return modal.focus();
    ensureStyle();
    const lastFocus = document.activeElement;
    const st = { data: null, selected: null, busy: null, error: null };

    const root = document.createElement("div");
    root.className = "t3m-backdrop";
    root.innerHTML = `
      <div class="t3m-dialog" role="dialog" aria-modal="true" aria-label="Mods" tabindex="-1">
        <div class="t3m-head">
          <h2>Mods</h2>
          <span class="t3m-grow"></span>
          <button class="t3m-btn t3m-ghost" data-act="folder" title="Open the mods folder">Open folder</button>
          <button class="t3m-btn t3m-ghost" data-act="rescan" title="Look for new mods">Rescan</button>
          <button class="t3m-x" data-act="close" aria-label="Close">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'}</button>
        </div>
        <div class="t3m-cols">
          <section class="t3m-col"><h3>Loaded <span class="t3m-count" data-count="loaded"></span></h3><div class="t3m-list" data-list="loaded"></div></section>
          <section class="t3m-col"><h3>Available <span class="t3m-count" data-count="available"></span></h3><div class="t3m-list" data-list="available"></div></section>
        </div>
        <div class="t3m-preview" data-preview></div>
        <div class="t3m-foot"><span data-foot></span></div>
      </div>`;
    const dialog = root.firstElementChild;
    const $ = (sel) => root.querySelector(sel);

    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      modal = null;
      try {
        lastFocus?.focus?.();
      } catch {}
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };

    const item = (m) => {
      const bad = m.enabled && m.ok === false;
      return `<button class="t3m-item${st.selected === m.id ? " t3m-sel" : ""}${bad ? " t3m-bad" : ""}" data-id="${esc(m.id)}">
        <span class="t3m-name">${esc(m.name)}</span>
        ${m.version ? `<span class="t3m-ver">${esc(m.version)}</span>` : ""}
        ${m.kind === "zip" ? '<span class="t3m-tag">zip</span>' : ""}
        ${bad ? '<span class="t3m-tag t3m-tag-bad">not active</span>' : ""}
        ${m.description ? `<span class="t3m-desc">${esc(m.description)}</span>` : ""}
      </button>`;
    };

    function render() {
      const mods = st.data?.mods ?? [];
      const loaded = mods.filter((m) => m.enabled);
      const avail = mods.filter((m) => !m.enabled);
      if (st.selected && !mods.some((m) => m.id === st.selected)) st.selected = null;
      if (!st.selected) st.selected = (loaded[0] ?? avail[0])?.id ?? null;
      $('[data-count="loaded"]').textContent = loaded.length;
      $('[data-count="available"]').textContent = avail.length;
      $('[data-list="loaded"]').innerHTML = loaded.map(item).join("") || '<div class="t3m-empty">Nothing loaded.</div>';
      $('[data-list="available"]').innerHTML =
        avail.map(item).join("") || '<div class="t3m-empty">No other mods. Drop a folder or a .zip in the mods folder, then Rescan.</div>';

      const sel = mods.find((m) => m.id === st.selected);
      const pv = $("[data-preview]");
      if (!sel) {
        pv.innerHTML = `<div class="t3m-empty t3m-pad">${st.data ? "Select a mod to preview it." : "Loading…"}</div>`;
      } else {
        const bad = sel.enabled && sel.ok === false;
        const meta = [sel.version && `v${esc(sel.version)}`, sel.author && esc(sel.author), sel.kind === "zip" ? "zip" : "folder", esc(sel.file)].filter(Boolean).join(" · ");
        const problems = sel.problems.length ? `<div class="t3m-problems">${sel.problems.map((p) => `<div>${esc(p)}</div>`).join("")}</div>` : "";
        const label = st.busy ? (sel.enabled ? "Unloading…" : "Loading…") : sel.enabled ? "Unload" : "Load";
        pv.innerHTML = `
          <div class="t3m-pv-head">
            <div class="t3m-pv-title"><strong>${esc(sel.name)}</strong><span class="t3m-meta">${meta}</span></div>
            <button class="t3m-btn ${sel.enabled ? "" : "t3m-primary"}" data-act="toggle" data-id="${esc(sel.id)}" ${st.busy ? "disabled" : ""}>${label}</button>
          </div>
          ${bad ? '<div class="t3m-warn">Loaded, but not active: it does not match this version of T3.</div>' : ""}
          ${problems}
          <div class="t3m-md">${sel.markdown ? markdown(sel.markdown) : '<p class="t3m-muted">This mod has no mod.md description.</p>'}</div>`;
      }
      $("[data-foot]").textContent = st.error ? st.error : st.data ? `${st.data.modsDir}  ·  loading or unloading reloads T3` : "";
      $("[data-foot]").classList.toggle("t3m-error", !!st.error);
    }

    async function call(op, params) {
      st.error = null;
      try {
        st.data = await ops(op, params);
      } catch (e) {
        st.error = e.message;
        st.busy = null;
      }
      render();
    }

    root.addEventListener("mousedown", (e) => {
      if (e.target === root) close();
    });
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") return close();
      if (act === "folder") return void ops("openFolder").catch((err) => ((st.error = err.message), render()));
      if (act === "rescan") return void call("rescan");
      if (act === "toggle") {
        const mod = st.data?.mods.find((m) => m.id === e.target.closest("[data-id]").dataset.id);
        if (!mod || st.busy) return;
        st.busy = mod.id;
        render();
        return void call("setEnabled", { id: mod.id, enabled: !mod.enabled });
      }
      const id = e.target.closest(".t3m-item")?.dataset.id;
      if (id) {
        st.selected = id;
        render();
      }
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(root);
    modal = { focus: () => dialog.focus() };
    render();
    dialog.focus();
    call("list");
  }

  NS.core = {
    icon,
    open,
    close: () => document.querySelector(".t3m-backdrop [data-act=close]")?.click(),
    _markdown: markdown,
  };
}
