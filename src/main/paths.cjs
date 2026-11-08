"use strict";
// Where the modloader keeps its own state, per platform.
const os = require("node:os");
const path = require("node:path");

/** config.json (enabled mods) and install.json (what the installer changed). */
function configDir() {
  if (process.env.T3MOD_CONFIG_DIR) return process.env.T3MOD_CONFIG_DIR;
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "t3-modloader");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "t3-modloader");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "t3-modloader");
}

/** Patched copies of T3 (AppImage installs) live here. */
function dataDir() {
  if (process.env.T3MOD_DATA_DIR) return process.env.T3MOD_DATA_DIR;
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "t3-modloader");
  if (process.platform === "darwin") return configDir();
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "t3-modloader");
}

module.exports = { configDir, dataDir };
