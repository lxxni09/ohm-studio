# Nodaris-Server mit Web-Version von Ohm Studio (Self-Hosted)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx vite build

FROM node:22-alpine
WORKDIR /srv
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data STATIC_DIR=/srv/dist
COPY --from=build /app/dist ./dist
COPY server ./server
RUN addgroup -S nodaris && adduser -S nodaris -G nodaris && mkdir -p /data && chown nodaris:nodaris /data
USER nodaris
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8787/healthz || exit 1
CMD ["node", "server/nodaris-server.mjs"]
