# rabbit-server for AWS ECS Fargate (linux/amd64).
# Build: docker buildx build --platform linux/amd64 -t rabbit-server .

FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The build loads the database client but never connects; it only needs a
# well-formed address.
RUN npx prisma generate && \
    DATABASE_URL=mysql://build:build@localhost:3306/build npm run build

# Prisma CLI on its own, only for `migrate deploy` at startup.
FROM node:22-bookworm-slim AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /migrate
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && \
    rm -rf node_modules/next node_modules/@next node_modules/react-dom node_modules/typescript node_modules/eslint* node_modules/@typescript-eslint
COPY prisma ./prisma
COPY prisma.config.ts ./

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 \
    DATABASE_TLS=true NODE_EXTRA_CA_CERTS=/app/certs/rds-ca.pem
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-ca.pem
COPY --from=migrate /migrate /migrate
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY docker/start.sh /start.sh
USER node
EXPOSE 8080
CMD ["/start.sh"]
