# Konspecter web app: the PWA build as static files, served on :8080 by Caddy
# (apps/web/Caddyfile). Built from the repository root, since the app uses the
# workspace packages:
#   docker build -f apps/web/Dockerfile -t konspecter-web .
#   docker run -e KONSPECTER_PUBLIC_URL=https://konspecter.com -p 8080:8080 konspecter-web
# KONSPECTER_PUBLIC_URL is the sync server the app suggests (/config.json).
# The build runs on the build machine: its output is the same on every platform.
FROM --platform=$BUILDPLATFORM node:22-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm install --frozen-lockfile --filter "@konspecter/web..."
# A sync server to suggest when the host names none (apps/web/.env.example).
ARG VITE_KONSPECTER_SERVER_URL=
ENV VITE_KONSPECTER_SERVER_URL=${VITE_KONSPECTER_SERVER_URL}
RUN pnpm --filter @konspecter/web build

FROM caddy:2
LABEL org.opencontainers.image.licenses="MIT"
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
EXPOSE 8080
