FROM node:20-alpine

WORKDIR /app

# Install production dependencies first for better layer caching.
# Secrets are NOT baked into the image — they are supplied at runtime via
# environment variables (docker-compose / secrets manager).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations

# Writable data volume for the non-root user (SQLite in dev).
RUN mkdir -p /data && chown -R node:node /app /data
USER node

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
