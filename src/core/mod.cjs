"use strict";
// Built-in: the Mods button in the sidebar footer and the modal behind it.
// The renderer talks to the loader over t3mod:core:ops (list, rescan, setEnabled, apply, remove, openFolder).
module.exports = {
  patches: require("./patches.cjs"),
  main({ scope, isTrustedSender, loader, log }) {
    scope.ipcHandle("t3mod:core:ops", async (event, payload) => {
      if (!isTrustedSender(event)) return { ok: false, error: "untrusted sender" };
      try {
        switch (payload?.op) {
          case "list":
            return { ok: true, data: loader.list() };
          case "rescan":
            return { ok: true, data: loader.rescan() };
          case "setEnabled":
            if (typeof payload.id !== "string" || typeof payload.enabled !== "boolean") throw new Error("bad arguments");
            return { ok: true, data: loader.setEnabled(payload.id, payload.enabled) };
          case "apply": {
            const c = payload.changes;
            if (!c || typeof c !== "object" || Object.values(c).some((v) => typeof v !== "boolean")) throw new Error("bad arguments");
            return { ok: true, data: loader.setEnabledMany(c) };
          }
          case "remove":
            return { ok: true, data: loader.removeModloader() };
          case "openFolder":
            return { ok: true, data: (await loader.openFolder()) || null };
          default:
            throw new Error(`unknown op ${payload?.op}`);
        }
      } catch (e) {
        log(`ops ${payload?.op} failed: ${e.message}`);
        return { ok: false, error: e.message };
      }
    });
  },
};
