# Single image used by BOTH the api and worker services.
# docker-compose overrides the command per service.
FROM node:22-slim AS base
WORKDIR /app

# OpenSSL is needed by Prisma's query engine on slim images.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install deps (cached unless package files change).
COPY package.json package-lock.json* ./
RUN npm install

# Copy source + generate the Prisma client, then build TypeScript.
COPY . .
RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000

# Default command (api). The worker service overrides this in compose.
CMD ["node", "dist/index.js"]
