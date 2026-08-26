FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY bot.js ./
EXPOSE 8080
CMD ["node", "bot.js"]
