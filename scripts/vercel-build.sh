#!/usr/bin/env sh
# Build step of the hosted demo (vercel.json). Applies migrations, reloads the labelled
# demo data so its validity dates start from the deploy day, then builds the app.
# DIRECT_URL: a session-mode connection for migrations. DATABASE_URL: what the app uses.
set -eu
: "${DATABASE_URL:?DATABASE_URL is not set}"
DATABASE_URL="${DIRECT_URL:-$DATABASE_URL}" npx prisma migrate deploy
npx prisma db seed
npx next build
