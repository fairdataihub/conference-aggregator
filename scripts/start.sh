#!/bin/sh
set -e

# Wait for Postgres to accept connections before starting the app
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's#^[^@]*@([^:/?]+).*#\1#')
DB_PORT=$(echo "$DATABASE_URL" | sed -nE 's#^[^@]*@[^:/?]+:([0-9]+).*#\1#p')
DB_PORT=${DB_PORT:-5432}

echo "Waiting for Postgres at $DB_HOST:$DB_PORT..."
until nc -z "$DB_HOST" "$DB_PORT"; do
  sleep 1
done

exec node /app/server/index.mjs
