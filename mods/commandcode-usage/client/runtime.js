import { scope } from "/__t3mod/kit.js";

// Renderer side of Command Code Usage. Fetches usage through the main process,
// then exposes it to the patched T3 chunks as an account object shaped exactly
// like the ones T3's usage module builds itself. T3 groups it into a pool and
// draws the bars, so there is no markup of our own.

const S = scope("commandcode-usage");

S.run(() => {
  let data = null;
  let inflight = null;

  function accounts() {
    if (!data || !Array.isArray(data.windows) || data.windows.length === 0) return [];
    return [
      {
        key: "commandcode:commandcode",
        driver: "commandcode",
        displayName: "Command Code",
        email: null,
        plan: data.planLabel ?? null,
        accentColor: "#e5544b",
        environments: [],
        sourceLabel: null,
        redeem: null,
        limits: {
          checkedAt: data.checkedAt,
          windows: data.windows,
        },
      },
    ];
  }

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const reply = await window.t3mod.invoke("t3mod:commandcode-usage:fetch", {});
        if (reply && reply.ok) data = reply.data;
      } catch {
        // Keep the last good numbers; the next refresh will retry.
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  S.global("commandcodeUsage", { accounts, refresh });
  S.interval(() => void refresh(), 5 * 60_000);
  void refresh();
});
