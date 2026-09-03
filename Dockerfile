FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npx prisma generate

EXPOSE 3000

# §14 — `migrate deploy` applica solo le migrazioni versionate in prisma/migrations e si
# ferma se il database è in uno stato che non riconosce.
#
# Prima qui girava `prisma db push --accept-data-loss`, che a ogni avvio del container
# riallineava il database allo schema cancellando in silenzio qualunque colonna o tabella
# non presente nel file — su un database di produzione con dati di studi reali.
#
# Se `migrate deploy` fallisce il processo si ferma qui (`&&`, non `;`): meglio un deploy
# rosso che un'applicazione in ascolto su uno schema che non è quello che si aspetta.
#
# `migrate deploy` usa `directUrl` (ruolo proprietario dello schema), mentre il server usa
# `DATABASE_URL` (ruolo `bluman_app`, soggetto alle policy RLS): servono entrambe le
# variabili nell'ambiente del container.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/index.ts"]
