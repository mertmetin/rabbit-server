#!/bin/sh
# Apply pending migrations, then start the server. Migrations take a lock in
# the database, so two servers starting together is safe.
set -e
cd /migrate
DATABASE_URL="$DATABASE_URL?sslaccept=strict&sslcert=/app/certs/rds-ca.pem" \
  node node_modules/prisma/build/index.js migrate deploy
cd /app
exec node server.js
