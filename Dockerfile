FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npx tsc

EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push --accept-data-loss ; node dist/index.js"]
