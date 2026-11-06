# Image du serveur commun. Contexte de build = racine du dépôt :
#   docker build -f server/Dockerfile .
# Install et build fusionnés dans un seul stage : on ne recopie jamais de
# node_modules sélectivement (les liens pnpm par workspace se perdraient).

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12.14.0
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @live-sdk/server build \
 && CI=true pnpm install --frozen-lockfile --prod

# ---- run ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
# Tout l'espace de travail (server/, protocol/ et node_modules de prod) reste
# en place : la config servie et les fixtures du protocole sont embarquées.
COPY --from=build /app /app
# Le volume nommé des images du Produit épinglé hérite de ces droits.
RUN mkdir -p /data/images && chown node:node /data/images
WORKDIR /app/server
USER node
EXPOSE 3000
# /health renvoie 503 si Postgres est KO : seul un code < 500 est sain.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health', {signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/main.js"]
