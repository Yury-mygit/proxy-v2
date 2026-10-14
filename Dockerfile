FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY app ./app

EXPOSE 8888 8889

CMD ["node", "app/main.js"]
