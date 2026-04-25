# Optional: Render → New → Web Service → Docker, build from `voting_system/`.
# Includes build tools so sqlite3 compiles cleanly.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
ENV npm_config_build_from_source=true
RUN npm install

COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
