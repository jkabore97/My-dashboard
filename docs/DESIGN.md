# Design rules (Apple style)

The dashboard looks like iOS / macOS Settings, Reminders and Apple Business:
grey background, white rounded groups, hairline dividers, system font, blue
for actions. **Light and dark follow the device** (`prefers-color-scheme`);
there is no toggle. Every page must read well in both.

Reference: `src/components/ui.tsx` (building blocks), `src/app/globals.css`
(tokens), the Today page (`src/app/(dash)/page.tsx`) and Settings
(`src/app/(dash)/settings/page.tsx`) as worked examples.

## 1. Colour tokens

Use the Tailwind tokens. They point at CSS variables that switch per scheme,
and opacity modifiers work (`bg-cyan/10`, `border-line/60`).

| Token | Light | Dark | Use for |
|---|---|---|---|
| `bg` | #f5f5f7 | #000000 | page background |
| `panel` | #ffffff | #1c1c1e | cards, groups |
| `panel-2` | #f2f2f7 | #2c2c2e | inset areas, text fields, nested lists |
| `line` | #e5e5ea | #38383a | hairlines, dividers |
| `fill` / `fill-2` | grey 12% / 20% | grey 24% / 32% | secondary buttons, segmented controls, hover rows |
| `chrome` | translucent | translucent | sidebar, tab bar (with `backdrop-blur-xl`) |
| `ink` | #1d1d1f | #f5f5f7 | primary text |
| `muted` | #6e6e73 | #98989d | secondary text, labels, values on the right of a row |
| `cyan` = `accent` = `medium` = `blue` | #0071e3 | #0a84ff | links, buttons, selection, "medium" |
| `critical` | #ff3b30 | #ff453a | red: critical / failing / destructive |
| `high` | #ff9500 | #ff9f0a | orange **dots, bars, fills** |
| `warn` | #c93400 | #ff9f0a | orange **text** (readable on white) |
| `ok` = `emerald` = `green` | #248a3d | #30d158 | "ok", success text |
| `lime` | #28a745 | #30d158 | bright green fills |
| `teal` | #1f97ae | #40c8e0 | identity |
| `violet` = `indigo` | #5856d6 | #5e5ce6 | identity |
| `pink` | #ff2d55 | #ff375f | identity |
| `gold` | #b07000 | #ffd60a | identity (amber, readable as text) |
| `low` | #8e8e93 | #8e8e93 | "low", idle |

Red and orange still mean "problem" only. Everything else is identity.

### JS colours

When a colour lives in JS (SVG `fill`, `style`, concatenated alpha like
`${c}22`), use the plain 6-digit hexes in `SYS` from `ui.tsx` (Apple's mid
system colours, readable on both backgrounds):
`SYS.blue #007aff, indigo #5856d6, purple #af52de, pink #ff2d55, red #ff3b30,
orange #ff9500, yellow #ffcc00, green #34c759, mint #00c7be, teal #30b0c7,
cyan #32ade6, brown #a2845e, gray #8e8e93`.

Also in `ui.tsx`: `ACCENT` (same keys as before, Apple values),
`businessColor(name)`, `CHART_COLORS` (series order), `SEVERITY_VAR`
(theme-aware dot colours), `SEVERITY_TEXT` (theme-aware text colours),
`appleColor(hex)` (maps an old HUD hex to its Apple colour), `readable(c)`
(tinted text that stays legible: mixes the colour toward ink), `tint(c, pct)`
(soft tinted background). In `command/hud.tsx`: `SEV_COLOR` (hexes) and
`SEV_TEXT` (CSS vars).

For text, prefer a token class (`text-critical`, `text-warn`, `text-ok`,
`text-cyan`) or `var(--color-…)` over a hex: hexes don't switch with the theme.

### Old HUD hex → new

| Old | Was | Replace with |
|---|---|---|
| `#eaf7ff`, `#f2faff`, `#ddebf5` | bright text | `text-ink` / `var(--color-ink)` |
| `#c5d3de`, `#b7c7d4` | soft text | `text-ink` (or `text-muted` if secondary) |
| `#7f97ab`, `#8fa6b8`, `#5e7a8f` | muted / low | `text-muted`, `bg-low`; JS `SYS.gray` |
| `#9be7ff` | light cyan (code, links) | `text-cyan`; code: `text-ink` on `bg-fill` |
| `#3fd0ff` | cyan | `text-cyan` / `SYS.blue` |
| `#2ef2d0` | teal | `text-teal` / `SYS.teal` |
| `#a98bff` | violet | `text-violet` / `SYS.indigo` |
| `#ff5fd7` | pink | `text-pink` / `SYS.pink` (or just blue for buttons) |
| `#c6f432` | lime | `text-lime` / `SYS.green` |
| `#3df5a0` | emerald ("ok") | `text-ok` / `SYS.green` |
| `#ffd84d`, `#ff9f6b` | gold | `text-gold` / `SYS.yellow` (fills) |
| `#ff3d6e` | critical | `text-critical` / `SYS.red` |
| `#ff9f1c` | high | dots: `bg-high` / `SYS.orange`; text: `text-warn` |
| `#060714`, `#081320`, `#07101b`, `#0b1626`, `#060e16` | dark panels | `bg-panel` / `bg-bg` / `bg-panel-2` |
| `#7aa2ff` / `#e58bff` / `#5ee6ff` / `#b4f0a0` | extra identity | `SYS.blue` / `SYS.purple` / `SYS.cyan` / `SYS.mint` |
| `rgb(63 208 255 / .x)` backgrounds | cyan tint | `bg-fill` (neutral) or `bg-cyan/10` (selected) |

`--b:#…` on buttons: remove it. Secondary buttons are blue-on-grey; use
`btn("solid")` for the main action, `btn("danger")` (filled red) or the
`hud-btn-danger` class (red text) for destructive ones.
`--a`, `--ga`, `--c1`, `--c2` and the `accent` props are no-ops now; delete
them when you touch a file.

## 2. Type

- System font only (`font-sans`; `font-mono` = SF Mono for codes, IDs, keys,
  never for numbers in prose or tables).
- **No `uppercase`, no wide tracking (`tracking-[0.1em]` …), no `font-display`
  on headings or labels.** Sentence case everywhere ("Overdue invoices", not
  "OVERDUE INVOICES"). The only uppercase is the small grey group header that
  `<Group header>` and the sidebar draw for you.
- Sizes: large title 30/34px bold (`PageHeader`); section title 20px bold
  (`SectionTitle`); card title 17px semibold; body/rows 15px; secondary 13px
  muted; tiny 12px (pills, captions). Don't go below 12px.
- Numbers: `tabular-nums`; big numbers bold (`BigNum`/`Stat`) in ink.
  Colour a number only when it signals a problem (`critical`, `warn`) or "ok".

## 3. No glow

Remove: `drop-shadow(...)`, `shadow-[0_0_Npx_#…]`, `text-shadow`, gradient
text (`bg-clip-text text-transparent`), neon gradients, clip-path corners,
dashed "HUD" dividers, grid backgrounds, `backdrop-blur` on cards. Allowed
shadows: the hairline ring `shadow-[0_0_0_1px_var(--color-line)]`, menus and
sheets (`shadow-[0_10px_40px_rgb(0_0_0/0.18)]`), the segmented-control thumb.

## 4. Building blocks (`src/components/ui.tsx`)

- `PageHeader` – large title + muted subtitle + mode pill + actions.
- `SectionTitle` – "Needs you"-style 20px heading with a blue action link.
- `Card` – white rounded card, optional 17px header with a muted/blue action.
- `Group` + `Row` (+ `GroupBody`, `Groups`) – **the default for content**:
  inset grouped list (rounded 14px, hairlines between rows), optional small
  grey header above and footer explanation below. `Row` = optional
  `icon`/`iconColor` tile, `label`, `sub`, `value` on the right (muted) or
  controls as children, `href` adds a chevron and makes the row a link.
- `IconTile` – white glyph on a rounded colour square (sidebar/Settings).
- `Switch` – iOS toggle over a real checkbox: keeps `name`/`defaultChecked`
  (forms post the same) or `checked`/`onChange`.
- `Stat` / `StatStrip` / `BigNum` – key-number tiles (13px muted label, 24–30px
  bold value, coloured hint via `hintTone`). `KpiStrip` (command/hud) is the
  same tiles with links/bars.
- `SeverityIcon` / `SeverityBadge` / `Dot` – severity is always shape or word
  plus colour (never colour alone). Badges are tinted pills.
- `Tag` – rounded tinted pill; `ModePill`; `BizLabel` (round dot + name);
  `Chip`/`ChipRow` (command/hud) – filter pills, active = ink filled.
- `Segmented` + `segItem(active)` – iOS segmented control.
- `Table` – muted 12px header (normal case), hairline rows. On phones prefer
  a `Group` of `Row`s over a wide table.
- `btn()` grey-fill blue text · `btn("solid")` filled blue · `btn("danger")`
  filled red · `btn("plain")` blue text only · `input` iOS field.
  `ab` (command/hud) = small secondary button.
- The `hud-*` CSS classes still work and now draw these Apple parts
  (`hud-panel` card, `hud-btn`, `hud-input` …). New code should use the
  components above rather than new `hud-*` markup.

## 5. Patterns

- **List row**: `[dot or icon] title (15px) / muted subtitle (13px) …
  right: muted value, a blue pill button, or a chevron`. Rows ≥ 44px tall.
- **Primary row action**: small filled pill
  (`rounded-full bg-cyan px-3.5 min-h-8 text-[13px] font-semibold text-white`).
- **Empty state**: `<Empty>` inside the group, friendly and short:
  "Nothing needs you right now ✓", "All quiet.", "No meetings today."
- **Banners** (errors, notices): `rounded-[14px] bg-critical/10 px-4 py-3`
  (or `bg-high/12`, `bg-accent/10`) with a bold coloured lead word.
- **Code / tokens**: `rounded-md bg-fill px-1.5 font-mono text-[12.5px] text-ink`.

## 6. Charts and sparklines

- Series colours from `CHART_COLORS` (or `SYS`), in order; one series = blue.
- Gridlines/axes `var(--color-line)`; labels `var(--color-muted)`, 11–12px
  system font; plot background transparent.
- Flat fills or a light area (`stopOpacity` ≤ .25). No glow filters, no neon
  gradients. Rounded bar tops (2–4px) are fine.
- Status strips (uptime ticks …): `ok` green, `high` orange, `critical` red,
  unknown `var(--color-fill)`.
- SVG text colours must be CSS vars (`fill="var(--color-ink)"`), not hexes,
  so they switch with the theme.

## 7. Layout and phone rules

- The shell gives content a max width of ~1200px and 16px (phone) / 32px
  (desktop) padding; don't add outer padding of your own.
- Phones (<1024px) have a bottom tab bar (Today, Tasks, Inbox, Money, More)
  and a compact top bar. Pages start with their large title.
- Grids: 1 column on phones, 2 for number tiles; sections stack with
  `gap-7`. No horizontal page scroll – wide tables scroll inside their card,
  chip rows scroll sideways (`ChipRow`).
- Tap targets ≥ 36–44px (`min-h-10` on phones).
- Test every page at 390px and 1280px, light and dark.
