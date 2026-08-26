FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev --no-audit --no-fund && \
    find ./node_modules/minecraft-data/minecraft-data/data/pc -mindepth 1 -maxdepth 1 ! -name '1.21.4' ! -name 'common' -exec rm -rf {} + 2>/dev/null || true

COPY bot.js ./

EXPOSE 8080

CMD ["node", "bot.js"]
