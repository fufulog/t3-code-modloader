---
id: commandcode-usage
name: Command Code Usage
version: 0.1.0
author: joseph
description: Adds Command Code's plan usage bars to T3 Code's Usage panel.
---

# Command Code Usage

Adds a **Command Code** section to T3's Usage panel (Limits view), with bars for
your monthly credits, the 5-hour limit and the weekly limit.

## What you get

- A Command Code provider row in the Usage panel, using the numbers from your
  Command Code account (credits, 5-hour cap and weekly cap).
- It refreshes together with T3's own usage refresh, using the same command, so
  the numbers update when you click **Refresh limits**.
- It refreshes on its own every five minutes while T3 is open.

## Notes

- It reads your existing Command Code login: the `COMMAND_CODE_API_KEY`
  environment variable, or the API key in `~/.commandcode/auth.json`. No login is
  stored or changed by this mod.
- Only usage is read over the network; nothing is sent anywhere else.
- If a T3 update moves the code this mod hooks into, it turns itself off and T3
  runs unmodified.
