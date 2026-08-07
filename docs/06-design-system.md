# 06 — Design System

> The Orderly front-end design system: a **Deliveroo-inspired teal identity** built on design tokens, a small shared UI kit, and motion that never gets in the way. Everything here is live in `frontend/src/theme/tokens.css`, `frontend/src/components/ui/ui.css` and `frontend/src/styles/app.css`.

## 1. Design principles

1. **Friendly first** — warm teal, generous radii, rounded typography. It should feel like food delivery, not enterprise software.
2. **Accessible** — WCAG AA contrast in both themes, keyboard focus rings on every interactive element, `prefers-reduced-motion` respected globally.
3. **Themed by tokens** — no hard-coded colors in components; everything flows from CSS custom properties that flip with `[data-theme]`.
4. **Motion with purpose** — animation signals state (hover, press, page enter, progress). Never decorative or distracting.

## 2. Design tokens

Tokens live in `frontend/src/theme/tokens.css` and are exposed as CSS custom properties on `:root`. The `ThemeContext` sets `data-theme="light" | "dark"` on `<html>`; tokens re-resolve automatically.

### Color — light theme

| Token | Value | Usage |
|---|---|---|
| `--primary` | `#00b3a5` | Primary buttons, links, active states, focus rings |
| `--primary-hover` | `#009e92` | Primary hover |
| `--primary-active` | `#008a7f` | Primary pressed |
| `--primary-soft` | `rgba(0,179,165,0.10)` | Selected rows, soft badges, menu highlights |
| `--accent` | `#f5d300` | Warm accent (e.g. ratings, highlights) |
| `--bg` | `#f5fbfa` | App background (mint) |
| `--surface` | `#ffffff` | Cards, inputs, modals |
| `--surface-2` | `#f0faf8` | Subtle raised surfaces, table header |
| `--surface-3` | `#e2f5f2` | Hover fills, thumbnails |
| `--border` | `#d8eeea` | Default borders |
| `--border-strong` | `#b9e0da` | Input borders |
| `--text` | `#123b36` | Primary text |
| `--text-secondary` | `#4c6b66` | Secondary text |
| `--text-muted` | `#7d9a95` | Placeholders, captions |
| `--success` / `--warning` / `--danger` | `#0f9d58` / `#d97706` / `#dc2626` | Semantic states (soft variants exist: `-soft`) |

### Color — dark theme

The same token names, tuned for dark: `--primary: #22d3c2`, `--bg: #0d1514`, `--surface: #15201e`, `--text: #e8f4f2`. Dark surfaces use deep teal-tinted grays, never pure black, to keep the brand hue.

### Typography

| Token | Value | Usage |
|---|---|---|
| `--font-sans` | `'Plus Jakarta Sans', 'Inter', system-ui…` | All UI text — friendly, rounded, geometric |
| `--font-mono` | `SF Mono, JetBrains Mono, ui-monospace…` | Code, IDs, hashes |

Type scale (px): `--text-xs: 12` · `--text-sm: 13` · `--text-base: 14` · `--text-md: 16` · `--text-lg: 20` · `--text-xl: 26` · `--text-2xl: 32`.

Headings use `font-weight: 650` with `letter-spacing: -0.015em`; page titles use `-0.02em`.

### Spacing, radii, shadows

- **Spacing**: 4px base scale — `--space-1` … `--space-16` (4, 8, 12, 16, 20, 24, 32, 40, 48, 64).
- **Radii** (generous, friendly): `--radius-xs: 8px` · `--radius-sm: 10px` · `--radius-md: 12px` · `--radius-lg: 16px` · `--radius-xl: 20px` · `--radius-full: 9999px`.
- **Shadows**: 4 tiers (`--shadow-xs` … `--shadow-lg`) tuned per theme; `--shadow-focus` is the shared keyboard focus ring.

### Motion

| Token | Value | Usage |
|---|---|---|
| `--dur-fast` | 120ms | Hover, borders, icon states |
| `--dur-base` | 200ms | Cards, modals, toasts |
| `--dur-slow` | 320ms | Page entrances, theme transitions |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Swift exits |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Theme/background fades |
| `--ease-bounce` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful press/pop |

All motion is wrapped in `@media (prefers-reduced-motion: reduce)` so users who opt out get instant transitions.

## 3. Component library

Shared components live in `frontend/src/components/ui/` (see `index.js` for the export list) with styles in `ui.css`. All use the `.oms-*` class prefix.

### Buttons (`Button`)
- Variants: `primary` (teal, with soft glow), `outline`, `ghost`, `danger`, `danger-ghost`.
- Sizes: default (38px), `sm` (30px), `lg` (46px, wider radius).
- Motion: hover lifts `translateY(-1px)` + deeper glow; press compresses with the bounce ease. Loading shows an inline spinner.

### Cards (`Card`)
- `.oms-card` = surface + border + radius-lg. `.oms-card--hover` lifts 2px and deepens shadow on hover.

### Form fields (`Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`)
- Inputs are 40px, `1.5px` border, `--radius-sm`. Focus = teal border + `--shadow-focus` ring. Invalid state = `aria-invalid` red border.
- The switch has a bouncing knob with a teal checked state.

### Table (`Table`)
- Sticky uppercase header, zebra-free but hover-highlighted rows, right-aligned numeric columns (`--text-muted` header, `--text-secondary` body).

### Feedback
- **Badge** — neutral/success/warning/danger/primary/accent tones; pills with a status dot.
- **Toast** — top-right viewport, icon + title + description, auto-dismiss progress bar, enter/exit animations.
- **Skeleton** — shimmer placeholders that respect dark mode.
- **EmptyState** — icon tile + title + description, centered.
- **Modal** — overlay blur + `oms-pop` enter animation, header/body/footer structure.

### Layout primitives
- `.oms-page` / `.oms-page__header` — page container and title row.
- `.oms-shell` — app shell (sticky glass navbar + main).
- `.oms-auth` / `.oms-auth__card` — centered auth card (max 400px, lifts on hover).
- `.oms-grid--2col` — responsive two-column layout.

## 4. Page patterns

### Navbar (`app.css`)
Sticky glass bar (`--glass` + `backdrop-filter: blur(14px)`), workspace switcher pill with a success dot, theme toggle, user avatar (teal gradient). Active nav link gets `--surface-2` fill.

### Public storefront (`PublicMenuPage.jsx`)
- **Hero**: teal gradient (`#008a7f → #00b3a5 → #00e0cf`) with a soft circular accent, restaurant logo card, white text.
- **Category pills**: rounded-full chips; active = teal fill + glow; hover lifts and tints the border.
- **Item rows**: white cards with image thumb, name, prep time, description, add-ons, price, weight pill.

## 5. Adding or changing a theme color

1. Edit the token in both `:root[data-theme='light']` and `:root[data-theme='dark']` blocks in `tokens.css`.
2. Never hard-code the color in a component — reference the token (`var(--primary)`).
3. Check contrast: text on `--bg` / `--surface` must meet WCAG AA. The teal pair (`#00b3a5` + white) passes on buttons; keep `--on-primary: #ffffff`.
4. Run `cd frontend && npm run lint && npm run build` and eyeball light + dark in the browser.

## 6. Regenerating the README screenshots

```bash
# backend on :4000 + frontend on :5173, seeded with admin@oms.dev / Str0ngPass!42
cd frontend
node scripts/screenshots.mjs   # writes docs/screenshots/*.png
```

The script drives real Chrome (Playwright) through login, the products page, and the public storefront in light and dark mode.
