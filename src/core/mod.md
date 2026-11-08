---
id: core
name: Modloader
version: 0.1.0
author: t3-modloader
description: The Mods window and button. Built in, always loaded.
---

# Modloader

This is what loads the other mods: the **Mods** button in the sidebar and this window.

It is built in and always loaded. It can't be unloaded by accident, so you can't lock yourself out of your mods.

## Removing it

**Remove modloader** takes everything out, in order:

1. every loaded mod is unloaded
2. this window and the Mods button are removed
3. T3's files are restored to what they were before the installer changed them

Your mod files stay where they are. After the window reloads, restart T3 and it runs unmodified.
