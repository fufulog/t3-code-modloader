---
id: commit-graph
name: Commit Graph
version: 0.1.0
author: joseph
description: A VS Code Git Graph-style commit graph in T3's right panel.
---

# Commit Graph

A **Git Graph**-style view of your repository, as a surface in T3's right panel.

## What you get

- Branch lanes with per-row indentation, like VS Code's Git Graph
- Hover card with the full message, hash (click to copy) and refs
- Expandable file lists with Material Icon Theme file icons and diff on click
- Several commits can be expanded at once
- Fetch, pull, push, branch filter, search, and the usual commit and branch actions

## Where it shows up

Open it from the **+** menu in the right panel, or from the "Open a surface" launcher, under *Pull request*.

## Notes

- Git runs on this machine, so it works with local projects only.
- If a T3 update moves the code this mod hooks into, it turns itself off and T3 runs unmodified.
