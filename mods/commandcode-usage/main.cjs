"use strict";
// Reads Command Code plan usage and returns it to the renderer.
//
// The numbers come from Command Code's own API, using the login the CLI
// already has: COMMAND_CODE_API_KEY, else `apiKey` in ~/.commandcode/auth.json.
// Only a narrow IPC channel is exposed, and the reply holds usage, not secrets.

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const CHANNEL = "t3mod:commandcode-usage:fetch";
const DEFAULT_BASE = "https://api.commandcode.ai";
const CACHE_MS = 60_000;

const PLAN_LABELS = {
  "individual-go": "Go",
  "individual-go-v1": "Go",
  "individual-goat": "Goat",
  "individual-pro": "Pro",
  "individual-pro-v1": "Pro",
  "individual-provider": "Provider",
  "individual-max": "Max",
  "individual-ultra": "Ultra",
  "teams-pro": "Teams Pro",
};

const clampPercent = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
const isoFromMs = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);

function buildWindows({ credits, subscription, summary }) {
  const windows = [];

  const remainingMonthly = Number(credits?.credits?.monthlyCredits ?? 0);
  const spent = Number(summary?.totalCredits ?? 0);
  const monthlyTotal = remainingMonthly + spent;
  if (monthlyTotal > 0) {
    windows.push({
      id: "monthlyCredits",
      kind: "monthly",
      label: "Monthly credits",
      usedPercent: clampPercent((spent / monthlyTotal) * 100),
      resetsAt: subscription?.data?.currentPeriodEnd ?? undefined,
    });
  }

  const limits = credits?.windowLimits ?? {};
  const add = (id, kind, label, win, windowDurationMins) => {
    const cap = Number(win?.cap ?? 0);
    if (!(cap > 0)) return;
    windows.push({
      id,
      kind,
      label,
      usedPercent: clampPercent((Number(win?.used ?? 0) / cap) * 100),
      resetsAt: isoFromMs(Number(win?.resetAt)),
      windowDurationMins,
    });
  };
  add("fiveHour", "session", "5-hour limit", limits.fiveHour, 5 * 60);
  add("weekly", "weekly", "Weekly limit", limits.weekly, 7 * 24 * 60);

  return windows;
}

async function readAuthKey() {
  const fromEnv = process.env.COMMAND_CODE_API_KEY;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  try {
    const file = path.join(os.homedir(), ".commandcode", "auth.json");
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return typeof parsed.apiKey === "string" && parsed.apiKey ? parsed.apiKey : null;
  } catch {
    return null;
  }
}

async function getJson(base, key, route) {
  const response = await fetch(base + route, {
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`${route} -> HTTP ${response.status}`);
  return response.json();
}

async function fetchUsage() {
  const key = await readAuthKey();
  if (!key) throw new Error("Command Code is not logged in (no API key)");

  const base = (process.env.COMMANDCODE_API_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const whoami = await getJson(base, key, "/alpha/whoami?limits=1");
  const orgId = whoami?.org?.id ?? null;
  const withOrg = (route) => (orgId ? `${route}?orgId=${encodeURIComponent(orgId)}` : route);

  const [credits, subscription, summary] = await Promise.all([
    getJson(base, key, withOrg("/alpha/billing/credits")),
    getJson(base, key, withOrg("/alpha/billing/subscriptions")),
    getJson(base, key, withOrg("/alpha/usage/summary")),
  ]);

  const planId = subscription?.data?.planId ?? null;
  return {
    checkedAt: new Date().toISOString(),
    plan: planId,
    planLabel: planId ? PLAN_LABELS[planId] ?? planId : null,
    windows: buildWindows({ credits, subscription, summary }),
  };
}

module.exports.register = ({ scope, isTrustedSender, log: say }) => {
  let cache = null; // { at, data }
  let inflight = null;

  scope.ipcHandle(CHANNEL, async (event) => {
    if (!isTrustedSender(event)) return { ok: false, error: "untrusted sender" };

    if (cache && Date.now() - cache.at < CACHE_MS) return { ok: true, data: cache.data };
    if (!inflight) {
      inflight = (async () => {
        try {
          const data = await fetchUsage();
          cache = { at: Date.now(), data };
          return data;
        } finally {
          inflight = null;
        }
      })();
    }

    try {
      return { ok: true, data: await inflight };
    } catch (e) {
      say(`usage fetch failed: ${e?.message ?? e}`);
      return { ok: false, error: e?.message ?? String(e) };
    }
  });
};

module.exports._test = { buildWindows };
