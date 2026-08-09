FROM node:20-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY modules/analytics/package.json modules/analytics/package.json
COPY modules/identity/package.json modules/identity/package.json
COPY modules/learning/package.json modules/learning/package.json
COPY modules/relationships/package.json modules/relationships/package.json
COPY modules/scheduling/package.json modules/scheduling/package.json
COPY modules/shared/package.json modules/shared/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/db/package.json packages/db/package.json

RUN npm ci --ignore-scripts=false

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY modules ./modules
COPY packages ./packages
COPY public ./public
COPY server ./server
COPY shared ./shared

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "server/index.js"]

