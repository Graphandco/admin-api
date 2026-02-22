FROM node:20-alpine

# Docker CLI pour lancer des conteneurs temporaires (scripts sur l'hôte)
RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
