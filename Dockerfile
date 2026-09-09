# Use a stable Node.js runtime and build native modules in a separate stage.
FROM node:24-bullseye-slim AS build
WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 \
  make \
  g++ \
  libsqlite3-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm config set package-lock false && npm install --omit=dev --no-audit --no-fund

COPY . .
RUN npm prune --production

FROM node:24-bullseye-slim
WORKDIR /usr/src/app
COPY --from=build /usr/src/app .

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "server.js"]
