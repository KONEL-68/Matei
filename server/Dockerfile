FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm install

COPY server/ .
COPY sql/ sql/
RUN npm run build && cp src/migrations/*.sql dist/migrations/ && cp -r sql dist/sql

EXPOSE 3001
CMD ["node", "dist/index.js"]
