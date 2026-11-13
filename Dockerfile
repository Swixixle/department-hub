# The department server, serving the built app and the API from one address (passkeys need that).
# Built and run on Fly.io by scripts/deploy-fly.sh; docs/DEPLOY.md explains each step.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY src ./src
COPY --from=build /app/dist ./dist
# The database lives on the mounted volume, never in the image. RP settings come from fly.toml.
ENV DEPARTMENT_HUB_HOST=0.0.0.0 DEPARTMENT_HUB_PORT=8080 DEPARTMENT_HUB_DB=/data/hub.sqlite DEPARTMENT_HUB_STATIC=/app/dist
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.mjs"]
