# Frontend quality & accessibility

## Every screen has four states
Loading (skeleton/spinner, no layout jump), empty (explain + a next action), error (plain message + retry), and success. Build all four.

## Accessibility (WCAG 2.2 AA basics)
- Semantic HTML first: `button` for actions, `a` for navigation, real `label`s for inputs, headings in order, `main`/`nav` landmarks.
- Everything works with the keyboard; visible focus; logical tab order; Escape closes dialogs; focus moves into/out of modals.
- Text contrast ≥ 4.5:1 (3:1 large text/icons); don't use color alone for meaning; respect `prefers-reduced-motion`.
- Images have `alt` (empty for decorative); icon-only buttons have `aria-label`; form errors are announced and tied to fields (`aria-describedby`).

## UX
- Clear primary action per screen; destructive actions confirm or allow undo; disable buttons while submitting (prevent double submit) and show progress.
- Forms: validate on blur/submit with specific messages; keep user input on error; sensible `autocomplete`/`inputmode`.
- Copy: short, plain words, sentence case; say what happened and what to do next.
- Responsive from 360px wide; touch targets ≥ 44px.

## State & performance
- Keep state as close to where it's used as possible; derive instead of duplicating; server data via the framework's data layer (not ad-hoc effects).
- Avoid layout shift (reserve space for images); lazy-load below-the-fold; don't ship huge dependencies for small features; memoize only after measuring.

## Design consistency
Reuse the project's design system/components and tokens (spacing, colors, radii). A new component needs a reason.
