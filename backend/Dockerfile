FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY src ./src
COPY .env.example ./.env

EXPOSE 4000
CMD ["npm", "start"]
