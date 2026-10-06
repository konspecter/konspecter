# Konspecter web app: the PWA build as static files, served on :8080 by Caddy
# (apps/web/Caddyfile). Built from the repository root, since the app uses the
# workspace packages:
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_KONSPECTER_SERVER_URL=https://notes.example.com -t konspecter-web .
#   docker run -p 8080:8080 konspecter-web
FROM node:22-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm install --frozen-lockfile --filter "@konspecter/web..."
# The sync server the app suggests (apps/web/.env.example).
ARG VITE_KONSPECTER_SERVER_URL=
ENV VITE_KONSPECTER_SERVER_URL=${VITE_KONSPECTER_SERVER_URL}
RUN pnpm --filter @konspecter/web build

FROM caddy:2
LABEL org.opencontainers.image.licenses="MIT"
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
EXPOSE 8080
