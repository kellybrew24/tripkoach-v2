# Accessibility — WCAG 2.1 AA

Target: **WCAG 2.1 level AA**, verified on a mid-range Android with TalkBack and on desktop with keyboard only.

## Contrast (measured, sRGB)

| Foreground | Background | Ratio | Requirement |
| --- | --- | --- | --- |
| `--text-strong` #1E1C1A | white | 16.99:1 | 4.5 ✔ |
| `--text-body` #2B2724 | paper #FDFBF8 | 14.33:1 | 4.5 ✔ |
| `--text-muted` #6F675E | white | 5.56:1 | 4.5 ✔ |
| `--text-muted` #6F675E | subtle #F8F5F0 | 5.11:1 | 4.5 ✔ |
| white | primary button #1E1C1A | 16.99:1 | 4.5 ✔ |
| white | accent button #AE6413 | 4.53:1 | 4.5 ✔ |
| white | danger button #B3261E | 6.54:1 | 4.5 ✔ |
| link #8A4E0F | white | 6.61:1 | 4.5 ✔ |
| pending #8A4E0F | gold-50 #FDF7EE | 6.21:1 | 4.5 ✔ |
| confirmed #0E6E52 | green-50 #E9F5F0 | 5.57:1 | 4.5 ✔ |
| cancelled #57504A | n-100 #F1EDE6 | 6.79:1 | 4.5 ✔ |
| failed #B3261E | red-50 #FDECEA | 5.72:1 | 4.5 ✔ |
| refunded #1A5F8A | blue-50 #EAF2F8 | 6.09:1 | 4.5 ✔ |
| paid #0A543F | green-100 #CDE9DF | 6.94:1 | 4.5 ✔ |
| input border #8A837A | white | 3.74:1 | 3.0 ✔ (UI) |
| brand gold #D08028 | white | 3.09:1 | 3.0 ✔ (graphic only — never text) |
| dark: #F7F4EF | #141312 | 16.92:1 | 4.5 ✔ |
| dark: gold-300 #E8B871 | #141312 | 10.19:1 | 4.5 ✔ |
| dark: #121110 | gold-300 button | 10.35:1 | 4.5 ✔ |

`--text-subtle` #A8A096 (2.58:1) is **decorative only** — dividers and disabled glyphs, never text a user must read.

## Focus
- Global `:focus-visible` ring: 3px solid `--focus-ring` (ink; gold-300 on dark) at 2px offset. Never removed.
- Inputs also darken their border on focus, so focus is legible for users who cannot see the outline colour.
- Focus order follows DOM order. Modals set `role="dialog" aria-modal="true"`, close on Escape, and return focus
  to the trigger. `ErrorSummary` takes focus when it appears.

## Keyboard maps
**Checkout wizard** — Tab moves through fields in visual order; the stepper's completed steps are real buttons,
so Shift-Tab reaches them; Enter submits the step; the sticky Continue/Back bar is last in DOM order but reads
"Back, Total, Continue". Step changes announce through `aria-live="polite"` on the "Step 2 of 5" line.
**Departure picker** — a fieldset of toggle buttons: Tab in, arrow keys or Tab between options, Space/Enter to
select, sold-out options are `disabled` and skipped. Selection is exposed with `aria-pressed`.
**Tabs** — arrow keys move, Home/End jump, only the selected tab is in the tab order.
**Accordion** — each header is a button with `aria-expanded` and `aria-controls`; panels are `role="region"`.
**Number stepper** — buttons are labelled "Add one traveller" / "Remove one traveller"; the value is an
`<output aria-live="polite">`.

## Screen-reader semantics
- Every input is wrapped in `FormField`, which wires `htmlFor`, `aria-describedby` (help + error) and
  `aria-invalid`. Errors are `role="alert"`.
- Prices carry a visually hidden currency code ("GH₵1,800 GHS") and an optional `srPrefix` ("Total").
- Status is always in words as well as colour; the dot is `aria-hidden`.
- Loading regions set `aria-busy` and include a hidden `role="status"` message; skeletons themselves are
  `aria-hidden`.
- Results counts and pagination labels are `aria-live="polite"`.
- Icon-only controls require `label`; decorative icons are `aria-hidden`.

## Touch and motion
- 44×44 minimum on every interactive element; 48px default button height; stepper buttons 40px inside a 48px shell.
- Bottom nav and sticky bars add `env(safe-area-inset-bottom)`.
- `prefers-reduced-motion: reduce` sets all duration tokens to 0ms and stops the skeleton shimmer.

## Known gaps
- Focus trapping inside `Modal` is not implemented in the demo components (Escape and scrim click are).
  Production should add a trap.
- The photo gallery is represented by placeholders; carousel keyboard behaviour is unspecified until real
  media handling is chosen.
