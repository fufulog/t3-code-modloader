# dev/scratchpad

The throwaway scripts used to check changes in the real, running T3 (and to pull apart T3's bundle), kept as examples to copy from. They were written for one-off checks, so many are small and specific. They are not part of the loader or the tests.

Live scripts (run in T3's **main process**; each finds the T3 window with `webContents.getAllWebContents()` and works on its page with `executeJavaScript`):

```sh
node bin/t3mod-inject.mjs --eval-only dev/scratchpad/chk.js                       # no inject, just run it
node bin/t3mod-inject.mjs --eval-only dev/scratchpad/t3v.js --arg out=/tmp/shots  # --arg out=<dir> is where PNGs go (ARGS.out)
```

Inject first (`node bin/t3mod-inject.mjs`) after editing a mod so the window reloads with the new code. See `AGENTS.md` ("The development loop") for the pattern and the pitfalls.

Worth knowing:

| Script | What it does |
| --- | --- |
| `chk.js` | is the Mods button present, and which mods the loader reports ok |
| `probe.js`, `check.js` | early probes of the Commit Graph surface (is `.t3cg` there; expand a commit and read its file list) |
| `mods*.js`, `st*.js`, `arr*.js` | Mods window: open it via the `Mods` button, Rescan, stage arrows, Confirm / Discard, screenshots |
| `spin.js`, `sp2.js` | find and check the spinner animation CSS used for the Rescan icon |
| `tb.js`, `tb2.js` | Commit Graph toolbar: icon positions and a screenshot; `tb2.js` also opens the "more" menu and reads it |
| `fv.js` | open the first commit's first file diff, toggle Diff / Full file, screenshot each, count rows (plain diff view) |
| `t3v.js`, `t3v2.js` | open a file diff and check T3's own diff component rendered; screenshot |
| `t3c.js`, `t3d.js` | hover a diff line and click T3's blue "+" gutter button (needs `PointerEvent`s) to open the comment editor |
| `t3e.js`, `t3f.js` | type a comment, press Comment, check it reached the chat composer (screenshot of the whole window) |
| `t3g.js`, `t3h.js`, `t3i.js` | find and press "Delete comment" afterwards, so the test leaves the composer clean |
| `t3l.js` | the "Use legacy diff" toggle both ways, and that it is remembered |
| `t3m.js`, `t3p.js` | screenshot / probe the T3 diff's shadow DOM (`diffs-container`) |
| `ext.cjs <app.asar> <out dir>` | extract T3's client files (`apps/server/dist/client`) from an asar, to read the chunks and find anchors (plain node, not live) |
| `cmp.cjs <a.asar> <b.asar>` | compare two asars and print T3's entry file start (used to check installer output; plain node) |

Everything else (`card.js`, `dd*.js`, `df*.js`, `hov.js`, `indent.js`, `multi.js`, ...) is a one-off check of a single UI tweak from the same session (hover card, details indent, copy button, dropdowns, ...). Read a script before reusing it; some depend on the state T3 was in at the time.
