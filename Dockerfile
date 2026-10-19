# Joe household board — inbox + static UI (paper projection only).
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
ENV NODE_ENV=production
COPY package.json server.mjs validate.mjs fleet-config.mjs ./
COPY release.json time.mjs market-calendar.json ./
COPY server ./server
COPY contracts ./contracts
COPY public ./public
COPY release ./release
COPY scripts/check-release.mjs ./scripts/check-release.mjs
RUN node scripts/check-release.mjs
RUN mkdir -p /var/lib/joe-board && chown -R node:node /var/lib/joe-board /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/joe/healthz >/dev/null || exit 1
CMD ["node", "server.mjs"]
