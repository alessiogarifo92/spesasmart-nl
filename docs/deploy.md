# Hosted demo

A way to try the MVP on a phone: the app on Vercel (Hobby plan), the database on Supabase (Free plan). Demo data only. Not a production setup: no worker, no Redis, no real adapter, no admin panel.

State on 2026-11-13: **live at https://spesasmart-nl.vercel.app**, deployed from commit `4dc4491` of `mvp` with the Vercel CLI (`vercel deploy --prod`). Since then the project is connected to the GitHub repository: **every push to `main` redeploys** and reloads the demo data. Other branches are not built (the project's "Ignored Build Step" skips everything that is not production).

Checked on the live site after the deploy: `/offers` lists the demo offers dated from the deploy day, `/it/more/sources` reads the database, `/admin` answers 404, Supabase's security advisor reports nothing above "info". Not checked from the build environment: response headers on the live site, installing the PWA on a phone.

## What runs where

| Part | Where | Notes |
|---|---|---|
| App | Vercel, region `fra1` | `vercel.json`; every response carries `X-Robots-Tag: noindex, nofollow` |
| Database | Supabase project `spesasmart-nl` (`zgtjbxpakzzmisyowhkc`, eu-central-1) | the app connects as the role `spesasmart_app`, not as `postgres` |
| Worker, Redis | nowhere | demo offers are written by the build, see below |

## Build

`vercel.json` runs `npm run build:vercel` (`scripts/vercel-build.sh`): `prisma migrate deploy`, `prisma db seed`, `next build`. The seed is idempotent and dates the demo offers from the build day. Demo offers run out after about eleven days: **redeploy to refresh them**.

## Environment variables on Vercel

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase pooler, transaction mode (port 6543), host `aws-1-eu-central-1.pooler.supabase.com`, user `spesasmart_app.<project ref>`, `?sslmode=no-verify` |
| `DIRECT_URL` | the same pooler in session mode (port 5432), `?sslmode=require`; used by the build for migrations only |

Leave `ADMIN_TOKEN` and `INGESTION_ENABLED_ADAPTERS` unset: no admin panel, no real request.

The role's password is not stored anywhere in the repository. To replace it: `ALTER ROLE spesasmart_app PASSWORD '…'` in the Supabase SQL editor, then update both variables.

`sslmode=no-verify` encrypts the connection without checking Supabase's certificate. Acceptable for demo data; a real deployment should load Supabase's CA certificate instead.

## Protection

- Every table has row level security on and no policy (migration `enable_row_level_security`), so Supabase's HTTP data API cannot read or write them. The app's role owns the tables and is not affected.
- A script that never returns its cookie could fill the database with lists: `LIST_LIMITS.totalLists` (20 000) is the ceiling, and a Vercel Firewall rate limit on POST requests is still to be added (not done).
- Building a plan searches a few typed items at a time (`SEARCHES_AT_ONCE`), so one page view cannot open a hundred queries at once.

## Rollback and removal

- Roll back the app: Vercel dashboard → Deployments → previous deployment → "Promote to Production". Migrations so far only add things, so an older build runs on the newer schema.
- Take the demo offline: delete the Vercel project; pause or delete the Supabase project. Both are free plans, so nothing is billed either way. Supabase pauses a free project by itself after a week without requests.

## Not done

- No error reporting or uptime monitoring.
- Lists of devices that never return are not removed.
- Vercel keeps request logs (IP address, path); the More page says so.
