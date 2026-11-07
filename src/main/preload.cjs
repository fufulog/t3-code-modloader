"use strict";
// Sandboxed preload (frame type) registered on T3's default session.
// Exposes a narrow bridge only in the T3 app document; browser previews run in
// separate partitions and never see this, and the main side re-checks the sender.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "t3code:" || location.protocol === "t3code-dev:") {
  if (window.top === window) {
    contextBridge.exposeInMainWorld("t3mod", {
      version: 1,
      invoke: (channel, payload) => {
        if (typeof channel !== "string" || !/^t3mod:[a-z0-9-]+:[a-zA-Z0-9-]+$/.test(channel)) {
          return Promise.reject(new Error("invalid t3mod channel"));
        }
        return ipcRenderer.invoke(channel, payload);
      },
    });
  }
}
