FROM node:17
WORKDIR /app
COPY . /app

RUN npm ci --omit=dev
CMD [ "node", "main.js" ]