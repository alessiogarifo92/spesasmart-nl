# SpesaSmart NL

Web app mobile-first (PWA installabile) che mostra le offerte dei supermercati nei Paesi Bassi, confronta lo stesso prodotto tra catene e trasforma la lista della spesa in un giro di 1, 2 o 3 negozi. Progetto personale e di portfolio. **[English below](#english).**

> **Stato: MVP su `main`, demo online su https://spesasmart-nl.vercel.app.** L'app parte con dati demo inventati, etichettati "Demodata". Gli adapter reali (Albert Heijn, Jumbo, Dirk, Vomar) sono scritti e testati su copie delle pagine, ma spenti e mai eseguiti dal vivo. Dettagli in [docs/limits.md](docs/limits.md).

## Cosa fa

- Offerte in corso e in arrivo di quattro catene, con validità, fonte e momento della raccolta.
- Ricerca per nome, marca o EAN, tollerante agli errori di battitura, con sinonimi in olandese, inglese e italiano.
- Confronto dello stesso prodotto (o di uno simile) tra catene, con prezzo per kg, litro o pezzo.
- Lista della spesa legata al dispositivo, senza account.
- Piano: il giro più conveniente tra 1 e 3 negozi, con il motivo di ogni scelta.
- Interfaccia in olandese (predefinita), inglese e italiano; tema scuro e chiaro.
- Pannello `/admin` per chi gestisce l'app: interruttori per catena, esecuzioni, collegamenti da controllare.

## Avvio in locale

Servono Node.js 22 o più recente e Docker.

```bash
git clone https://github.com/alessiogarifo92/spesasmart-nl.git
cd spesasmart-nl
cp .env.example .env
docker compose up -d        # PostgreSQL e Redis
npm ci                      # installa e genera il client Prisma
npm run db:deploy           # crea le tabelle
npm run db:seed             # catene, categorie e dati demo
npm run dev                 # http://localhost:3000
```

Tutti i comandi si eseguono nella cartella del progetto, dalla shell della macchina (non dentro un container).

## Variabili d'ambiente

| Variabile | A cosa serve | Predefinito in `.env.example` |
|---|---|---|
| `DATABASE_URL` | PostgreSQL dell'app, del worker e di Prisma | il database di `docker-compose.yml` |
| `TEST_DATABASE_URL` | database separato per i test di integrazione ed end-to-end; i test lo azzerano | `spesasmart_test` |
| `REDIS_URL` | code del worker di raccolta | Redis di `docker-compose.yml` |
| `INGESTION_USER_AGENT` | User-Agent di ogni richiesta di raccolta; deve contenere un contatto reale | segnaposto da sostituire |
| `INGESTION_ENABLED_ADAPTERS` | id degli adapter che possono fare richieste reali (`ah,jumbo,dirk`); vuoto significa nessuna richiesta reale | vuoto |
| `ADMIN_TOKEN` | token del pannello `/admin`, almeno 32 caratteri casuali (`openssl rand -hex 24`); vuoto significa nessun pannello | vuoto |

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | app in sviluppo |
| `npm run build` e `npm run start` | build di produzione |
| `npm run verify` | lint, typecheck, test unitari e di integrazione |
| `npm run db:test:deploy` | prepara il database dei test (prima di `verify` e `test:e2e`) |
| `npm run test:e2e` | test nel browser (Playwright) su una build di produzione |
| `npm run ingest -- <id\|all>` | una raccolta, senza Redis |
| `npm run worker` | worker pianificato (serve Redis) |

## Attivare un adapter reale

Leggi prima [docs/limits.md](docs/limits.md). Poi: metti l'id in `INGESTION_ENABLED_ADAPTERS`, imposta `INGESTION_USER_AGENT` con un tuo contatto e `ADMIN_TOKEN`, accendi "Echte adapter" per la catena in `/admin`, esegui `npm run ingest -- <id>` e controlla l'esecuzione in `/admin`.

## Documentazione

| Documento | Contenuto |
|---|---|
| [docs/decisions.md](docs/decisions.md) | ambito, stack, fonti dati, regole di raccolta |
| [docs/architecture.md](docs/architecture.md) | diagramma, struttura dei moduli, convenzioni |
| [docs/data-model.md](docs/data-model.md) | modello dati e scelte |
| [docs/ingestion.md](docs/ingestion.md) | pipeline di raccolta e i tre adapter reali |
| [docs/adding-a-chain.md](docs/adding-a-chain.md) | come aggiungere una catena |
| [docs/deploy.md](docs/deploy.md) | demo online su Vercel e Supabase |
| [docs/limits.md](docs/limits.md) | limiti legali e tecnici: cosa è stato verificato e cosa no |
| [docs/roadmap.md](docs/roadmap.md) | cosa viene dopo |
| [DESIGN.md](DESIGN.md) | token e regole dell'interfaccia |

Il prezzo finale e la disponibilità sono confermati dal negozio o dal servizio online. SpesaSmart NL non è affiliato ai supermercati citati.

---

<a id="english"></a>

# SpesaSmart NL (English)

A mobile-first web app (installable PWA) that shows supermarket offers in the Netherlands, compares the same product across chains and turns a shopping list into a trip to 1, 2 or 3 stores. A personal and portfolio project.

> **Status: MVP on `main`, hosted demo at https://spesasmart-nl.vercel.app.** The app starts with invented demo data, labelled "Demodata". The real adapters (Albert Heijn, Jumbo, Dirk, Vomar) are written and tested against copies of the pages, but switched off and never run live. Details in [docs/limits.md](docs/limits.md).

## What it does

- Current and upcoming offers of four chains, with validity, source and collection time.
- Search by name, brand or EAN, forgiving typos, with Dutch, English and Italian synonyms.
- Comparison of the same (or a similar) product across chains, with price per kg, litre or piece.
- A shopping list tied to the device, without an account.
- Plan: the cheapest trip over 1 to 3 stores, with the reason for each choice.
- Interface in Dutch (default), English and Italian; dark and light theme.
- An `/admin` panel for the person running the app: per-chain switches, runs, links to review.

## Run it locally

You need Node.js 22 or newer and Docker.

```bash
git clone https://github.com/alessiogarifo92/spesasmart-nl.git
cd spesasmart-nl
cp .env.example .env
docker compose up -d        # PostgreSQL and Redis
npm ci                      # installs and generates the Prisma client
npm run db:deploy           # creates the tables
npm run db:seed             # chains, categories and demo data
npm run dev                 # http://localhost:3000
```

Run every command in the project folder, from the host shell (not inside a container).

## Environment variables

| Variable | Purpose | Default in `.env.example` |
|---|---|---|
| `DATABASE_URL` | PostgreSQL for the app, the worker and Prisma | the database in `docker-compose.yml` |
| `TEST_DATABASE_URL` | separate database for integration and end-to-end tests; tests reset it | `spesasmart_test` |
| `REDIS_URL` | queues of the collection worker | Redis in `docker-compose.yml` |
| `INGESTION_USER_AGENT` | User-Agent of every collection request; must name a real contact | placeholder to replace |
| `INGESTION_ENABLED_ADAPTERS` | ids of adapters allowed to make real requests (`ah,jumbo,dirk`); empty means no real request at all | empty |
| `ADMIN_TOKEN` | token for the `/admin` panel, at least 32 random characters (`openssl rand -hex 24`); empty means no panel | empty |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | app in development |
| `npm run build` and `npm run start` | production build |
| `npm run verify` | lint, typecheck, unit and integration tests |
| `npm run db:test:deploy` | prepares the test database (before `verify` and `test:e2e`) |
| `npm run test:e2e` | browser tests (Playwright) against a production build |
| `npm run ingest -- <id\|all>` | one collection run, without Redis |
| `npm run worker` | scheduled worker (needs Redis) |

## Switching on a real adapter

Read [docs/limits.md](docs/limits.md) first. Then: put the id in `INGESTION_ENABLED_ADAPTERS`, set `INGESTION_USER_AGENT` to a contact of yours and set `ADMIN_TOKEN`, switch on "Echte adapter" for the chain in `/admin`, run `npm run ingest -- <id>` and check the run in `/admin`.

## Documentation

See the table in the Italian section above; the documents themselves are in English.

The final price and availability are confirmed by the store or the online service. SpesaSmart NL is not affiliated with the supermarkets named.
