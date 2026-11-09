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
  const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const CLOSE = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
  const REFRESH = svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>');
  const ARROW_R = svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>');
  const ARROW_L = svg('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>');
  const LOCK = svg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>');
  const FOLDER = svg('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>');
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
    const st = { data: null, selected: null, busy: null, error: null, confirm: false, steps: null, pending: new Map() };
    // Load/Unload only stage a change; "Confirm" applies all of them at once (one window reload).
    const want = (m) => (st.pending.has(m.id) ? st.pending.get(m.id) : m.enabled);

    const root = document.createElement("div");
    root.className = "t3m-backdrop";
    root.innerHTML = `
      <div class="t3m-dialog" role="dialog" aria-modal="true" aria-label="Mods" tabindex="-1">
        <div class="t3m-head">
          <h2>Mods</h2>
          <span class="t3m-grow"></span>
          <button class="t3m-iconbtn" data-act="folder" title="Open the mods folder" aria-label="Open the mods folder">${FOLDER}</button>
          <button class="t3m-iconbtn" data-act="rescan" title="Rescan for new mods" aria-label="Rescan for new mods">${REFRESH}</button>
          <button class="t3m-iconbtn" data-act="close" title="Close" aria-label="Close">${CLOSE}</button>
        </div>
        <div class="t3m-cols">
          <section class="t3m-col"><h3>Loaded <span class="t3m-count" data-count="loaded"></span></h3><div class="t3m-list" data-list="loaded"></div></section>
          <section class="t3m-col"><h3>Available <span class="t3m-count" data-count="available"></span></h3><div class="t3m-list" data-list="available"></div></section>
        </div>
        <div class="t3m-preview" data-preview></div>
        <div class="t3m-foot"><span class="t3m-foot-text" data-foot></span><button class="t3m-btn" data-act="discard" data-pending-only>Discard</button><button class="t3m-btn" data-act="apply" data-pending-only>Confirm</button></div>
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
      const moved = st.pending.has(m.id);
      const on = want(m);
      const card = `<button class="t3m-item${st.selected === m.id ? " t3m-sel" : ""}${bad ? " t3m-bad" : ""}" data-id="${esc(m.id)}">
        <span class="t3m-name">${esc(m.name)}</span>
        ${m.version ? `<span class="t3m-ver">${esc(m.version)}</span>` : ""}
        ${m.builtin ? `<span class="t3m-tag">${LOCK} built in</span>` : ""}
        ${m.kind === "zip" ? '<span class="t3m-tag">zip</span>' : ""}
        ${bad ? '<span class="t3m-tag t3m-tag-bad">not active</span>' : ""}
        ${moved ? `<span class="t3m-tag t3m-tag-pending">${on ? "will load" : "will unload"}</span>` : ""}
        ${m.description ? `<span class="t3m-desc">${esc(m.description)}</span>` : ""}
      </button>`;
      // Quick move: loaded cards get an arrow to their right (unload), available cards one to their left (load).
      const label = on ? "Unload" : "Load";
      const arrow = m.builtin
        ? '<span class="t3m-arrow-gap"></span>'
        : `<button class="t3m-iconbtn t3m-arrow" data-act="toggle" data-id="${esc(m.id)}" title="${label} ${esc(m.name)}" aria-label="${label} ${esc(m.name)}" ${st.busy ? "disabled" : ""}>${on ? ARROW_R : ARROW_L}</button>`;
      return `<div class="t3m-row">${on ? card + arrow : arrow + card}</div>`;
    };

    function render() {
      const mods = st.data?.mods ?? [];
      for (const id of st.pending.keys()) if (!mods.some((m) => m.id === id)) st.pending.delete(id);
      const loaded = mods.filter(want);
      const avail = mods.filter((m) => !want(m));
      if (st.selected && !mods.some((m) => m.id === st.selected)) st.selected = null;
      if (!st.selected) st.selected = (loaded[0] ?? avail[0])?.id ?? null;
      $('[data-count="loaded"]').textContent = loaded.length;
      $('[data-count="available"]').textContent = avail.length;
      $('[data-list="loaded"]').innerHTML = loaded.map(item).join("") || '<div class="t3m-empty">Nothing loaded.</div>';
      $('[data-list="available"]').innerHTML =
        avail.map(item).join("") || '<div class="t3m-empty">No other mods. Drop a folder or a .zip in the mods folder, then Rescan.</div>';

      const sel = mods.find((m) => m.id === st.selected);
      const pv = $("[data-preview]");
      if (st.steps) {
        pv.innerHTML = `<div class="t3m-pv-head"><div class="t3m-pv-title"><strong>Removing the modloader</strong></div></div>
          <ul class="t3m-steps">${st.steps.map((x) => `<li class="${x.ok ? "t3m-ok" : "t3m-fail"}">${x.ok ? "✓" : "✗"} ${esc(x.label)}${x.detail ? `<span class="t3m-meta"> ${esc(x.detail)}</span>` : ""}</li>`).join("")}</ul>
          <p class="t3m-muted">Your mod files were not touched. T3 reloads in a moment; restart it afterwards to run unmodified.</p>`;
      } else if (st.confirm && sel?.builtin) {
        const loaded = mods.filter((m) => m.enabled && !m.builtin);
        const inst = st.data.install;
        pv.innerHTML = `<div class="t3m-pv-head"><div class="t3m-pv-title"><strong>Remove the modloader?</strong></div></div>
          <p>This runs in order:</p>
          <ol class="t3m-plan">
            <li>Unload ${loaded.length ? loaded.map((m) => `<strong>${esc(m.name)}</strong>`).join(", ") : "the loaded mods (none are loaded)"}</li>
            <li>Remove this window and the Mods button</li>
            <li>${inst?.installed ? "Restore T3 to its original files (undo what the installer changed)" : "Restore T3's files (nothing to restore: it was not set up by the installer)"}</li>
          </ol>
          <p class="t3m-muted">Your mod files stay in the mods folder. Restart T3 afterwards.</p>
          <div class="t3m-actions"><button class="t3m-btn" data-act="cancel">Cancel</button><button class="t3m-btn t3m-danger-solid" data-act="remove" ${st.busy ? "disabled" : ""}>${st.busy ? "Removing…" : "Remove modloader"}</button></div>`;
      } else if (!sel) {
        pv.innerHTML = `<div class="t3m-empty t3m-pad">${st.data ? "Select a mod to preview it." : "Loading…"}</div>`;
      } else {
        const bad = sel.enabled && sel.ok === false;
        const meta = [sel.version && `v${esc(sel.version)}`, sel.author && esc(sel.author), sel.builtin ? "built in" : sel.kind === "zip" ? "zip" : "folder", !sel.builtin && esc(sel.file)].filter(Boolean).join(" · ");
        const problems = sel.problems.length ? `<div class="t3m-problems">${sel.problems.map((p) => `<div>${esc(p)}</div>`).join("")}</div>` : "";
        const label = want(sel) ? "Unload" : "Load";
        const action = sel.builtin
          ? `<button class="t3m-btn t3m-danger" data-act="confirm-remove">Remove modloader…</button>`
          : `<button class="t3m-btn" data-act="toggle" data-id="${esc(sel.id)}" ${st.busy ? "disabled" : ""}>${label}</button>`;
        pv.innerHTML = `
          <div class="t3m-pv-head">
            <div class="t3m-pv-title"><strong>${esc(sel.name)}</strong><span class="t3m-meta">${meta}</span></div>
            ${action}
          </div>
          ${bad ? `<div class="t3m-warn">${sel.compat?.compatible === false ? esc(sel.compat.reason) + ": loaded, but not active." : "Loaded, but not active: it does not match this version of T3."}</div>` : ""}
          ${problems}
          <div class="t3m-md">${sel.markdown ? markdown(sel.markdown) : '<p class="t3m-muted">This mod has no mod.md description.</p>'}</div>`;
      }
      const n = st.pending.size;
      for (const b of root.querySelectorAll("[data-pending-only]")) b.hidden = !n;
      const apply = $('[data-act="apply"]');
      const adds = [...st.pending.values()].filter(Boolean).length;
      const drops = n - adds;
      apply.textContent = st.busy === "apply" ? "Applying…" : ["Confirm", adds && `+${adds}`, drops && `−${drops}`].filter(Boolean).join(" ");
      apply.title = "Apply the staged changes and reload T3";
      apply.disabled = !!st.busy;
      $('[data-act="discard"]').disabled = !!st.busy;
      $("[data-foot]").textContent = st.error ? st.error : st.data ? (n ? `${n} change${n > 1 ? "s" : ""} not applied yet. Confirm reloads T3.` : `${st.data.modsDir}`) : "";
      $("[data-foot]").classList.toggle("t3m-error", !!st.error);
    }

    async function call(op, params) {
      st.error = null;
      try {
        st.data = await ops(op, params);
      } catch (e) {
        st.error = e.message;
        st.busy = null;
        render();
        return false;
      }
      render();
      return true;
    }

    root.addEventListener("mousedown", (e) => {
      if (e.target === root) close();
    });
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") return close();
      if (act === "folder") return void ops("openFolder").catch((err) => ((st.error = err.message), render()));
      if (act === "rescan") {
        // Spin the icon while scanning, for at least one full turn so a fast scan is still visible.
        const btn = e.target.closest("[data-act]");
        if (btn.classList.contains("t3m-spinning")) return;
        btn.classList.add("t3m-spinning");
        return void Promise.all([call("rescan"), new Promise((r) => setTimeout(r, 800))]).then(() => btn.classList.remove("t3m-spinning"));
      }
      if (act === "confirm-remove") {
        st.confirm = true;
        return render();
      }
      if (act === "cancel") {
        st.confirm = false;
        return render();
      }
      if (act === "remove") {
        st.busy = "remove";
        render();
        return void ops("remove").then(
          (r) => {
            st.steps = r.steps;
            st.busy = null;
            render();
          },
          (err) => {
            st.error = err.message;
            st.busy = null;
            render();
          },
        );
      }
      if (act === "toggle") {
        const mod = st.data?.mods.find((m) => m.id === e.target.closest("[data-id]").dataset.id);
        if (!mod || mod.builtin || st.busy) return;
        const next = !want(mod);
        next === mod.enabled ? st.pending.delete(mod.id) : st.pending.set(mod.id, next);
        return render();
      }
      if (act === "discard") {
        st.pending.clear();
        return render();
      }
      if (act === "apply") {
        if (!st.pending.size || st.busy) return;
        st.busy = "apply";
        render();
        return void call("apply", { changes: Object.fromEntries(st.pending) }).then((ok) => {
          if (!ok) return;
          st.pending.clear();
          render();
        });
      }
      const id = e.target.closest(".t3m-item")?.dataset.id;
      if (id) {
        st.selected = id;
        st.confirm = false;
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
