# CSS Scale-Up via Design Tokens — Design Spec

## Goal

Scale up the game board, tokens, labels, graveyards, and side panel to fill the screen — eliminating wasted blank space — using CSS custom properties (design tokens) so all sizes are controlled from one place and the layout stays responsive.

## Architecture

CSS-only. No JS changes. Replace hardcoded `px`/`rem` sizes throughout `styles.css` with CSS custom properties defined in `:root`. Bump the default values up to fill available viewport space. Add a responsive breakpoint that scales them down on smaller screens.

## Design Tokens

Add these to `:root` alongside existing color variables:

```css
/* ── Size tokens ── */
--cell-size: 64px;
--board-gap: 3px;
--board-padding: 5px;
--frame-padding: 8px 16px 16px 8px;
--label-width: 28px;
--label-font: 0.8rem;
--token-ratio: 75%;
--side-panel-width: 300px;
--graveyard-slot: 32px;
--graveyard-font: 0.6rem;
--graveyard-label-font: 0.55rem;
```

Every hardcoded size in the board, frame, labels, tokens, graveyards, and side panel section references these tokens instead of literal values.

## Scaling Strategy

### Fill the screen

The game layout currently uses `grid-template-columns: 1fr 280px` with a `max-width: 1000px` on `.game .page-frame`. The board grid cells size themselves implicitly from the `1fr` column.

To fill the screen:
- Remove or significantly increase the `max-width` on `.game .page-frame` (or set to something like `1400px`).
- The board grid uses `1fr` columns, so cells naturally grow to fill available width. But `aspect-ratio: 1` on cells means height follows width — so a wider board = taller cells = bigger tokens.
- The `--cell-size` token sets a `min-width` on cells as a floor, ensuring they don't shrink below a readable size on large screens where the grid might not fill width.

### Board cells

Cells keep `aspect-ratio: 1` — this is the key mechanism. The grid column tracks expand to fill the board container width, and `aspect-ratio: 1` makes cells square. `--cell-size` acts as a `min-width` floor.

### SVG tokens

Tokens use `width: var(--token-ratio); height: var(--token-ratio)` (default 75%, up from 70%). Since the SVG uses `viewBox`, it scales perfectly — no font-size changes needed inside the SVG.

### Side panel

Width increases from 280px to `var(--side-panel-width)` (300px default). The `max-height: 80vh` stays for scroll containment.

### Graveyards

Slot size increases from 28px to `var(--graveyard-slot)` (32px). Font sizes bump proportionally.

### Board frame + labels

Frame padding and label column width reference tokens. Label font size bumps to 0.8rem from 0.7rem.

## Responsive

### Desktop (>700px, default)

Full-size tokens. Board fills available width up to `max-width`.

### Mobile (≤700px)

Override tokens to smaller values:

```css
@media (max-width: 700px) {
  :root {
    --cell-size: 40px;
    --label-width: 20px;
    --label-font: 0.6rem;
    --side-panel-width: 100%;
    --graveyard-slot: 24px;
    --graveyard-font: 0.5rem;
  }
}
```

Single-column layout (already handled by existing media query).

## Files Changed

- **Modify:** `web/css/styles.css` — add size tokens to `:root`, replace hardcoded sizes throughout, increase `.game .page-frame` max-width, update mobile breakpoint with scaled-down token overrides.

## Non-Goals

- No JS changes.
- No changes to SVG viewBox or internal SVG dimensions (they scale automatically).
- No changes to setup screen sizing (can be a follow-up if desired).
- No changes to home page layout.
