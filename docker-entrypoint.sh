#!/usr/bin/env bash
set -euo pipefail

INIT_MARKER="/app/data/.initialized"

echo "Starting Next.js server in background..."
node app/web/server.js &
SERVER_PID=$!

# Wait for Next.js to be ready
echo "Waiting for Next.js..."
for i in $(seq 1 90); do
  if curl -sf http://localhost:3000/ > /dev/null 2>&1; then
    echo "Next.js is ready."
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "ERROR: Next.js not ready after 180s"
    kill $SERVER_PID 2>/dev/null
    exit 1
  fi
  sleep 2
done

echo "[0/3] Syncing database schema..."
npx prisma db push --skip-generate

if [ ! -f "$INIT_MARKER" ]; then
  echo "=== First-time initialization ==="
  echo "[1/2] Seeding database..."
  npx tsx prisma/seed.ts

  echo "[2/2] Importing seed knowledge..."
  # Login to get session cookie
  COOKIE=$(curl -sf -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"药店工作人员","password":"demo123"}' \
    -D - -o /dev/null 2>&1 | grep -i 'set-cookie' | head -1 | sed 's/.*set-cookie: *//i; s/;.*//')

  if [ -z "$COOKIE" ]; then
    echo "WARNING: Failed to get session cookie, skipping knowledge import"
  else
    IMPORT_RESULT=$(curl -sf -X POST http://localhost:3000/api/knowledge \
      -H "Cookie: $COOKIE" 2>&1) || IMPORT_RESULT="failed"
    echo "Import result: $IMPORT_RESULT"
  fi

  touch "$INIT_MARKER"
  echo "=== Initialization complete ==="
else
  echo "Already initialized, skipping init."
fi

echo "Next.js server running (PID $SERVER_PID)"
wait $SERVER_PID
