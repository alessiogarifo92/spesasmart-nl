# Limits: what was checked and what was not

Written 2026-11-12, at the end of the MVP. Not legal advice. The project is for personal use and a portfolio; nothing here covers a public or commercial launch.

## Legal

| Topic | Checked | Not checked |
|---|---|---|
| robots.txt | Read on 2026-11-12 for ah.nl, jumbo.com and dirk.nl. None restricts the one page each adapter reads. A copy sits next to each adapter and a test checks the page against it. The runner reads the live robots.txt before every run and refuses a disallowed page. | Whether the files have changed since. vomar.nl has no adapter. |
| Terms of use | — | **The terms of use of the four chains were not read.** Some sites forbid automated access in their terms even where robots.txt allows it. Read them before switching an adapter on. |
| Permission | — | No chain was asked for permission and none offers a public offers feed that was found. |
| Database rights (EU Database Directive, Dutch Databankenwet) | Design choices that reduce exposure: offer pages only, at most one request per chain per day, no full catalogue, a small part of each site. | Whether a chain's weekly offers count as a protected database and whether this use is a substantial extraction. This is the main open legal question and needs a lawyer for anything beyond personal use. |
| Copyright | No images, logos, flyers or page markup are stored or shown: tests on each adapter assert it. Stored per offer: product name, prices, dates, mechanic, link. | Product names and promotion wording are stored as the chain wrote them. |
| Trademarks | Chain names appear as plain text to say where a price comes from; the app states it has no ties to them. | — |
| Privacy (GDPR) | No account, no analytics, no advertising, no third-party requests from the page (fonts are self-hosted). Two first-party cookies: a random device id, written only when something is saved, and the language. "Delete my data" removes lists and the id. Feedback stores no free text. | No privacy policy or cookie notice was written, which a public deployment would need. Lists of devices that never return are not removed. Server logs depend on the host. |
| Open data | Open Food Facts, Checkjebon and OpenStreetMap were assessed in `decisions.md`. | None of them is integrated; their licences have to be re-read and their attribution added when they are. |

A request from a chain to stop means: adapter off the same day (`/admin` switch or `INGESTION_ENABLED_ADAPTERS`), and its stored rows deleted from the database by hand.

## Technical

**No live run has been made.** Retailer sites cannot be reached from the environment the MVP was built in. Each parser was developed against a reduced copy of the real page, captured once on 2026-11-12 through a rendering service. Until a first live run is checked by hand:

- it is unknown whether the plain HTTP response holds the same content as the rendered capture (most at risk: Dirk's product names, Albert Heijn's card list);
- it is unknown whether the sites answer a client with this project's User-Agent at all.

Per chain:

| Chain | State | Known gaps |
|---|---|---|
| Albert Heijn | adapter written, off | group offers ("Alle Conimex*") have a mechanic and no price; tiered discounts are kept as text; no next-week offers |
| Jumbo | adapter written, off | offers are ranges without size or regular price, so they do not link across chains; only the server-rendered part of the page is read (46 of 139 offers on the capture day) |
| Dirk | adapter written, off | no start date; next week's offers are not collected |
| Vomar | demo data only | offers exist only as flyer images (Publitas); reading them means OCR on a republished flyer, which was not built (see issue #6) |

App:

- Real rows are stored next to a chain's demo rows; they do not replace them. There is no command yet that removes a chain's demo rows; `SEED_DEMO=false npm run db:seed` on an empty database starts without them.
- Regular prices come only from what an offer card shows. There is no regular-price source, so "cheapest across chains" is limited to products on offer.
- Without barcodes from real pages, links between chains rely on brand, name and size; doubtful links wait in `/admin/matches`.
- Store locations, distance and opening hours are not implemented: the plan chooses chains, not branches.
- The list needs a connection: the PWA caches the shell, not the list.
- Plan settings live in the address and are not remembered.
- The daily run limit counts successful runs only; a failing adapter can retry.
- Admin: a copied session cookie stays valid until it expires (8 hours); the Secure flag depends on the proxy sending `X-Forwarded-Proto`.
- Polish, Turkish and Arabic are prepared in the routing but not translated.
- A hosted demo is prepared but not deployed (`deploy.md`); no backup or monitoring is set up.
