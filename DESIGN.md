---
name: Vikrant's Dev Studio
description: A software team you can talk to, kept as a workshop's commission book in sage and black.
colors:
  sage: "#9cb29e"
  black: "#000000"
  sage-paper: "#dfe8df"
  sage-paper-pale: "#eef3ee"
  sage-inset: "#f8fbf8"
  sage-grey: "#c3d2c4"
  sage-rule-tint: "#c9d6ca"
  ink-soft: "#1f2a20"
  ink-muted: "#344035"
  night-paper: "#0f1410"
  night-paper-raised: "#171e18"
  night-inset: "#0a0d0a"
  night-bubble: "#2a352b"
  night-paused: "#232d24"
  night-grid: "#242e25"
  blocked-red: "#b3261e"
  blocked-red-night: "#ff6b5e"
  blocked-red-night-text: "#ff8a7e"
  white: "#ffffff"
typography:
  display:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "46px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 72"
  display-fit:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "42px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 72"
  display-container:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "36px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 72"
  display-phone:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 72"
  display-step-30:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.1
  display-step-26:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1
  ledger-numeral:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 62"
    fontFeature: "'tnum' 1"
  headline:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.15
  title:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "23px"
    fontWeight: 750
    lineHeight: 1.2
  headline-compact:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.2
  title-compact:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "21px"
    fontWeight: 750
    lineHeight: 1.2
  body:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.3
  ui-large:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "19px"
    fontWeight: 650
    lineHeight: 1.15
  ui:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.15
  body-small:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.3
  label:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "0.07em"
    fontVariation: "'wdth' 68"
  meta:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.2
  label-small:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.1
  stamp:
    fontFamily: "Archivo, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "0.07em"
    fontVariation: "'wdth' 68"
  mono:
    fontFamily: "ui-monospace, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  none: "0px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  gutter: "clamp(16px, 2.4vw, 32px)"
components:
  button-primary:
    backgroundColor: "{colors.black}"
    textColor: "{colors.sage}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "9px 16px"
    height: "42px"
  button-primary-night:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.black}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "9px 16px"
    height: "42px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.black}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "9px 16px"
    height: "42px"
  button-start:
    backgroundColor: "{colors.black}"
    textColor: "{colors.sage}"
    typography: "{typography.ui-large}"
    rounded: "{rounded.none}"
    padding: "11px 20px"
    height: "48px"
  panel:
    backgroundColor: "{colors.sage-paper}"
    textColor: "{colors.black}"
    rounded: "{rounded.none}"
    padding: "16px 18px"
  panel-night:
    backgroundColor: "{colors.night-paper}"
    textColor: "{colors.sage-paper}"
    rounded: "{rounded.none}"
    padding: "16px 18px"
  header-band:
    backgroundColor: "{colors.black}"
    textColor: "{colors.sage}"
    padding: "14px 32px"
  header-band-night:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.black}"
    padding: "14px 32px"
  chat-panel:
    backgroundColor: "{colors.black}"
    textColor: "{colors.sage-paper}"
    rounded: "{rounded.none}"
  chat-bubble-maya:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.black}"
    padding: "9px 13px"
  text-field:
    backgroundColor: "{colors.sage-inset}"
    textColor: "{colors.black}"
    rounded: "{rounded.none}"
    padding: "11px 13px"
  stamp-done:
    backgroundColor: "{colors.black}"
    textColor: "{colors.sage}"
    typography: "{typography.stamp}"
    rounded: "{rounded.none}"
    padding: "2px 7px"
  stamp-active:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.black}"
    typography: "{typography.stamp}"
    rounded: "{rounded.none}"
    padding: "2px 7px"
  stamp-ready:
    backgroundColor: "transparent"
    textColor: "{colors.black}"
    typography: "{typography.stamp}"
    rounded: "{rounded.none}"
    padding: "2px 7px"
  stamp-blocked:
    backgroundColor: "transparent"
    textColor: "{colors.blocked-red}"
    typography: "{typography.stamp}"
    rounded: "{rounded.none}"
    padding: "2px 7px"
  commission-no:
    backgroundColor: "transparent"
    textColor: "{colors.black}"
    rounded: "{rounded.none}"
    padding: "2px 9px"
  chip-suggestion:
    backgroundColor: "transparent"
    textColor: "{colors.black}"
    typography: "{typography.body-small}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
    height: "36px"
---

# Design System: Vikrant's Dev Studio

## Overview

**Creative North Star: "The Order Book"**

The studio is a workshop's commission book. Every idea is a numbered commission, and the crew signs it off station by station with a stamp. The pages are sheets of sage and black paper divided by crisp 1.5px rules, with square corners. Depth comes only from the book as a physical object: a sheet lifts off the desk with a soft, offset shadow, a stamp falls and presses its ink into the page, a numbering machine's wheels roll, and pages turn on their hinge. There are no glows, no glass and no gradient fills. The system rejects the category default of a glowing dark dashboard with glass cards.

The book has two moods that follow the computer's setting, and Settings can force either one (`data-theme="light" | "dark"` on the root). In the light theme the book lies open on the bench: sage ground, pale sage paper, black ink, a black cover band. In the dark theme the book is read at night: black ground, sage ink, a sage cover band. Each theme mirrors the other; only where ground and ink sit changes. Each theme also has its own light on the paper (a lit top edge at night, a contact line by day), carried by the same two lift tokens. One red exists, and it means "error" or "blocked". It is never decoration.

Two worlds share the screen on purpose. The 3D office (three.js, bundled in vendor/three) and the teammates keep their own colours: name tags, portrait frames, signer squares, log dots and Maya's face on the chat button. The two-tone system frames them and never recolours them. Archivo, a single variable font bundled for offline use, carries every voice. Its condensed, uppercase, spaced cut is the book's hand for labels, numbers and stamps. Its normal width is for reading.

**Key Characteristics:**
- Two colours (sage `#9cb29e`, black `#000000`) with tints and shades, plus one red reserved for errors and blocked work.
- Light and dark themes are exact inversions, chosen by the OS and overridable in Settings.
- 1.5px black (or sage) rules and 0px corners. Sheets sit on the page with a soft, offset paper shadow (`--lift`, `--lift-high`), never a glow.
- Status is shown as a stamp in a fixed box: filled, sage, hollow, dashed, or red and struck through.
- Motion comes only from the physical book: a stamp falls and presses, number wheels roll, pages turn, dialogs rise into your hands. Under reduced motion nothing moves and stamps fade their ink in.
- The Simple view landing page fits a desktop window with no page scroll. Long content scrolls inside its own panel.

## Colors

The palette has two inks, sage and black, plus their tints and shades. One red is held in reserve.

### Primary
- **Workshop Sage** (`sage`): The book's own colour. In the light theme it is the page ground, the header band's lettering, the in-progress stamp and Maya's speech bubbles. In the dark theme it is the ink, the rules, the cover band, the primary button fill and the "done" stamp. It is also the favicon's ground.
- **Ledger Black** (`black`): The other ink. In the light theme it is the text, the rules, the cover band, the primary button and the "done" stamp. In the dark theme it is the page ground and the text on sage. The office screen frame is always black.

### Tertiary
- **Blocked Red** (`blocked-red` light, `blocked-red-night` dark, `blocked-red-night-text` for red text on black): Errors, failed checks, blocked work, and the recording microphone. On light paper the red uses `white` as its on-colour. On black it uses `black`.

### Neutral
- **Pale Sage Paper** (`sage-paper`): Light-theme panels, dialogs and the launch card. It is also the dark theme's primary text colour and the chat text in both themes.
- **Paler Sage** (`sage-paper-pale`): Light-theme entries inside a panel (projects in Behind the scenes, proposals, answered questions).
- **Sage Inset** (`sage-inset`): Light-theme text fields, the activity log well and screenshot placeholders. Also the "ready" stamp fill.
- **Sage Grey** (`sage-grey`): Dark-theme secondary text and inline code chips inside chat bubbles.
- **Rule Tint** (`sage-rule-tint`): Light-theme table row dividers and paused or waiting bars.
- **Soft Ink** (`ink-soft`) / **Muted Ink** (`ink-muted`): Light-theme secondary and muted text. Muted Ink on sage is the lowest text pair in the system, at 4.80:1.
- **Night Paper** (`night-paper`), **Night Paper Raised** (`night-paper-raised`), **Night Inset** (`night-inset`): Dark-theme panels, entries and chips, and text fields, ordered from the panel down to the deepest field.
- **Night Bubble** (`night-bubble`), **Night Paused** (`night-paused`), **Night Grid** (`night-grid`): Dark-theme "my message" bubbles, waiting bars, and table and timeline gridlines.

### Named Rules
**The Two Inks Rule.** Every chrome surface, rule and text is either sage, black, or a tint or shade of sage. If a new colour is needed, use a sage tint first.

**The One Red Rule.** Red means an error or blocked work, and nothing else. It is never used for emphasis, a brand accent or decoration.

**The Mirror Rule.** Each theme is the other with ground and ink swapped. Build every component against the role tokens (`--page`, `--paper`, `--ink`, `--accent`, `--on-accent`, `--band`, `--on-band`, `--lift`, `--lift-high`), never against a theme's literal value, so the inversion stays automatic.

**The Crew Keeps Its Colours Rule.** Teammate identity colours (name-tag squares, portrait frames, signer marks, log dots), the 3D office scenery and the 3D portrait on Maya's chat button sit outside the two-tone system. Never recolour them to sage or black, and never borrow them for chrome.

## Typography

**Display Font:** Archivo variable (with system-ui, Segoe UI, Roboto, sans-serif)
**Body Font:** Archivo variable (same file, normal width)
**Label/Mono Font:** Archivo condensed (`font-stretch` 62–72%) for labels. ui-monospace (Cascadia Mono, Menlo, Consolas) for code only.

**Character:** One family speaks in two hands. The condensed, uppercase, spaced cut reads like an order form's printed headings and rubber stamps. The normal width reads like the handwriting in the entries.

Archivo is loaded with `size-adjust: 78%`, so every stated size renders at 78% of its number. The px values were set for the earlier pixel font and kept so the layout did not move. Treat the numbers as the system's units, not as rendered px.

The ramp is honest rather than tidy: it records every size the build reuses, including the steps the display takes to fit its box. It is not a modular scale, and new work should reuse a listed step before adding one.

### Hierarchy
- **Display** (800, 46px, condensed 72%, line-height 1): The start card's question ("What would you like to build?"). It appears once per screen.
- **Display steps** (800): 42px in the fit-window view (`display-fit`); 36px at the first start-card container step (`display-container`); 34px on a phone (`display-phone`); 30px at the next container step and as the launch screen's title (`display-step-30`, line-height 1.1); 26px at the smallest container step and as the progress figure on the cover band, condensed 68% (`display-step-26`).
- **Ledger Numeral** (800, 40px, condensed 62%, line-height 0.9, tabular): The commission number in each entry's margin, with a small "No." label above it.
- **Headline** (650, 25px, 1.15): The cover band's live status line and the "Right now" sentence. **Headline compact** (650, 22px): the "Right now" sentence at a container step, and a dialog's success line.
- **Title** (750, 23px): A commission's name and empty-state headings. **Title compact** (750, 21px): the commission name in the fit-window view. 21px is also the ask-banner's question and the cover headline on a phone.
- **Body** (400, 20px, 1.3–1.35): Base reading size, chat messages and fields. Explanatory lines are capped at 64ch.
- **UI large** (19px): link buttons, dialog titles (800), the start button (650), tooltip text and the chat button's label (condensed).
- **UI** (650, 18px): button labels, panel and chat titles (800), the commission number box (800), log text, captions after a panel head (400).
- **Body Small** (400, 17px, 1.3): Captions, rows, legends and suggestion chips.
- **Label** (700–800, 17px, condensed 68%, uppercase, 0.07em): Panel heads and the welcome heading. The same condensed hand runs at 15px for the brand name, phases, the stepper and table heads (Label small), at 18–19px for the chat title and the chat button, and at 14px for stamps.
- **Meta** (16px): meta text, small buttons, tabs, the launch screen's studio name (800), and the chat's role and model words (400).
- **Label small** (700, 15px): small labels (brand name, phases, stepper words, table heads, Maya's status), role words in who's who, and signers and model tags beside the stamps. Condensed uppercase where it labels; normal width where it names a person.
- **Stamp** (800, 14px, condensed 68%, uppercase, 0.07em): Sign-off stamps, status boxes and the "No." above a ledger numeral.

### Named Rules
**The Two Hands Rule.** Condensed uppercase is for things the book prints or stamps: labels, numbers and statuses. Anything you read as a sentence uses normal width and sentence case.

**The Tabular Figures Rule.** Times, logs, tables, the progress figure and every commission number use tabular numerals.

## Layout

The shell is 1480px wide, centred, with a fluid gutter (`spacing.gutter`). In the Simple view on a desktop, the grid is two columns at 1.3fr and 1fr. The office sits above the commission book on the left, and Maya's chat sits above the start card on the right. Behind the scenes uses 1.35fr and 1fr, stacking the office and log, then the graph, timeline and portfolio. Panels are separated by an 18px gap and padded 16px 18px. Spacing works on a 6/8/12/18 rhythm.

**The Fits-The-Window Rule.** At ≥1101×600, the Simple view landing page never scrolls the page. The body is a 100dvh column. The header and banners take their natural height, and the grid takes the rest, with rows split 1.12fr / 1fr. Every panel is `min-height: 0`. Long content (old messages, many commissions, the start card's overflow) scrolls inside its own box. A visible thin scrollbar track marks the commission book as having more entries. The office screen sizes itself to `min(100cqw - 200px, (100cqh - 6px) × 16/9)`, with who's who beside it.

**Container steps, not page breakpoints, tighten the cards.** On the start card, the explanation line goes first (≤300px tall), then gaps and the field tighten (≤268px), then the title steps down (≤246px, ≤214px). The office stage drops role words at ≤250px. The commission book slims its footer line at ≤255px, tightens entries at ≤250px, and drops descriptions at ≤225px.

Page breakpoints: ≤1100px goes to one column, the chat becomes a floating panel opened from a button, and the page scrolls normally. At ≥1101px in Behind the scenes, an open chat docks right and reserves 404px; between 1101 and 1300px the grid also stacks. ≤600px is the phone layout: the chat fills the screen, commission entries stack, and the sign-off strip uses two columns. ≤420px hides the chat button's label. ≤370px compresses the header and start row. Coarse pointers get 44px minimum targets.

## Elevation & Depth

The system is paper on a desk. Every sheet keeps its 1.5px rule and square corners, and it also lifts off the page with a soft, offset shadow, the way a real sheet does. There are two heights, both role tokens defined per theme. **`--lift`** is a sheet lying on the desk: panels, the setup, welcome and notice banners, the ask-banner, the in-grid chat and the launch card. **`--lift-high`** is a sheet held above the desk: the floating chat and dialogs. At night the light catches the sheet's top edge as a faint sage inset highlight, and a deep soft drop falls away beneath it. By day a 1px contact line sits under the sheet and a soft sage-black drop is offset downward. Inversion still does work: the header band, the chat panel and the ask-banner flip ground and ink, so they read as the cover and the loudest page. Tonal steps of sage still order page, paper, raised entry and inset field. Dialogs sit on a 60% black scrim and rise into place. Emphasis still thickens the rule to 3px (the current stepper station, a chat reply field, a question bubble's outline); it does not raise the sheet.

### Shadow Vocabulary
- **Sheet on the desk, night** (`--lift`: `inset 0 1px 0 rgb(223 232 223 / .12), 0 22px 40px -18px rgb(0 0 0 / .9)`): panels, banners, ask-banner, in-grid chat, launch card.
- **Sheet held up, night** (`--lift-high`: `inset 0 1px 0 rgb(223 232 223 / .16), 0 36px 70px -24px rgb(0 0 0 / .95)`): floating chat, dialogs.
- **Sheet on the desk, day** (`--lift`: `0 1px 0 rgb(0 0 0 / .14), 0 18px 32px -16px rgb(23 33 24 / .5)`): same surfaces.
- **Sheet held up, day** (`--lift-high`: `0 2px 0 rgb(0 0 0 / .12), 0 40px 70px -26px rgb(23 33 24 / .6)`): same surfaces.
- **A falling stamp's shadow** (transient, inside the stamp-land keyframes: `0 20px 16px -8px rgb(0 0 0 / .45)` shrinking to `0 1px 1px 0 rgb(0 0 0 / .25)` at the press, then to nothing): only while a stamp falls.

### Named Rules
**The Paper Lift Rule.** A sheet's shadow is always `--lift` or `--lift-high`: offset downward, blurred, and the colour of the room, never the colour of the ink. Nothing else casts a shadow except a stamp while it is falling. No glows, no coloured or spread halos, no blur behind glass, no gradient fills.

**The Ruled And Lifted Rule.** Lifting a sheet never replaces its rule. Every lifted surface keeps its 1.5px ink border and square corners, and emphasis inside it is still a 3px rule, not a higher lift.

## Shapes

All chrome corners are square (`rounded.none`): buttons, panels, fields, stamps, chips, tabs, dialogs, the brand mark and the office frame. Lines come in three kinds. A solid 1.5px rule (`--rule`) is the default border. A dashed rule means "not yet": pending stamps, a disabled button, the open "next commission" line, an empty book, and an offline status. A 35%-ink rule marks quiet entries. Squares are the system's dot. Status dots, teammate marks, the chat status pip and the welcome step numbers are all square, never round. Line icons come from one inline SVG sprite (24px grid, 1.9 stroke, round caps and joins). The icons' own drawn curves are part of the icon, not a corner treatment.

## Components

### Buttons
Each button is a stamped block: flat on the sheet, square and ruled.
- **Shape:** square corners (`rounded.none`), 1.5px border, min-height 42px (34px small, 48px for the start action), label 650 weight at 18px (16px small, 19px for the start action).
- **Primary:** accent fill with on-accent text (black with sage text in light, sage with black text in dark). Only one primary per card: "Send to Maya".
- **Hover / Focus:** hover mixes the accent 22% toward the page. Active presses down 1px. Focus is a 3px outline in `--focus` at a 2px offset (inside the band, chat and ask-banner the outline takes that surface's ink). Transitions run .12s.
- **Ghost:** transparent with an ink rule. Hover fills it with 12% ink.
- **Pressed toggles** (`aria-pressed="true"`) take the primary fill. The recording microphone turns red.
- **Disabled:** 45% opacity and a dashed border.
- **Link button:** underlined text with a 3px offset, 19px. Hover thickens the underline to 2px.

### Chips (suggestions and answer choices)
- **Style:** transparent, a 1.5px rule in the current ink or `currentColor`, 17px text, 6px 12px padding, min-height 36px, square.
- **State:** hover tints with 14% of `currentColor`. In the fit-window view, the chat's suggestions and choices form one row that scrolls sideways, with an overflow fade at the right edge.

### Cards / Containers (panels)
- **Corner Style:** square.
- **Background:** `--paper` (Pale Sage Paper in light, Night Paper in dark). Entries inside use `--paper-2`, and fields use `--inset`.
- **Shadow Strategy:** `--lift`, a sheet on the desk (see Elevation & Depth). Entries, fields and chips inside a panel are not lifted; they are printed on the sheet.
- **Border:** a 1.5px ink rule.
- **Internal Padding:** 16px 18px (14px 18px 16px when fitting the window). The panel head is a condensed uppercase label followed by a muted caption, with a square "?" help button at the right.

### Inputs / Fields
- **Style:** `--inset` fill, 1.5px ink rule, square, 20px text. The idea box has 11px 13px padding. Placeholders use muted text at full opacity.
- **Focus:** a 3px `--focus` outline with no offset.
- **Error:** a plain red sentence under the form (`--bad-text`). The field itself keeps its normal colours.

### Navigation (cover band and view switch)
- The header is the book's cover band (`header-band` / `header-band-night`). It holds a 44px square brand mark with the studio's initials in condensed 800 type, the studio name as a condensed label, the live headline, and the last job. The **Simple / Behind the scenes** switch is a segmented control with an outer rule, where the selected segment inverts. Clicking it turns the page (see Motion). Icon buttons in the band take the band's ink. In Behind the scenes, a pipeline row of phase boxes sits under a 40%-ink rule: past phases are ruled with a check, and the current phase is inverted.
- **Tabs** are one ruled strip. The selected tab takes the accent fill.

### Dialogs
A dialog is a sheet held up: `--paper` fill, 1.5px ink rule, square, `--lift-high`, on a 60% black scrim. The scrim fades in over .15s and the sheet rises into place over .3s (from 14px lower, tipped back 6° on a 1200px perspective) on the ease-out. Titles are 19px 800.

### Stamps and the Status Grammar (signature)
A status is always a stamp in a fixed box:
- **Done:** filled (`--good`: black in light, sage in dark), with on-good text.
- **In progress:** sage (`--active`) in light. In dark, sage already means done, so in-progress takes Pale Sage Paper. The current stepper station's rule thickens to 3px.
- **Ready / waiting:** hollow (`--ready` inset fill, or transparent), ruled.
- **Pending:** a dashed rule.
- **Blocked:** a red rule, red text, and a 2px line-through.
The same grammar drives the 18px legend chips, the stepper stations (34px boxes), the graph nodes (3px stroke when active, a red stroke when blocked, a 4/3 dash when pending), and the sign-off strip. Forced-colors mode keeps the stamps' own colours.

### Commission Entry (signature)
Each entry is ruled into the book with a 1.5px top rule. A 112px margin holds the ledger numeral ("No." over a three-digit number) and the screenshot, which is 16:10 and ruled. Beside the margin come the title, a one-line description, the sign-off strip, and then the actions. The sign-off strip has one 92px "done" stamp per station (PLANNED, BUILT, CHECKED, SIGNED OFF), with the signers' colour squares and names under each stamp. The book ends with an open dashed line, "Start a project", marked by a square accent plus. In the fit-window view this line is pinned to the bottom of the scroll box on paper. Commission numbers come from the server in first-started order (hidden projects included). An entry that appears while you watch turns into the book like a page; a project that finishes while you watch has its four stamps land one by one (see Motion).

### Commission Number Box (signature)
The start card's next number sits in a ruled box like an order form's: a 1.5px ink rule, square, 2px 9px padding, 18px 800 type, "No." followed by a numbering machine. The machine has three wheel windows (hundreds, tens, ones). Each window is .66em wide and 1.36em tall and shows a 3D drum of ten faces, 0–9, set 36° apart around a radius of 1.08em on a 7em perspective. The window's top and bottom fade out through a mask so the drum reads as curving away. When the next number changes, each drum turns forward to it over .9s on the ease-out. A drum's position counts whole turns (the hundreds, tens and units of the number), so wheels only ever roll forward, like an odometer. A fresh card shows the last number at once and then rolls to the next.

### Maya's Chat
The chat is a black panel in both themes. In the dark theme its rule is translucent sage (`#9cb29e66`). As a grid cell in the desktop Simple view it lies on the desk (`--lift`); floating over the page it is held up (`--lift-high`). Maya's bubbles are sage with black text. The owner's bubbles are Pale Sage Paper in light and Night Bubble in dark. System lines use a dashed rule. Her status is a stamp-like box with a steady square pip. It is a state, not a heartbeat. "Typing" is a square caret blinking in two steps. On a desktop Simple view, the chat is a fixed grid cell with `contain: size`, so its messages scroll inside it. The chat button and header carry Maya's 3D portrait (rendered from the office model), which keeps its own colours.

### Motion
**The Physical Book Rule.** Every authored movement is something a real book, stamp or numbering machine does: a stamp falls and presses, a wheel rolls, a page turns on its hinge, a sheet is lifted into your hands. The ease-out is exponential (`--out`: `cubic-bezier(.16, 1, .3, 1)`); things that fall or lift away speed up instead (ease-in). Nothing bounces, pulses, glows or floats.

**The Stamp Lands Rule.** The focal moment is a station's stamp landing, in .7s. The stamp starts above the page, tilted back (`rotateX(34deg) rotate(-8deg)`), enlarged and invisible, with a large soft shadow beneath it. It falls into view on an ease-in (`cubic-bezier(.55, 0, 1, .45)`), fully visible by 22%. At 52% it presses (`scale(.92)`, shadow shrunk to a contact line), then rises back to rest on the exponential ease-out; its ink (`--stamp-ink` / `--stamp-on`, the done colours) is on the page from 56%. The stepper and the sign-off strip set a 520px perspective. In the stepper, a station whose step completes while you watch falls from 18px above at 1.4×. When a project finishes while you watch, its sign-off strip's four stamps land one by one, falling from 9px at 1.18×, 150ms apart after a 200ms wait. The commission book compares each project's status with the previous refresh to decide this, so stamps land only for what just happened.

**The Page Turn Rule.** A new commission entry turns in like a page hinged at its top rule (from `rotateX(-72deg)` on a 1400px perspective, transparent, over .6s on the ease-out). Switching between Simple and Behind the scenes by clicking the switch turns the page: the old view, drawn above the new one, lifts away from its left edge to `rotateY(-90deg)` on a 2600px perspective over .55s on an ease-in (`cubic-bezier(.55, 0, .75, .35)`), uncovering the new view beneath. It is a same-document View Transition and runs only on a user's click, only where the browser supports it.

Everything else is a state change: .12s colour transitions with a 1px press, a .6s progress fill, the .15s scrim fade, the .3s dialog rise, the .9s wheel roll, and two-step blinks for the caret (.9s) and the launch dots (1.2s).

**The Still Book Rule.** Under `prefers-reduced-motion: reduce`, every animation and transition is removed and no view transition runs. The wheels jump straight to the number. The only thing that changes over time is a stamp's ink: it fades in over .3s, linear, with a finished project's four stamps 100ms apart.

## Do's and Don'ts

### Do:
- **Do** build every surface from the role tokens (`--page`, `--paper`, `--paper-2`, `--inset`, `--ink`, `--accent`/`--on-accent`, `--band`/`--on-band`, `--lift`/`--lift-high`) so both themes come for free.
- **Do** separate surfaces with the 1.5px `--rule` and keep every chrome corner at 0px.
- **Do** lift a sheet only with `--lift` (lying on the page) or `--lift-high` (floating chat, dialogs): a downward offset with a soft blur, plus the theme's lit edge or contact line.
- **Do** express status only through the stamp grammar: filled done, sage in progress, hollow waiting, dashed pending, red and struck blocked.
- **Do** set labels, stamps and numbers in condensed (62–72%) uppercase Archivo at 0.07em, with tabular figures for numbers.
- **Do** keep text pairs at ≥4.5:1 (the floor is Muted Ink on sage, 4.80:1) and focus outlines at 3px.
- **Do** keep the desktop Simple view (≥1101×600) free of page scroll. New content scrolls inside its panel, and container queries shed secondary lines before anything scrolls.
- **Do** keep teammates' identity colours, the 3D office's own palette and the 3D portraits untouched inside the two-tone frame.
- **Do** take every movement from the physical-book set (stamp fall and press, wheel roll, page turn, sheet rise) and land it on the exponential ease-out; animate only what just happened while the person watched.
- **Do** keep reduced motion still: no movement, no view transition, wheels jump, and stamps fade their ink in over .3s.

### Don't:
- **Don't** cast a shadow outside the two lift tokens and the falling stamp, and never a hard offset block shadow. The day theme's 1px contact line belongs to `--lift`; it is not a device of its own.
- **Don't** add glows, glass, backdrop blur or decorative gradient fills. A hard-stop gradient used as a progress rule, the overflow fade on a sideways-scrolling row and the number wheels' window mask are the only gradients, and all are functional.
- **Don't** use red for anything but errors and blocked work.
- **Don't** introduce a third hue into the chrome. Use a sage tint or shade instead.
- **Don't** round corners or use round status dots in the chrome. The system's dot is a square.
- **Don't** add motion outside the physical-book set: no bounce, pulse, float, parallax, hover lift or looping ambient movement. State changes stay short colour transitions.
- **Don't** use the pixel fonts left in the fonts folder (Press Start 2P, VT323) for the interface. Archivo is the only interface face.

## The 3D Office

The office is a real-time three.js r187 scene (`tools/team-office/public/office.js`, library bundled in `public/vendor/three`, works offline). It keeps the earlier office's floor plan and simulation: each teammate walks the corridors between their desk and a seat on the lounge sofa, and their screen, the whiteboard of task notes, the clock and the server lights show live state. Teammates are smooth toy-proportioned figures (big round head, capsule body, knees and arms that move) in their own colours and accessories; desk chairs carry each teammate's colour. Light: a sky-and-floor hemisphere light plus one warm sun with soft shadows; tone mapping is Khronos Neutral. The same models render the who's-who portraits and Maya's chat face.

**The Office Budget Rule.** Everything that never moves is merged into a few dozen meshes; small parts cast no shadows; the scene draws at 60 fps while someone walks, 30 fps at rest, and stops when the office is off screen or the tab is hidden. Without a graphics card (software WebGL) it switches to a lite mode: no shadows, standard resolution, a few frames a second. Without WebGL at all it says so plainly and keeps the name tags.
