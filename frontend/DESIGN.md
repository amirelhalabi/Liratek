---
name: LiraTek
description: Counter-speed point of sale for Lebanese phone shops, in dollars and lira side by side.
colors:
  # Light theme (opt-in; set per device)
  porcelain-page: "#f8f7f4"
  porcelain-section: "#f0efeb"
  porcelain-card: "#f2f0ef"
  porcelain-raised: "#e4e2db"
  porcelain-border: "#e4e2db"
  porcelain-border-strong: "#d4d1c9"
  charcoal-ink: "#292823"
  charcoal-ink-soft: "#44423c"
  charcoal-muted: "#77746b"
  charcoal-faint: "#a19e95"
  signal-blue: "#0057ff"
  signal-blue-fill: "#003edd"
  signal-blue-fill-hover: "#0020c4"
  signal-blue-hover-row: "#e8efff"
  # Dark theme (the default)
  cosmic-page: "#020222"
  cosmic-section: "#050938"
  cosmic-navy-card: "#0c134f"
  cosmic-raised: "#1a2761"
  cosmic-border: "#25336a"
  cosmic-border-strong: "#3e4d7d"
  moon-ink: "#ffffff"
  moon-ink-soft: "#d8deed"
  moon-muted: "#99a4c2"
  moon-faint: "#667398"
  pastel-violet: "#d4adfc"
  pastel-violet-hover: "#dfc3ff"
  pastel-violet-text: "#dfc3ff"
  violet-deep-fill: "#542977"
  # Money semantics: Tailwind's own values, never brand-themed
  money-in: "oklch(69.6% 0.17 162.48)"
  money-in-text-dark: "oklch(76.5% 0.177 163.223)"
  money-in-text-light: "oklch(50.8% 0.118 165.612)"
  money-out: "oklch(63.7% 0.237 25.331)"
  money-out-text-dark: "oklch(70.4% 0.191 22.216)"
  money-out-text-light: "oklch(57.7% 0.245 27.325)"
  warning: "oklch(82.8% 0.189 84.429)"
  warning-text-light: "oklch(66.6% 0.179 58.318)"
  info-carrier: "oklch(68.5% 0.169 237.323)"
typography:
  page-title:
    fontFamily: "Inter, system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
  title:
    fontFamily: "Inter, system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
  body:
    fontFamily: "Inter, system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "Inter, system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
  table-head:
    fontFamily: "Inter, system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.025em"
  amount:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  full: "9999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary-dark:
    backgroundColor: "{colors.pastel-violet}"
    textColor: "{colors.cosmic-navy-card}"
    rounded: "{rounded.lg}"
    padding: "10px 24px"
  button-primary-dark-hover:
    backgroundColor: "{colors.pastel-violet-hover}"
  button-primary-light:
    backgroundColor: "{colors.signal-blue-fill}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "10px 24px"
  button-primary-light-hover:
    backgroundColor: "{colors.signal-blue-fill-hover}"
  button-money-in:
    backgroundColor: "{colors.money-in}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "10px 24px"
  card-dark:
    backgroundColor: "{colors.cosmic-navy-card}"
    rounded: "{rounded.xl}"
    padding: "16px"
  card-light:
    backgroundColor: "{colors.porcelain-card}"
    rounded: "{rounded.xl}"
    padding: "16px"
  input-dark:
    backgroundColor: "{colors.cosmic-raised}"
    textColor: "{colors.moon-ink}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  input-light:
    backgroundColor: "{colors.porcelain-card}"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  chip-total:
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    typography: "{typography.label}"
  nav-item-active-dark:
    backgroundColor: "{colors.pastel-violet}"
    textColor: "{colors.cosmic-navy-card}"
    rounded: "{rounded.xl}"
    padding: "10px 12px"
  modal:
    rounded: "{rounded.2xl}"
    padding: "24px"
---

<!--
  Written 2026-10-20 by `/impeccable document` (scan mode) from the incumbent code,
  without the owner available. Every token value above is extracted from
  frontend/src/index.css, node_modules/tailwindcss/theme.css and the shared
  components. The qualitative language (the Creative North Star, colour display
  names, elevation and component philosophy) is the agent's inference, marked
  "(inferred)" below; confirm or rename it on the next document run.

  Scope: the app UI in frontend/ (desktop Electron + web). landing/ and mobile/
  have their own visual systems.
-->

# Design System: LiraTek

## Overview

**Creative North Star: "The Night Counter Ledger"** (inferred)

LiraTek is a working ledger that sits on a shop counter. It is dark by default: deep navy surfaces, white figures and a single soft violet accent that marks where the cashier is and what they will press next. Light mode is a warm porcelain paper version of the same ledger, with Signal Blue as the accent. Both modes are painted from one source: the app is authored with bare dark-first Tailwind classes (`bg-slate-800`, `text-slate-400`, `bg-violet-600`), and `src/index.css` repaints every one of them to the brand ramps in both themes.

The screen is dense on purpose. Most text is 12–14px, cards sit 8–12px apart, and a single page shows totals, forms and a history table at once. Calm comes from restraint rather than space: one accent, flat tonal surfaces, and colour reserved for meaning. Green, red, amber and sky are money signals and keep Tailwind's own values in both themes, so profit and loss never depend on the brand palette.

**Key Characteristics:**
- Dark-first (default theme), with an equal, owner-specified light theme.
- One brand accent per mode (Pastel Violet dark, Signal Blue light); blue, indigo and violet classes all resolve to it.
- Money colours are semantic and fixed: emerald in, red/rose out, amber/orange warning, sky info/carrier.
- Dense, small type; amounts in a monospaced face.
- Flat tonal layers; shadows only on things that float.
- Logical start/end sides everywhere, ready for right-to-left.

## Colors

A cool navy night or warm porcelain day, each with one accent, plus a fixed set of money signals that never change with the theme.

### Primary
- **Pastel Violet** (`pastel-violet`): the dark-mode accent. Active sidebar item, primary buttons, focus borders, selected tabs and links. A filled violet button takes a Cosmic Navy label, never white (white on it fails contrast).
- **Signal Blue** (`signal-blue`): the light-mode accent for text and icons. Filled buttons use the deeper `signal-blue-fill` with a white label and darken on hover; dark-mode fills lighten on hover instead.
- **Deep Violet** (`violet-deep-fill`): the one accent fill that is dark in both modes and always takes a white label (authored as `bg-violet-700/800/900`).

### Neutral
- **Cosmic Page / Section / Navy Card / Raised** (`cosmic-page` → `cosmic-raised`): the dark surface ramp, from page background up through section panels, cards, and inputs or raised chips. Cosmic Navy is the card anchor.
- **Porcelain Page / Section / Card / Raised** (`porcelain-page` → `porcelain-raised`): the light surface ramp, warm grey at hue 91°. Porcelain is the page anchor; cards are a slightly warmer grey (`#f2f0ef`).
- **Moon Ink / Charcoal Ink** (`moon-ink`, `charcoal-ink`): primary text in dark and light. Soft, muted and faint steps carry secondary labels, helper text and disabled or placeholder text.
- **Borders** (`cosmic-border`, `porcelain-border` and their strong steps): card and divider edges; the strong step is used on hover and for emphasised dividers.

### Money semantics (fixed, not themed)
- **Money In** (`money-in`, emerald): received amounts, paid status, profit, confirm-payment buttons. Light mode steps text down to `money-in-text-light` so it stays readable on porcelain.
- **Money Out** (`money-out`, red; rose is a sibling): paid-out amounts, what a customer owes, losses, destructive actions.
- **Warning** (`warning`, amber; orange is a sibling): shortfalls, pending or unusual states that need a look.
- **Info / Carrier** (`info-carrier`, sky): neutral information and carrier-related marks. Sky is deliberately not folded into the accent.

Provider brand colours (Whish, OMT, MTC, Alfa, iPick, Katsh, Binance) are real third-party colours defined once in `src/shared/brand/providerBrands.ts` and used only to identify that provider.

### Named Rules
**The Money Never Wears Brand Rule.** Emerald, red, rose, amber, orange and sky keep Tailwind's own `oklch()` values in both themes (decision D1 in `index.css`). Never recolour them to fit the palette, and never use them for decoration.

**The One Accent Rule.** Each mode has exactly one accent. `blue-*`, `indigo-*` and `violet-*` classes all resolve to it (decision D8); do not introduce a second brand hue. Known exception: the legacy orange focus and button styling noted under Inputs.

**The Paint Through The Map Rule.** Write bare dark-first Tailwind classes and let `index.css` repaint them. Never write raw hex or `var(--color-*)` in components; a slate/violet class that the map does not cover paints raw Tailwind until the coverage sweep is regenerated.

## Typography

**Body Font:** Inter (with system-ui, Avenir, Helvetica, Arial)
**Amount Font:** the platform monospace stack (`font-mono`)
**Arabic:** Inter, then Segoe UI, Tahoma, Noto Sans Arabic (switched off in the app for now)

Inter is named first but is not bundled with the app: it renders when the machine has it installed, otherwise the system UI font does. Treat the system face as the real baseline.

**Character:** a plain, neutral sans for everything people read, and a monospaced face for the numbers they check, so digits line up in columns and a misread figure is less likely. (inferred)

### Hierarchy
- **Page title** (700, 30px): the one page heading from the shared page header. Rare.
- **Title** (700, 20px; 18px also used): modal titles, panel and section headings.
- **Body** (400–500, 14px): form fields, table cells, most content. The working size.
- **Label** (500, 12px): field labels, chips, helper text, badges. As common as body.
- **Table head** (500, 12px, uppercase, slight tracking): table column headers on the section surface.
- **Amount** (500–700, monospace, inherits size): every money figure, coloured by meaning when it carries one.

### Named Rules
**The Twelve Pixel Floor Rule.** Prefer 12px (`text-xs`) as the smallest size for anything a cashier must read. This is a guideline, not yet an observed floor: arbitrary 9–11px sizes (`text-[10px]`, `text-[11px]`) appear in roughly 390 places, mostly badges, overlines and secondary metadata. Do not add more for primary figures or labels.

## Layout

A fixed left sidebar (256px, collapsible to 60px) holds module navigation on the section surface, with a 48px top bar. Pages fill the remaining width; many money screens use a left-panel layout with the form on one side and history or totals on the other. Spacing is tight: gaps of 8px are the default between controls, 12px between groups, 16px inside cards, 24px inside modals. Each page's scroll container is pulled to the window edge so its 10px scrollbar sits at the true right edge with 14px of clear space before the cards.

The app is built for desktop and laptop counters. Responsive behaviour is light: about 65 breakpoint classes (`sm:` to `xl:`) across the whole app, so layouts mostly stay as they are and the web app is not redesigned for phones.

Layout uses logical sides throughout (`ps`/`pe`, `start`/`end`, `border-s`) so it can flip for right-to-left.

## Elevation & Depth

Flat by default, with depth from tonal layers: page, then section, then card, then raised, each one step lighter in dark mode and one step deeper in light mode. Shadows appear only on things that float above the page: modals, dropdown menus, popovers and the active sidebar item. In light mode every large shadow is replaced by one soft two-layer shadow in warm ink so nothing looks heavy on porcelain. Row hover lifts a card-coloured row toward the accent (a pale blue wash in light, a raised navy in dark) rather than toward grey.

### Shadow Vocabulary
- **Float (light)** (`0 4px 20px -4px rgba(41,40,35,0.06), 0 2px 8px -2px rgba(41,40,35,0.04)`): replaces `shadow-lg/xl/2xl` in light mode.
- **Float (dark)**: Tailwind's own `shadow-lg/xl/2xl`, which read as soft darkness on navy.
- **Inset (light)** (`inset 0 2px 4px 0 rgba(41,40,35,0.04)`): wells and recessed inputs.

### Named Rules
**The Float Only Rule.** A shadow means "this is above the page". Cards sitting on the page do not get one.

## Shapes

Gently rounded and consistent: controls and buttons are 8px, cards and nav items 12px, modals 16px, and pills and toggles fully round. Cards carry a 1px border in the mode's border colour. A coloured 4px start-side edge marks a card or row by category (per-module edges on cards; a per-basket hue on transaction rows from a customer session).

## Components

### Buttons
Quiet and solid. (inferred)
- **Shape:** gently curved (8px); compact variants use 4px.
- **Primary:** filled accent, 14px medium text, 10px × 24px padding; full-width versions with 12px vertical padding and semibold text confirm a payment.
- **Hover / Focus:** dark mode lightens, light mode darkens, via one hover token; focus moves the border to the accent with no outline glow on most controls.
- **Money actions:** confirming money in uses emerald with a white label; destructive or money-out actions use red or rose with white.
- **Secondary:** raised surface with muted text that brightens on hover.
- **Disabled:** raised surface, faint text.

### Chips
- **Style:** raised or card surface, 1px border, 12px medium text, 8px corners (totals) or full pill (toggles).
- **State:** the Split toggle is grey with an outline when off and an accent tint with accent text and border when on. USD and LBP totals always appear as a pair.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** card surface, sometimes at 50% over the section surface.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px, the mode's border colour, sometimes at half strength.
- **Internal Padding:** 16px, tables flush to the edge.

### Inputs / Fields
- **Style:** raised surface (dark) or card grey (light), 1px border, 8px corners, 10px × 16px padding (8px × 12px compact), 14px text. All inputs, selects and textareas are painted by one global rule.
- **Focus:** border turns accent, sometimes with a faint 1px accent ring. No outline ring: most fields set `focus:outline-none`.
- **Orange exception (legacy, status undecided):** sign-up, sign-in, password and admin tenant screens, plus several history modals and money forms (about 70 fields, 34 files with orange buttons), use `focus:border-orange-500` and orange buttons. Orange is a money-warning colour, so this conflicts with the One Accent Rule. Record it; do not mass-convert it without an owner decision.
- **Error:** 12px red message under the field.
- **Selects:** the native arrow is replaced by a muted chevron on the reading-end side.

### Navigation
- **Sidebar:** 14px medium items with a 20px icon, 12px corners. The active item is a filled accent with its label colour and a soft accent shadow; inactive items are muted and gain a surface on hover. Holding an item pins it, shown by a thin accent bar filling under it.

### Tables
- **Head:** section surface, 12px uppercase muted labels.
- **Rows:** 8px cell padding, hover wash toward the accent, amounts in monospace and money colours. (inferred) Direction is meant to be shown in words or IN/OUT badges as well as colour; this was not checked screen by screen.

### Modals
- **Style:** section surface, 1px border, 16px corners, Float shadow, over a black scrim (80% in the shared confirm dialog; 50% and 60% scrims are softened to 30% and 35% in light mode). Body 24px; the footer sits on a card band with a top border.

## Do's and Don'ts

### Do:
- **Do** author with dark-first slate and violet classes and let `index.css` repaint both themes.
- **Do** check every new screen in both themes; dark is the default theme.
- **Do** put every money figure in the monospace face and colour it only by meaning (emerald in, red/rose out).
- **Do** show USD and LBP together wherever money is shown.
- **Do** use logical sides (`ms`/`me`, `ps`/`pe`, `start`/`end`, `border-s`) so right-to-left keeps working.
- **Do** take provider colours and logos from `providerBrands.ts`.
- **Do** use the mode's label token on filled accent buttons: Cosmic Navy in dark mode, white in light mode.

### Don't:
- **Don't** recolour emerald, red, rose, amber, orange or sky, or use them as decoration.
- **Don't** add a second accent hue, or treat blue, indigo and violet as different colours.
- **Don't** write raw hex, `var(--color-*)`, or new Tailwind colour families in components.
- **Don't** put white text on a Pastel Violet fill.
- **Don't** give resting cards a shadow, or add glow, blur or glass effects to working screens.
- **Don't** set text a cashier must read below 12px.
- **Don't** use `left`/`right` or `ml`/`mr` for layout that should flip in Arabic.
