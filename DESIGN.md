# Design: Route

The app opens on the week's plan, not on a catalogue: stops, total, saving. Offers support the plan. Chosen from three compared directions on 2026-11-11 (`docs/decisions.md` §3.5).

Tokens live in `src/app/globals.css`; this file explains them. UI tickets build with the tokens and components named here and add nothing ad hoc.

## Colour

Dark is the native theme. The light variant applies when the device asks for it or the user picks it under "Meer".

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#0f1412` | `#f3f7f4` | page |
| `surface` | `#18201c` | `#ffffff` | cards, fields, pressed areas |
| `line` | `#2a352f` | `#d5dfd8` | borders, the route segment to a non-stop |
| `text` | `#eaf2ec` | `#0f1412` | primary text |
| `muted` | `#9db0a4` | `#4b5d53` | secondary text, inactive navigation |
| `accent` | `#5ee0a0` | `#0b7a45` | the route, savings, the current choice, primary actions |
| `on-accent` | `#0f1412` | `#ffffff` | text on an accent fill |
| `warn` | `#ffc857` | `#8a5a00` | ends today, not found, to be verified |
| `danger` | `#ff8f85` | `#b3261e` | errors |

Rules:

- Accent means "this saves you money" or "this is where you are". It is not decoration.
- Amber is for things that need the shopper's attention before they leave the house. An offer whose validity is unknown is amber and says "Te controleren".
- Every text colour reaches 4.5:1 on `bg` and on `surface` in both themes. `src/app/tokens.test.ts` fails the build when a token change breaks that.
- No retailer logos or brand colours: chains are named in text.

## Type

| Role | Family | Size / line | Weight |
|---|---|---|---|
| Totals | Space Grotesk | 34 / 38 | 600 |
| Page title | Space Grotesk | 24 / 28 | 600 |
| Section title, stop name | Space Grotesk | 16–18 / 24 | 600 |
| Prices in rows | Space Grotesk | 15–18 | 500–600 |
| Body | Inter | 14 / 20 | 400 |
| Emphasis in body | Inter | 14 / 20 | 600 |
| Label, eyebrow, meta | Inter | 12 / 16 | 400–600 |
| Field text | Inter | 16 / 24 | 400 |

Space Grotesk carries numbers and names; Inter carries everything read as a sentence. Field text is 16 px so iOS does not zoom the page on focus. Both families are self-hosted from `@fontsource-variable` (SIL Open Font License); nothing is loaded from a third party.

## Space and shape

- Spacing scale: 4, 8, 12, 16, 20, 28. Page gutter 20. Gap between blocks 16.
- Radius 12 on cards, fields and buttons; pill (999) on chips and choices.
- One column, at most 520 px wide, centred on larger screens.
- Cards separate by surface colour first, border second. A dashed border means "not in force yet" (an upcoming offer).
- Touch targets are at least 44 × 44 px. Bottom navigation items are 52 px high.
- Safe areas: content and the bottom navigation pad themselves with `env(safe-area-inset-*)`; the viewport uses `viewport-fit=cover`.
- No horizontal scrolling at 390 px.

## The route line

The signature element. Stops are an ordered list joined by a 2 px vertical line (`RouteStops`, `RouteStop` in `src/components/ui/route-stops.tsx`).

- A filled accent marker is a store to visit; with a number on the plan screen, a plain dot on the summary card.
- The segment between two stores is accent. The segment that leads to something that is not a store is `line`.
- An item no store carries is a dashed amber marker with "?" and has no segment: it is off the route.

Use it only for the plan. It does not decorate lists that are not a sequence of stops.

## Motion

- Press: 160 ms, scale to 0.97, `cubic-bezier(.22, 1, .36, 1)`.
- Plan recalculation and the total: 280 ms, same curve. These are the only things that animate on their own.
- Nothing else moves. `prefers-reduced-motion: reduce` switches all transitions and animations off.
- Hover styles are not relied on: the app is touch-first.

## Components

| Component | File | Notes |
|---|---|---|
| `AppShell`, `BottomNav`, `PageHeader` | `src/components/shell/` | skip link, four sections: Plan, Aanbiedingen, Lijst, Meer |
| `Button`, `ButtonLink` | `src/components/ui/button.tsx` | `primary`, `secondary`, `warn` |
| `Card` | `src/components/ui/card.tsx` | `solid`, `outlined`, `dashed` |
| `RouteStops`, `RouteStop` | `src/components/ui/route-stops.tsx` | see above |
| `DemoBadge` | `src/components/ui/demo-badge.tsx` | on every screen that shows `isDemo` rows |
| `Disclaimer` | `src/components/ui/disclaimer.tsx` | wherever a price or total is shown |
| `EmptyState` | `src/components/ui/empty-state.tsx` | title, one sentence, optional action |
| `SearchField` | `src/components/ui/search-field.tsx` | plain GET form; works without JavaScript |
| `LocaleSwitcher`, `ThemeSwitcher` | `src/components/settings/` | under "Meer" |

Components are written for this app rather than pulled from a kit: the set is small and each one encodes a rule above.

## Words

- Dutch first; English and Italian carry the same keys (`src/i18n/messages.test.ts` checks it). No text is written in a component.
- Say what the shopper gets: "€6,10 bespaard", "nog 4 dagen", "Niet gevonden: tahin".
- Totals are estimates and say so. The line "De eindprijs en beschikbaarheid worden bevestigd door de winkel of de online dienst." appears wherever a price or total is shown.
- Demo rows are labelled "Demodata".

## Installed app

- Manifest at `/manifest.webmanifest` with `id`, `scope`, 192 and 512 icons and a maskable icon; a 180 px `apple-touch-icon` for iOS. Icons are rendered from `src/app/icon.svg` and `design/icon-maskable.svg` by `node scripts/render-icons.mjs`.
- The service worker (`public/sw.js`) caches one thing: the offline page. Pages and prices are never cached, so an installed app cannot show an outdated price and a new deploy reaches it immediately.
- iOS has no install prompt: "Meer" explains "Zet op beginscherm" for iPhone and the browser menu for Android, and hides that block once the app runs from the home screen.
