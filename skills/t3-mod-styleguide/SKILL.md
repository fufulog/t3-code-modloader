---
name: t3-mod-styleguide
description: Visual and interaction rules for UI that T3 modloader mods add to T3 Code (theme variables, modal shell, cards, buttons, icons, type, motion, staging changes, accessibility). Use when designing, styling or reviewing any mod UI, modal, button, panel or icon, and from the t3-create-mod skill.
---

# T3 mod style guide

Mod UI should look like T3 made it. Reference implementation: `src/core/client/style.css` (the Mods window) and `mods/commit-graph/client/style.css`.

## Colour and theme

- Use T3's CSS variables only: `--background`, `--foreground`, `--muted-foreground`, `--border`, `--input`, `--accent`, `--primary`, `--destructive`, `--ring`, `--popover`, `--card`, `--control-radius`, `--font-mono`. Light and dark then work for free.
- Derive tints with `color-mix(in oklab, var(--foreground) 8%, transparent)`. Hard-code a colour only when it is data (e.g. graph lanes).

## Modal shell (copy it)

- Backdrop: `fixed; inset: 0; z-index: 50`, padding 24px (40px from 1024px), `rgb(0 0 0 / .32)` plus `blur(4px)`.
- Dialog: `--background`, 1px `--border`, radius 16px, shadow `0 25px 50px -12px rgb(0 0 0 / .4)`, `width: min(64rem, 100%)`, fill the screen under 640px.
- Header 52px with a bottom border, title 14px weight 500, icon buttons on the right. Footer: 8px 24px, top border, 12px muted text.
- Enter: 150ms ease-out, opacity plus `scale(.985)`. Escape and a click on the backdrop close it. Restore focus to the opener.

## Components

- **Cards:** radius 12px, border at 70% of `--border`, hover `--accent`, selected foreground 8%.
- **Buttons:** neutral outline (height 32, radius 8, 1px `--input`, transparent, hover `--accent`). Never a solid primary fill for ordinary actions. Destructive: red outline; a solid red fill only on the final confirm of a destructive flow.
- **Icon buttons:** 28px, muted, foreground on hover, no border.
- **Tags:** inline-flex, nowrap, radius 6px, 11px, muted background.
- **Icons:** Lucide style (24 viewBox, `stroke="currentColor"`, width 2, round caps and joins), shown at 16px. Match neighbouring icons; reuse T3's own glyph when one exists for the concept.

## Type and copy

- Base 14px; secondary 13px; meta 12px in `--muted-foreground`. Weights 400 and 500 (600 only for a preview title).
- Sentence case, short, plain words. Empty states say what to do next. Errors go in the footer in `--destructive`.

## Motion

- 150ms ease-out for entrances. Spinners are linear, 0.8 to 1s per turn, and stay visible for at least one full turn so fast work still registers.
- Honour `prefers-reduced-motion` (slow or stop the animation).

## Interaction

- Do not apply on every click. Stage changes (move the card, tag it "will load"), then apply them with one explicit button; offer Discard. Anything that reloads T3 or is hard to undo needs this, and destructive flows show an ordered plan first.
- Disable controls while busy. Say whose UX a change affects.

## CSS hygiene

- Prefix every class (`t3m-`, `cg-`) and scope all rules under it; never style bare tags.
- Tailwind preflight is active in T3: set `list-style`, `font-weight`, margins and `font: inherit` on buttons yourself.
- Give icon-only controls `aria-label` and `title`; dialogs get `role="dialog" aria-modal="true"` and a label; use `:focus-visible` with `--ring`.

## Check before you finish

Screenshot the mod in the live T3 (`bin/t3mod-inject.mjs --eval-only`, `capturePage`). Compare it with T3's own modal next to it; fix any mismatch in radius, border, text size or hover colour.
