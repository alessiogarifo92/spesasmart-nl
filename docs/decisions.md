# Decisions

Confirmed decisions for SpesaSmart NL, newest phase last. Tickets reference this file instead of re-deriving it.

## 1. Idea and scope (confirmed 2026-11-11)

- **Purpose**: personal use and portfolio. Not a commercial product; no monetisation, no public launch planned.
- **What it does**: shows current and upcoming supermarket offers in the Netherlands, compares the same or similar products across chains, and turns a shopping list into the cheapest plan across 1, 2 or 3 stores.
- **Reduced start**: four chains — Albert Heijn, Jumbo, Vomar, Dirk. Offers, search, price comparison, shopping list and basket optimisation only.
- **Parked until the base is in real use**: recipes and weekly budget, receipt scanning, price alerts and savings dashboard, store map, loyalty integrations, further chains (PLUS, Lidl, ALDI, Hoogvliet, DekaMarkt, Nettorama, SPAR, Ekoplaza, Picnic). Coop is dropped: coop.nl redirects to plus.nl.
- **Languages**: Dutch (default), English, Italian. Polish, Turkish and Arabic (right-to-left) are prepared in the i18n setup and translated later.
- **Platforms**: web, mobile-first, installable PWA on Android and iOS. No native app.

## 2. Stack and cost (confirmed 2026-11-11, chosen by the implementer at the user's request)

- **App**: Next.js (App Router), TypeScript, Tailwind CSS, `next-intl`. (shadcn/ui was planned and dropped: see §3.5.)
- **Data**: PostgreSQL with Prisma; search with PostgreSQL full-text plus `pg_trgm`. No separate search engine.
- **Ingestion**: a Node worker process separate from the web app, BullMQ queues on Redis, Playwright only for chains whose offer pages need JavaScript rendering.
- **Auth**: Auth.js with email and Google. Apple sign-in is not planned (needs a paid Apple Developer account).
- **Tests**: Vitest (unit, integration), Playwright (end to end).
- **Local infrastructure**: Docker Compose for PostgreSQL and Redis.
- **Cost today**: zero; everything runs locally. Hosting is decided at deploy time; the worker needs an always-on process, so a serverless-only host is not enough.

## 3. Data sources and legal posture (confirmed 2026-11-11)

Findings from 2026-11-11; re-check before relying on them.

| Need | Source | Licence / basis | Limit |
|---|---|---|---|
| Weekly offers | each chain's public offer pages, one adapter per chain | public pages allowed by each site's robots.txt | terms of use of the individual chains were not read; no permission was requested |
| Regular prices | Checkjebon open data (GitHub) | repository MIT, "may be reused in other projects" | no promotions, no EAN; upstream data comes from retailer sites |
| Product catalogue with EAN | Open Food Facts | ODbL, images CC BY-SA | no prices |
| Crowd-sourced prices | Open Prices (Open Food Facts) | to be confirmed before use | Dutch coverage unknown |
| Stores and opening hours | OpenStreetMap | ODbL | opening-hours quality varies |

Scraping rules, binding on every adapter:

- Offer pages only; never a chain's full catalogue.
- At most one collection run per chain per day (Vomar Dagknallers may need more; decide in that adapter's ticket).
- Identifiable User-Agent with a contact address; robots.txt honoured on every run; rate limit, retry with exponential backoff, timeout.
- No retailer images, logos or whole flyers stored or republished: store prices, product names, dates, promotion mechanics and the source URL.
- No private or reverse-engineered mobile APIs, no login-gated pages, no bypassing of protections.
- Every adapter has a kill switch. A takedown request from a chain means that adapter is switched off the same day.
- Demo data is always labelled as demo data in the interface.

Observed on real pages:

- Promotion weeks differ per chain (Jumbo Wednesday to Tuesday, Vomar Sunday to Saturday): validity is stored per offer, never assumed per calendar week.
- Jumbo's offer page carries mechanics and dates in the HTML. Vomar's weekly flyer is served through Publitas and includes Dagknallers. Dirk's offer page has prices in the static HTML but product names need JavaScript rendering.

Not legal advice. A commercial launch would need a lawyer and an official feed or agreement from at least one chain first.

## 3.5. Design (confirmed 2026-11-11)

Direction **C · Route**: the home opens on the week's plan (stops, total, saving), offers support it; dark mode native with a light variant. Canvas with the three compared directions: https://claude.ai/artifact/RpEAiK8ZqVLs2oYWbe5xUu (private to the owner). Tokens and rules live in `DESIGN.md` at the repository root; UI tickets reference it.

Changes made while building it: the fourth navigation tab is "Meer" (language, appearance, install help, about) because the savings dashboard is parked; components are written for the app instead of using shadcn/ui, since the set is small; fonts are self-hosted.

## 4. Delivery (confirmed 2026-11-11)

- **No accounts in the MVP**: lists are tied to the device. Auth.js is added only if several users or devices are wanted.
- **No online preview**: each ticket leaves committed screenshots and local commands.
- **One manual check at the end of the MVP**, at the user's request: ticket branches merge into the integration branch `mvp`; `main` receives nothing until the user has checked `mvp`.
- **Retailer hosts are not reachable from the cloud development container** (network policy). Adapter parsers are developed against reduced fixtures captured once; live runs are verified on the user's machine.
