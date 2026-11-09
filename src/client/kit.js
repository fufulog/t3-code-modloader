// Renderer-side registration helpers, served at /__t3mod/kit.js (an ES module).
//
//   import { scope } from "/__t3mod/kit.js";
//   const S = scope("my-mod");
//   S.run(() => { ...setup using S.on / S.style / S.add / S.timeout / S.global... });
//
// Every helper does the change and records its undo. If run() throws (or its promise
// rejects), everything registered so far is undone newest first, a disposer that throws
// is logged and the rest still run, and the loader is told so the Mods window shows the
// mod as failed. The same S.dispose() is the unload / hot-reload path.
//
// Anything a mod changes without these helpers cannot be undone automatically.

const NS = (globalThis.__t3mod ??= {});
const scopes = (NS.scopes ??= new Map());

export function scope(id) {
  scopes.get(id)?.dispose(); // hot reload: the previous run of this mod goes first
  const stack = [];
  let closed = false;
  const warn = (what, e) => {
    try {
      console.warn(`[t3mod] ${id}: ${what} failed: ${e?.message ?? e}`);
    } catch {}
  };

  const defer = (undo, label = "cleanup") => {
    if (typeof undo !== "function") throw new TypeError("defer(fn): fn must be a function");
    if (closed) {
      try {
        undo();
      } catch (e) {
        warn(label, e);
      }
      return () => {};
    }
    let done = false;
    const entry = () => {
      if (done) return;
      done = true;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      undo();
    };
    entry.label = label;
    stack.push(entry);
    return () => {
      try {
        entry();
      } catch (e) {
        warn(label, e);
      }
    };
  };

  const report = (error) => {
    try {
      const reason = String(error?.message ?? error).split("\n")[0].slice(0, 300);
      return Promise.resolve(window.t3mod?.invoke("t3mod:loader:report", { mod: id, phase: "renderer", error: reason })).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };

  const S = {
    id,
    get closed() {
      return closed;
    },
    defer,
    /** target.addEventListener(type, fn, opts); removed on dispose (or by calling the returned function). */
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      return defer(() => target.removeEventListener(type, fn, opts), `listener ${type}`);
    },
    timeout(fn, ms, ...args) {
      const t = setTimeout(() => {
        off();
        fn(...args);
      }, ms);
      const off = defer(() => clearTimeout(t), "timeout");
      return off;
    },
    interval(fn, ms, ...args) {
      const t = setInterval(fn, ms, ...args);
      return defer(() => clearInterval(t), "interval");
    },
    /** Append `el` to `parent` (default <body>); it is removed again on dispose. */
    add(el, parent = document.body) {
      parent.appendChild(el);
      defer(() => el.remove(), "element");
      return el;
    },
    /** A stylesheet: pass a URL (a <link>) or { css } (a <style>). Removed on dispose. */
    style(hrefOrCss) {
      const css = typeof hrefOrCss === "object" && hrefOrCss !== null;
      const el = document.createElement(css ? "style" : "link");
      if (css) el.textContent = hrefOrCss.css;
      else {
        el.rel = "stylesheet";
        el.href = hrefOrCss;
      }
      el.dataset.t3mod = id;
      return S.add(el, document.head);
    },
    /** Publish an API on globalThis.__t3mod[name] for patched T3 chunks; deleted on dispose. */
    global(name, value) {
      NS[name] = value;
      defer(() => {
        if (NS[name] === value) delete NS[name];
      }, `global ${name}`);
      return value;
    },
    /** Replace obj[key] with make(original); put back on dispose (pass-through if someone wrapped it since). */
    patch(obj, key, make) {
      const original = obj[key];
      let alive = true;
      const replacement = make(function (...args) {
        return original.apply(this, args);
      });
      const wrapper = function (...args) {
        return (alive ? replacement : original).apply(this, args);
      };
      obj[key] = wrapper;
      return defer(() => {
        alive = false;
        if (obj[key] === wrapper) obj[key] = original;
      }, `patch ${String(key)}`);
    },
    /**
     * Run the mod's setup. On a throw (or a rejected promise) undo everything registered so
     * far and tell the loader. Returns the setup's result, or undefined after a failure.
     */
    run(setup) {
      const fail = (e) => {
        S.dispose();
        warn("setup", e);
        report(e);
      };
      try {
        const result = setup(S);
        if (result && typeof result.then === "function") return result.then((v) => v, (e) => void fail(e));
        return result;
      } catch (e) {
        fail(e);
      }
    },
    /** Undo everything, newest first. */
    dispose() {
      closed = true;
      if (scopes.get(id) === S) scopes.delete(id);
      while (stack.length) {
        const entry = stack.pop();
        try {
          entry();
        } catch (e) {
          warn(entry.label ?? "cleanup", e);
        }
      }
    },
  };
  scopes.set(id, S);
  return S;
}
