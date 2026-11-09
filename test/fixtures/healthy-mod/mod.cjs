"use strict";
// A well-behaved mod that must keep working while others fail around it.
const W = globalThis.__T3TEST;
module.exports = {
  main({ scope }) {
    scope.ipcHandle("t3mod:healthy:ping", () => "pong");
    scope.on(W.emitter, "evt", () => W.ticks.healthyEvt++);
    scope.interval(() => W.ticks.healthy++, 5);
  },
};
