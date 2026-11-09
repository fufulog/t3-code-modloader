"use strict";
// Registers one of every resource kind through ctx.scope, in a fixed order, and throws
// right after the stage named by W.failAt. "async" rejects after everything is registered.
const W = globalThis.__T3TEST;
const at = (stage) => {
  if (W.failAt === stage) throw new Error(`boom at ${stage}\nsecond line that must not show`);
};
at("load");

module.exports = {
  main({ electron, ipcMain, scope }) {
    at("main-start");
    scope.ipcHandle("t3mod:failing:handle", () => "x");
    at("after-ipc-handle");
    ipcMain.on("t3mod:failing:legacy", () => {}); // the old ipcMain proxy is tracked too
    at("after-ipc-proxy");
    scope.ipcOn("t3mod:failing:on", () => {});
    at("after-ipc-on");
    scope.on(W.emitter, "evt", () => {});
    at("after-listener");
    scope.patch(W.target, "fn", (original) => (...a) => ["patched", ...original(...a)]);
    at("after-patch");
    scope.timeout(() => W.ticks.timeout++, 15);
    at("after-timeout");
    scope.interval(() => W.ticks.interval++, 5);
    at("after-interval");
    scope.window(() => new electron.BrowserWindow());
    at("after-window");
    scope.defer(() => W.deferred.push("custom"));
    at("after-defer");
    if (W.failAt === "async") return Promise.resolve().then(() => Promise.reject(new Error("boom at async")));
  },
};
