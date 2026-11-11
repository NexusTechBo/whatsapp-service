FROM node:24-slim

ENV NODE_ENV=production \
    WA_SESSION_PATH=/data/baileys_auth \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 3000

CMD ["node", "src/app.ts"]
