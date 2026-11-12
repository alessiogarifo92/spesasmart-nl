# Adding a chain

The three real adapters (`src/ingestion/adapters/{ah,jumbo,dirk}`) are the worked examples. Dirk's is the shortest.

## 1. Before any code

1. Find the chain's public offers page. One page; no app API, no login, no endpoint found by watching network traffic.
2. Read its `robots.txt` and its terms of use. If either forbids it, stop.
3. Note what the page states per offer: name, price, regular price, size, mechanic, validity. What it does not state stays unknown.
4. Check the rules in `decisions.md` §3: they bind every adapter.

## 2. Reference data

Add the chain to `RETAILERS` in `prisma/seed/reference.ts` with a slug, and run `npm run db:seed`. `adapterEnabled` starts off.

## 3. Fixture

Save the page once, by hand, as `src/ingestion/adapters/<slug>/fixtures/offers.html`, reduced to a dozen cards that cover the cases (with and without regular price, each mechanic, an odd size). Remove images, scripts and styles. Save `robots.txt` next to it. No test ever makes a network request.

## 4. Parser (`parse.ts`)

A pure function `parse<Chain>Offers(html, pageUrl): RawOffer[]` using cheerio.

- Select by stable attributes (`data-*`, `aria-label`), not generated class names.
- Put only text into `payload`: no markup, no image addresses.
- Build links with `sameSiteUrl` from `../text`, which refuses other hosts.
- Skip cards without an id or a title; keep a repeated card once.

## 5. Adapter (`index.ts`)

Implement `RetailerAdapter` from `src/ingestion/adapter.ts`:

- `fetchOffers`: one `ctx.http.get(URL)`, parse, and throw when no card is found so a changed page shows up as a failed run.
- `normalizeOffer`: use the parsers in `src/domain/pricing` (`parsePriceCents`, `parseQuantity`, `parsePromotion`, `parseValidity`). When one does not recognise a value, store `null`. Never compute or guess a price the page does not show.
- `maxRunsPerDay: 1`, `isMock: false`, and a `dedupeKey` that includes the validity end.

The HTTP client, robots check, rate limit, validation, confidence and storage are the runner's job, not the adapter's.

## 6. Tests (`<slug>.test.ts`)

Follow `dirk.test.ts`: every card of the fixture read once; exact prices; `validateOffer` verdicts; unreadable values stay unknown; no markup or image in the payloads; foreign links refused; exactly one request; the page is allowed by the fixture's `robots.txt`; an empty page fails the fetch.

## 7. Register and document

- Add the adapter to `REAL_ADAPTERS` in `src/ingestion/registry.ts` and to `registry.test.ts`.
- Describe it under "Real adapters" in `ingestion.md`: page, robots state and date, what is read, what is missing.
- Add its row to `limits.md`.

## 8. First live run

On your own machine: id in `INGESTION_ENABLED_ADAPTERS`, a real contact in `INGESTION_USER_AGENT`, the chain's switch on in `/admin`, then `npm run ingest -- <slug>`. Compare a handful of stored offers with the page by hand before leaving the switch on.
