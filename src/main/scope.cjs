"use strict";
// Transactional registration for the main process.
//
// A scope is a stack of disposers. Every way a mod (or the loader) changes T3
// goes through a helper below; each helper does the change and pushes the matching
// undo. Failure, unload, disable and hot reload all call scope.dispose(), so the
// cleanup logic exists once.
//
//   dispose(): runs the disposers newest first. A disposer that throws is
//   caught and reported; the rest still run. Safe to call twice.
//
// Anything a mod changes outside these helpers (monkey-patching by hand, a
// listener added straight on `electron`, a global it sets) cannot be undone here.
// Mods may only change T3 through the helpers; see README "Mod registration helpers".

/** @param {string} name  @param {{ onError?: (message: string, error: unknown) => void }} [opts] */
function createScope(name, opts = {}) {
  const stack = [];
  let closed = false;
  const report = (what, e) => {
    const message = `scope ${name}: ${what} failed: ${e?.message ?? e}`;
    try {
      (opts.onError ?? (() => {}))(message, e);
    } catch {}
  };

  /** Run `undo` on dispose (or earlier, by calling the returned function; it runs once). */
  function defer(undo, label = "cleanup") {
    if (typeof undo !== "function") throw new TypeError("defer(fn): fn must be a function");
    if (closed) {
      // a mod still setting up after its scope was disposed (async main): undo straight away
      try {
        undo();
      } catch (e) {
        report(label, e);
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
        report(label, e);
      }
    };
  }

  const scope = {
    name,
    get size() {
      return stack.length;
    },
    get closed() {
      return closed;
    },
    defer,

    /** ipcMain.handle(channel, fn); the handler is removed again on dispose. */
    ipcHandle(ipcMain, channel, fn) {
      ipcMain.handle(channel, fn);
      return defer(() => ipcMain.removeHandler(channel), `ipc handler ${channel}`);
    },
    /** ipcMain.on / once (kind), the listener is removed on dispose. */
    ipcOn(ipcMain, channel, fn, kind = "on") {
      ipcMain[kind](channel, fn);
      return defer(() => ipcMain.removeListener(channel, fn), `ipc listener ${channel}`);
    },
    /** emitter.on(event, fn); removed on dispose. Works for app, webContents, BrowserWindow, process... */
    on(emitter, event, fn) {
      emitter.on(event, fn);
      return defer(() => (emitter.off ?? emitter.removeListener).call(emitter, event, fn), `listener ${String(event)}`);
    },
    /**
     * Replace obj[key] with make(original). On dispose the original is put back; if something
     * else wrapped it in the meantime, ours becomes a pass-through instead of clobbering theirs.
     */
    patch(obj, key, make) {
      const original = obj[key];
      let alive = true;
      const replacement = make(function (...args) {
        return original.apply(this, args);
      });
      if (typeof replacement !== "function") throw new TypeError("patch(obj, key, make): make(original) must return a function");
      const wrapper = function (...args) {
        return (alive ? replacement : original).apply(this, args);
      };
      obj[key] = wrapper;
      return defer(() => {
        alive = false;
        if (obj[key] === wrapper) obj[key] = original;
      }, `patch ${String(key)}`);
    },
    timeout(fn, ms, ...args) {
      const t = setTimeout(() => {
        undo();
        fn(...args);
      }, ms);
      const undo = defer(() => clearTimeout(t), "timeout");
      return undo;
    },
    interval(fn, ms, ...args) {
      const t = setInterval(fn, ms, ...args);
      return defer(() => clearInterval(t), "interval");
    },
    /** Adopt a window (or create one: pass a function). It is closed and destroyed on dispose. */
    window(winOrCreate) {
      const win = typeof winOrCreate === "function" ? winOrCreate() : winOrCreate;
      defer(() => {
        if (win && !win.isDestroyed?.()) win.destroy();
      }, "window");
      return win;
    },
    /** Move another scope's disposers on top of this one (a finished transaction becoming permanent). */
    adopt(other) {
      for (const entry of other._take()) stack.push(entry);
    },
    _take() {
      const taken = stack.splice(0);
      closed = true;
      return taken;
    },

    /** Undo everything, newest first. Returns the errors that were swallowed. */
    dispose() {
      closed = true;
      const errors = [];
      while (stack.length) {
        const entry = stack.pop();
        try {
          entry();
        } catch (e) {
          errors.push(e);
          report(entry.label ?? "cleanup", e);
        }
      }
      return errors;
    },
  };
  return scope;
}

/** What a mod sees as ctx.scope: the helpers bound to its ipcMain, without the ability to dispose. */
function modFacing(scope, ipcMain) {
  return {
    ipcHandle: (channel, fn) => scope.ipcHandle(ipcMain, channel, fn),
    ipcOn: (channel, fn) => scope.ipcOn(ipcMain, channel, fn, "on"),
    ipcOnce: (channel, fn) => scope.ipcOn(ipcMain, channel, fn, "once"),
    on: scope.on,
    patch: scope.patch,
    timeout: scope.timeout,
    interval: scope.interval,
    window: scope.window,
    defer: scope.defer,
  };
}

module.exports = { createScope, modFacing };
